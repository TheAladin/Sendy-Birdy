from collections.abc import Awaitable, Callable

from fastapi import Request, Response
from fastapi.responses import JSONResponse

UNSAFE_METHODS = {"POST", "PUT", "PATCH", "DELETE"}
CSRF_HEADER = "X-Requested-With"


async def require_csrf_header(
    request: Request, call_next: Callable[[Request], Awaitable[Response]]
) -> Response:
    # Other sites can make a browser send our cookie with a form post, but they can't add custom
    # headers without a CORS preflight, which we never allow. So a request that changes data
    # must carry this header to prove it came from our own frontend.
    if request.method in UNSAFE_METHODS and CSRF_HEADER not in request.headers:
        return JSONResponse({"detail": f"Missing {CSRF_HEADER} header"}, status_code=403)
    return await call_next(request)
