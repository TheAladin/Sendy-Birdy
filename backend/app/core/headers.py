"""Security headers on every response: pages, API answers, files and errors alike."""

from starlette.datastructures import MutableHeaders
from starlette.types import ASGIApp, Message, Receive, Scope, Send

# The app: everything from our own origin, nothing inline (theme-init.js is a file for this
# reason), no plugins, and no <base> tag that could re-point relative URLs. Images in notes are
# links rather than <img>, so a note can't load anything from another site either.
APP_POLICY = (
    "default-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; "
    "frame-ancestors 'none'"
)

# JSON never needs to load anything. If a browser were ever tricked into rendering it as a page,
# this keeps it inert.
API_POLICY = "default-src 'none'; frame-ancestors 'none'"

# FastAPI's Swagger page pulls its code from a CDN and starts it with an inline script. It's
# admin-only, contains no user content, and doesn't exist in the public app.
DOCS_POLICY = (
    "default-src 'none'; script-src https://cdn.jsdelivr.net 'unsafe-inline'; "
    "style-src https://cdn.jsdelivr.net; img-src 'self' data: https://fastapi.tiangolo.com; "
    "connect-src 'self'; base-uri 'none'; frame-ancestors 'none'"
)
DOCS_PREFIX = "/api/docs"

COMMON_HEADERS = {
    "X-Content-Type-Options": "nosniff",
    # Share URLs hold their token: never pass them on to another site.
    "Referrer-Policy": "no-referrer",
    # Nothing here needs these; turning them off means injected code couldn't use them either.
    "Permissions-Policy": (
        "camera=(), microphone=(), geolocation=(), payment=(), usb=(), display-capture=()"
    ),
    # Another site can't get a handle on our window, nor embed our files and media in its pages.
    "Cross-Origin-Opener-Policy": "same-origin",
    "Cross-Origin-Resource-Policy": "same-origin",
}

# A year, renewed on every visit. Browsers ignore HSTS over plain http, and so do we.
HSTS = "max-age=31536000"


def content_security_policy(path: str) -> str:
    if path == DOCS_PREFIX or path.startswith(DOCS_PREFIX + "/"):
        return DOCS_POLICY
    if path == "/api" or path.startswith("/api/"):
        return API_POLICY
    return APP_POLICY


class SecurityHeaders:
    """Adds the headers without overriding any a route set itself (files keep their sandbox)."""

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        policy = content_security_policy(scope["path"])
        # uvicorn sets the scheme from X-Forwarded-Proto when the tunnel (on localhost) connects.
        https = scope["scheme"] == "https"

        async def send_with_headers(message: Message) -> None:
            if message["type"] == "http.response.start":
                headers = MutableHeaders(scope=message)
                headers.setdefault("Content-Security-Policy", policy)
                for name, value in COMMON_HEADERS.items():
                    headers.setdefault(name, value)
                if https:
                    headers.setdefault("Strict-Transport-Security", HSTS)
            await send(message)

        await self.app(scope, receive, send_with_headers)
