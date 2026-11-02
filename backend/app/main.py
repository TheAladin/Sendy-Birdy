"""Builds the FastAPI application."""

from fastapi import FastAPI

from app.core.config import get_settings
from app.routers import health


def create_app() -> FastAPI:
    """Create and configure the FastAPI application."""
    # Load settings first, so a missing or invalid setting (such as SECRET_KEY) stops startup right away.
    get_settings()

    app = FastAPI(
        title="Sendy Birdy",
        version="0.1.0",
        # Every backend URL lives under /api, which leaves all other paths to the frontend.
        docs_url="/api/docs",
        redoc_url=None,
        openapi_url="/api/openapi.json",
    )
    app.include_router(health.router, prefix="/api")
    return app


app = create_app()
