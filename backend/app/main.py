"""Builds the FastAPI application."""

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI

from app.core.config import Settings, get_settings
from app.core.csrf import require_csrf_header
from app.db.session import create_engine, create_sessionmaker
from app.routers import auth, health


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    yield
    await app.state.engine.dispose()


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
        lifespan=lifespan,
    )
    app.state.settings = settings
    # The engine connects lazily, on the first query, so creating it here is cheap.
    app.state.engine = create_engine(settings.database_url.get_secret_value())
    app.state.sessionmaker = create_sessionmaker(app.state.engine)
    app.middleware("http")(require_csrf_header)
    app.include_router(health.router, prefix="/api")
    app.include_router(auth.router, prefix="/api")
    return app
