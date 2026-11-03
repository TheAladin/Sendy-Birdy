"""A size limit for JSON request bodies, enforced before FastAPI reads them into memory."""

import json

from starlette.types import ASGIApp, Message, Receive, Scope, Send

MAX_JSON_BYTES = 1024 * 1024


class LimitJsonBody:
    """Refuses JSON requests over a size limit with 413.

    FastAPI reads the whole body before validation or dependencies run, so the limit has to
    live here. Raw file uploads aren't JSON and keep their own streaming limit.
    """

    def __init__(self, app: ASGIApp, max_bytes: int = MAX_JSON_BYTES) -> None:
        self.app = app
        self.max_bytes = max_bytes

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http" or not self._is_json(scope):
            await self.app(scope, receive, send)
            return

        declared = dict(scope["headers"]).get(b"content-length", b"")
        if declared.isdigit() and int(declared) > self.max_bytes:
            await self._refuse(send)
            return

        # Read at most max_bytes, counting as we go (the declared length may be absent or false).
        messages: list[Message] = []
        size = 0
        while True:
            message = await receive()
            messages.append(message)
            if message["type"] != "http.request":
                break
            size += len(message.get("body", b""))
            if size > self.max_bytes:
                await self._refuse(send)
                return
            if not message.get("more_body", False):
                break

        async def replay() -> Message:
            return messages.pop(0) if messages else await receive()

        await self.app(scope, replay, send)

    @staticmethod
    def _is_json(scope: Scope) -> bool:
        content_type = dict(scope["headers"]).get(b"content-type", b"").lower()
        return content_type.split(b";")[0].strip() == b"application/json"

    async def _refuse(self, send: Send) -> None:
        body = json.dumps({"detail": "The request is too large."}).encode()
        await send(
            {
                "type": "http.response.start",
                "status": 413,
                "headers": [
                    (b"content-type", b"application/json"),
                    (b"content-length", str(len(body)).encode()),
                ],
            }
        )
        await send({"type": "http.response.body", "body": body})
