"""Chat endpoint: dynamic system prompt + Claude tool use over the POS data."""

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.ai_settings import get_or_create_settings
from app.api.deps import get_current_user
from app.db.session import get_db
from app.models.conversation import ChatMessage, Conversation
from app.models.user import User
from app.schemas.chat import ChatMessageOut, ChatRequest, ChatResponse
from app.services.claude_agent import ClaudeNotConfigured, run_chat
from app.services.data_source import EphemeralDataMissing, resolve_read_engine

router = APIRouter(prefix="/api/chat", tags=["chat"])


def _load_conversation(
    db: Session, conversation_id: int, user: User
) -> Conversation:
    convo = db.get(Conversation, conversation_id)
    if convo is None or convo.user_id != user.id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Conversation not found"
        )
    return convo


@router.post("/message", response_model=ChatResponse)
def post_message(
    payload: ChatRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> ChatResponse:
    # Resolve (or create) the conversation owned by this user.
    if payload.conversation_id is not None:
        convo = _load_conversation(db, payload.conversation_id, current_user)
    else:
        convo = Conversation(
            user_id=current_user.id,
            title=payload.message[:60],
        )
        db.add(convo)
        db.flush()

    history = [
        {"role": m.role, "content": m.content}
        for m in convo.messages
    ]

    ai_settings = get_or_create_settings(db)

    # Route tool reads to the right engine for the active data source.
    try:
        eng = resolve_read_engine(payload.source, current_user.id)
    except EphemeralDataMissing as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)
        ) from exc

    try:
        result = run_chat(
            ai_settings=ai_settings,
            history=history,
            user_message=payload.message,
            eng=eng,
        )
    except ClaudeNotConfigured as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)
        )
    except Exception as exc:  # surface upstream/model errors cleanly
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Assistant error: {exc}",
        )

    # Persist the turn (user message + assistant reply).
    db.add(ChatMessage(conversation_id=convo.id, role="user", content=payload.message))
    db.add(
        ChatMessage(
            conversation_id=convo.id, role="assistant", content=result["reply"]
        )
    )
    db.commit()

    return ChatResponse(
        conversation_id=convo.id,
        reply=result["reply"],
        tools_used=result.get("tools_used", []),
        widget=result.get("widget"),
    )


@router.get("/conversations/{conversation_id}/messages", response_model=list[ChatMessageOut])
def get_messages(
    conversation_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> list[ChatMessage]:
    convo = _load_conversation(db, conversation_id, current_user)
    return list(
        db.execute(
            select(ChatMessage)
            .where(ChatMessage.conversation_id == convo.id)
            .order_by(ChatMessage.id)
        ).scalars()
    )
