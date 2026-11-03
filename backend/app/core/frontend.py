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


# The only pages clients may open on the public app: /s/<token>.
SHARE_PAGES = frozenset({"s"})


def _is_api(path: str) -> bool:
    return path == "/api" or path.startswith("/api/")


class SinglePageApp(StaticFiles):
    """Static files, with index.html for other paths so the client-side router can handle them.

    `pages` limits that fallback to paths of the form /<section>/<id> for the given sections;
    None means every path.
    """

    def __init__(self, *, directory: Path, pages: frozenset[str] | None = None) -> None:
        super().__init__(directory=directory)
        self.pages = pages

    def _is_page(self, parts: tuple[str, ...]) -> bool:
        if self.pages is None:
            return True
        return len(parts) == 2 and parts[0] in self.pages

    async def get_response(self, path: str, scope: Scope) -> Response:
        parts = Path(path).parts
        hashed = parts[:1] == ("assets",)
        try:
            response = await super().get_response(path, scope)
        except HTTPException as exc:
            # A missing asset is a real 404: answering with HTML would only hide a stale build.
            if exc.status_code != 404 or hashed or not self._is_page(parts):
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


def mount_frontend(app: FastAPI, directory: Path, pages: frozenset[str] | None = None) -> None:
    """Serve the build in `directory`, if there is one. Must run after every API router is added.

    In the public app every file of the build is still served, admin chunks included: they're the
    open-source code, with no data in them, and the share page shares some of them.
    """
    if not (directory / "index.html").is_file():
        # The usual case in development, where Vite serves the frontend.
        logger.info("No frontend build in %s; serving the API only.", directory)
        return
    spa = SinglePageApp(directory=directory, pages=pages)
    app.router.routes.append(FrontendMount("/", app=spa))
