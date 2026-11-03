"""Serves the built frontend (frontend/dist) so production needs no separate web server."""

import logging
from pathlib import Path

from fastapi import FastAPI
from starlette.exceptions import HTTPException
from starlette.responses import Response
from starlette.routing import Match, Mount
from starlette.staticfiles import StaticFiles
from starlette.types import Scope

logger = logging.getLogger(__name__)

# Vite puts a content hash in every file name under assets/, so a name never changes meaning.
IMMUTABLE = "public, max-age=31536000, immutable"
# index.html and the unhashed files in public/ must be checked on every load, or a browser could
# keep running an old build that asks for assets which no longer exist.
REVALIDATE = "no-cache"


def _is_api(path: str) -> bool:
    return path == "/api" or path.startswith("/api/")


class SinglePageApp(StaticFiles):
    """Static files, with index.html for any other path so the client-side router can handle it."""

    async def get_response(self, path: str, scope: Scope) -> Response:
        hashed = Path(path).parts[:1] == ("assets",)
        try:
            response = await super().get_response(path, scope)
        except HTTPException as exc:
            # A missing asset is a real 404: answering with HTML would only hide a stale build.
            if exc.status_code != 404 or hashed:
                raise
            response = await super().get_response("index.html", scope)
            hashed = False
        response.headers["Cache-Control"] = IMMUTABLE if hashed else REVALIDATE
        return response


class FrontendMount(Mount):
    """A mount at the root that leaves every /api path alone, so unknown API URLs still get the
    API's own 404 (or 405) instead of the app's HTML."""

    def matches(self, scope: Scope) -> tuple[Match, Scope]:
        if scope["type"] == "http" and _is_api(scope["path"]):
            return Match.NONE, {}
        return super().matches(scope)


def mount_frontend(app: FastAPI, directory: Path) -> None:
    """Serve the build in `directory`, if there is one. Must run after every API router is added."""
    if not (directory / "index.html").is_file():
        # The usual case in development, where Vite serves the frontend.
        logger.info("No frontend build in %s; serving the API only.", directory)
        return
    app.router.routes.append(FrontendMount("/", app=SinglePageApp(directory=directory)))
