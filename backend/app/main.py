"""Builds the FastAPI application."""

from fastapi import FastAPI

from app.core.config import Settings, get_settings
from app.routers import health


def create_app(settings: Settings | None = None) -> FastAPI:
    """Create the app, loading settings from the environment unless they're passed in.

    Loading settings here means a missing or invalid one stops startup right away.
    """
    if settings is None:
        settings = get_settings()

    app = FastAPI(
        title="Sendy Birdy",
        version="0.1.0",
        # Everything server-side lives under /api; the frontend owns all other paths.
        docs_url="/api/docs",
        redoc_url=None,
        openapi_url="/api/openapi.json",
    )
    app.state.settings = settings
    app.include_router(health.router, prefix="/api")
    return app
