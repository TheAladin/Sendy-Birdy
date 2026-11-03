from collections.abc import Awaitable, Callable

from fastapi import Request, Response

PUBLIC_PREFIX = "/api/public/"
PUBLIC_HEADERS = {
    # Links clicked in a shared message must not tell the other site our URL (it holds the token).
    "Referrer-Policy": "no-referrer",
    # Share links are private, even if one ends up somewhere a search engine looks.
    "X-Robots-Tag": "noindex, nofollow",
}


async def add_public_headers(
    request: Request, call_next: Callable[[Request], Awaitable[Response]]
) -> Response:
    """On every public response, errors included."""
    response = await call_next(request)
    if request.url.path.startswith(PUBLIC_PREFIX):
        response.headers.update(PUBLIC_HEADERS)
        # A share's content and status change (revoked, expired), so nothing may be reused
        # without asking again; files set their own short private cache. "private" keeps CDNs and
        # proxies from keeping a copy after a link is revoked.
        response.headers.setdefault("Cache-Control", "private, no-store")
    return response
