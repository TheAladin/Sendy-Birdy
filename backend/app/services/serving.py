"""Sending stored files to the browser, for the admin API and share links alike."""

import logging
from pathlib import Path

import anyio
from fastapi.responses import FileResponse

from app.models import Item
from app.services.storage import Storage

logger = logging.getLogger(__name__)

# If a file URL is opened directly, nothing in it may run or load anything.
FILE_SECURITY_HEADERS = {
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "default-src 'none'; sandbox; frame-ancestors 'none'",
}


def download_name(item: Item) -> str:
    """The current title plus the original extension, e.g. "Checkout v2.png"."""
    suffix = Path(item.original_filename or "").suffix
    return item.title if not suffix or item.title.endswith(suffix) else item.title + suffix


async def original_response(
    item: Item, storage: Storage, *, download: bool, cache_control: str
) -> FileResponse | None:
    """The original file (with Range support, so videos can be seeked), or None if it has none."""
    path = storage.original_path(item.id)
    if item.kind == "note":
        return None
    if not await anyio.Path(path).is_file():
        logger.error("Item %s has no file on disk", item.id)
        return None
    return FileResponse(
        path,
        media_type=item.mime_type,
        filename=download_name(item),
        content_disposition_type="attachment" if download else "inline",
        headers={"Cache-Control": cache_control, **FILE_SECURITY_HEADERS},
    )


async def thumbnail_response(
    item: Item, storage: Storage, *, cache_control: str
) -> FileResponse | None:
    path = storage.thumbnail_path(item.id)
    if not item.has_thumbnail or not await anyio.Path(path).is_file():
        return None
    return FileResponse(
        path,
        media_type="image/webp",
        headers={"Cache-Control": cache_control, **FILE_SECURITY_HEADERS},
    )
