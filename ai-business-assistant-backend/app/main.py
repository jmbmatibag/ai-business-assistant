"""FastAPI application entry point."""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.auth import router as auth_router
from app.api.ai_settings import router as ai_settings_router
from app.api.analytics import router as analytics_router
from app.api.chat import router as chat_router
from app.api.data import router as data_router
from app.api.data_sources import router as data_sources_router
from app.api.inventory import router as inventory_router
from app.api.notifications import router as notifications_router

app = FastAPI(title="AI Business Assistant API", version="0.2.0")

# Allow the Vite dev server (and previews) to call the API during development.
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:4173",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/health", tags=["health"])
def health() -> dict[str, str]:
    return {"status": "ok"}


app.include_router(auth_router)
app.include_router(ai_settings_router)
app.include_router(chat_router)
app.include_router(notifications_router)
app.include_router(inventory_router)
app.include_router(analytics_router)
app.include_router(data_sources_router)
app.include_router(data_router)
