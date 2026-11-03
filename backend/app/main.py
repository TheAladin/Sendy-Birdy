"""Builds the FastAPI application."""

import asyncio
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager, suppress

from fastapi import FastAPI

from app.core.config import Settings, get_settings
from app.core.csrf import require_csrf_header
from app.core.frontend import SHARE_PAGES, mount_frontend
from app.core.headers import SecurityHeaders
from app.core.limits import LimitJsonBody
from app.core.public import add_public_headers
from app.core.ratelimit import RateLimits
from app.db.session import create_engine, create_sessionmaker
from app.routers import activity, auth, health, items, public, shares
from app.services.activity import cleanup_daily


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    # Both processes share one database, so one cleaner is enough: the admin one, which always runs.
    cleanup = None
    if app.state.settings.app_mode == "admin":
        cleanup = asyncio.create_task(cleanup_daily(app))
    yield
    if cleanup is not None:
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
    admin = settings.app_mode == "admin"

    app = FastAPI(
        title="Sendy Birdy",
        version="0.1.0",
        # Everything server-side lives under /api; the frontend owns all other paths. The public
        # app publishes no schema: there's no reason to hand visitors a map of the admin API.
        docs_url="/api/docs" if admin else None,
        swagger_ui_oauth2_redirect_url="/api/docs/oauth2-redirect",
        redoc_url=None,
        openapi_url="/api/openapi.json" if admin else None,
        lifespan=lifespan,
    )
    app.state.settings = settings
    app.state.rate_limits = RateLimits()
    # The engine connects lazily, on the first query, so creating it here is cheap.
    app.state.engine = create_engine(settings.database_url.get_secret_value())
    app.state.sessionmaker = create_sessionmaker(app.state.engine)
    app.middleware("http")(require_csrf_header)
    app.middleware("http")(add_public_headers)
    app.add_middleware(LimitJsonBody)
    # Added last, so it runs outermost: even a refused request (403, 413) gets the headers.
    app.add_middleware(SecurityHeaders)
    # Admin routes aren't hidden in public mode, they're never added: nothing to misconfigure.
    if admin:
        app.include_router(health.router, prefix="/api")
        app.include_router(auth.router, prefix="/api")
        app.include_router(items.router, prefix="/api")
        app.include_router(shares.router, prefix="/api")
        app.include_router(activity.router, prefix="/api")
    app.include_router(public.router, prefix="/api")
    # Last, so it only gets the paths no API route matched.
    mount_frontend(app, settings.frontend_dir, pages=None if admin else SHARE_PAGES)
    return app
