"""Builds the FastAPI application."""

import asyncio
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager, suppress

from fastapi import FastAPI

from app.core.config import Settings, get_settings
from app.core.csrf import require_csrf_header
from app.core.limits import LimitJsonBody
from app.core.public import add_public_headers
from app.db.session import create_engine, create_sessionmaker
from app.routers import activity, auth, health, items, public, shares
from app.services.activity import cleanup_daily


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    cleanup = asyncio.create_task(cleanup_daily(app))
    yield
    cleanup.cancel()
    with suppress(asyncio.CancelledError):
        await cleanup
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
    app.middleware("http")(add_public_headers)
    app.add_middleware(LimitJsonBody)
    app.include_router(health.router, prefix="/api")
    app.include_router(auth.router, prefix="/api")
    app.include_router(items.router, prefix="/api")
    app.include_router(shares.router, prefix="/api")
    app.include_router(public.router, prefix="/api")
    app.include_router(activity.router, prefix="/api")
    return app
