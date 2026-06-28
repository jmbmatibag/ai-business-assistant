"""Claude agent: builds the dynamic system prompt and runs the tool-use loop."""

from __future__ import annotations

import json
from typing import Any

import anthropic
from sqlalchemy.engine import Engine

from app.core.config import settings as app_settings
from app.core.crypto import DecryptionError, decrypt_secret
from app.models.ai_settings import AISettings
from app.services.tools import (
    REPLENISHMENT_TOOL,
    SCHEMA_DESCRIPTION,
    TOOL_DEFINITIONS,
    ToolError,
    dispatch_tool,
)

# Safety net so a misbehaving model can't loop forever on tool calls.
MAX_TOOL_ITERATIONS = 6
MAX_TOKENS = 2048


class ClaudeNotConfigured(Exception):
    """Raised when no Anthropic API key is configured."""


def resolve_api_key(ai_settings: AISettings) -> str:
    """The Anthropic API key to use: the operator-supplied key (decrypted) if
    set, otherwise the ANTHROPIC_API_KEY environment variable."""
    encrypted = getattr(ai_settings, "anthropic_api_key_encrypted", None)
    if encrypted:
        try:
            return decrypt_secret(encrypted)
        except DecryptionError:
            # Stored key undecryptable (rotated FERNET_KEY) — fall back to env.
            pass
    return app_settings.anthropic_api_key


def build_system_prompt(ai_settings: AISettings) -> str:
    """Compose Claude's instructions from the stored AI configuration."""
    base = ai_settings.base_system_prompt.strip()
    return f"""{base}

Operational parameters (configured by the operator):
- Default safety stock: {ai_settings.default_safety_stock}% above forecast demand.
- Anomaly threshold: {ai_settings.anomaly_threshold} cancelled transactions \
per store per day flags an operational anomaly.

You have read-only tools to query the live POS database. Prefer the structured
tools (get_sales_summary, scan_cancellation_anomalies) when they fit; use
run_readonly_sql for anything else. Never claim a number you did not obtain
from a tool. When asked about cancellations or anomalies, use
scan_cancellation_anomalies with the configured threshold.

When the operator asks for a replenishment, delivery, or restock plan, call
calculate_replenishment_matrix with the store and the number of days to cover.
The plan is rendered for the operator as an interactive widget, so keep your
text reply brief — introduce the plan in one or two sentences rather than
re-listing every quantity.

{SCHEMA_DESCRIPTION}"""


def _content_to_text(content: list[Any]) -> str:
    """Concatenate the text blocks of an assistant message."""
    parts = [block.text for block in content if getattr(block, "type", None) == "text"]
    return "\n".join(p for p in parts if p).strip()


def _matrix_to_widget(result: dict[str, Any]) -> dict[str, Any] | None:
    """Turn a replenishment-matrix tool result into a delivery-plan widget."""
    items = result.get("items") or []
    if not items:
        return None
    store = result.get("store_name") or f"Store {result.get('store_id')}"
    target_days = result.get("target_days")
    return {
        "kind": "delivery_plan",
        "title": f"Replenishment Plan — {store} ({target_days}-day cover)",
        "items": [
            {
                "id": str(item.get("sku") or idx),
                "store": store,
                "product": item.get("item_name") or item.get("sku") or "Item",
                "quantity": int(item.get("required_quantity") or 0),
            }
            for idx, item in enumerate(items)
        ],
    }


def run_chat(
    *,
    ai_settings: AISettings,
    history: list[dict[str, str]],
    user_message: str,
    eng: Engine | None = None,
) -> dict[str, Any]:
    """Run one assistant turn (with tool use) and return the reply text plus a
    trace of which tools were called.

    `history` is a list of {"role": "user"|"assistant", "content": str}.
    When `eng` is provided, all tool reads run against it (Local CSV mode);
    otherwise tools follow the active live POS data source.
    """
    api_key = resolve_api_key(ai_settings)
    if not api_key:
        raise ClaudeNotConfigured(
            "No Anthropic API key configured. Add one in Settings → AI "
            "Configuration, or set ANTHROPIC_API_KEY in the backend .env."
        )

    client = anthropic.Anthropic(api_key=api_key)
    system_prompt = build_system_prompt(ai_settings)

    messages: list[dict[str, Any]] = [
        {"role": m["role"], "content": m["content"]} for m in history
    ]
    messages.append({"role": "user", "content": user_message})

    tool_trace: list[dict[str, Any]] = []
    widget: dict[str, Any] | None = None

    for _ in range(MAX_TOOL_ITERATIONS):
        response = client.messages.create(
            model=ai_settings.current_model,
            max_tokens=MAX_TOKENS,
            system=system_prompt,
            tools=TOOL_DEFINITIONS,
            messages=messages,
        )

        if response.stop_reason != "tool_use":
            return {
                "reply": _content_to_text(response.content),
                "tools_used": tool_trace,
                "widget": widget,
            }

        # Echo the assistant's tool-use turn back, then answer each tool call.
        messages.append({"role": "assistant", "content": response.content})
        tool_results = []
        for block in response.content:
            if getattr(block, "type", None) != "tool_use":
                continue
            try:
                result = dispatch_tool(
                    block.name, dict(block.input), settings=ai_settings, eng=eng
                )
                is_error = False
                if block.name == REPLENISHMENT_TOOL:
                    built = _matrix_to_widget(result)
                    if built is not None:
                        widget = built
            except ToolError as exc:
                result = {"error": str(exc)}
                is_error = True
            tool_trace.append({"tool": block.name, "input": block.input})
            tool_results.append(
                {
                    "type": "tool_result",
                    "tool_use_id": block.id,
                    "content": json.dumps(result, default=str),
                    "is_error": is_error,
                }
            )
        messages.append({"role": "user", "content": tool_results})

    # Exhausted the tool-iteration budget — make one final, tool-free request.
    final = client.messages.create(
        model=ai_settings.current_model,
        max_tokens=MAX_TOKENS,
        system=system_prompt,
        messages=messages,
    )
    return {
        "reply": _content_to_text(final.content),
        "tools_used": tool_trace,
        "widget": widget,
        "note": "Tool iteration budget reached.",
    }
