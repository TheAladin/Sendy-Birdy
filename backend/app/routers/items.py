import base64
import logging
import uuid
from datetime import datetime
from pathlib import Path
from typing import Annotated

import anyio
from fastapi import APIRouter, HTTPException, Query, Request, Response, status
from fastapi.responses import FileResponse
from sqlalchemy import delete, select, tuple_

from app.core.deps import CurrentUser, SettingsDep
from app.db.session import SessionDep
from app.models import Item
from app.schemas.items import (
    BulkDelete,
    BulkDeleteResult,
    ItemKind,
    ItemOut,
    ItemPage,
    ItemSummary,
    ItemUpdate,
    NoteCreate,
    UploadLimits,
)
from app.services.images import InvalidImage
from app.services.library import add_media
from app.services.sharing import share_counts
from app.services.storage import (
    ALLOWED_TYPES,
    EmptyUpload,
    Storage,
    UnsupportedFileType,
    UploadTooLarge,
)

router = APIRouter(prefix="/items", tags=["items"])
logger = logging.getLogger(__name__)


IMAGE_ERRORS = {
    "damaged": "This image is damaged or incomplete, so it can't be shown.",
    "too_large": "This image has too many pixels (the limit is 100 megapixels).",
}
UNSUPPORTED_MESSAGE = (
    "Only PNG, JPEG, WebP and GIF images and MP4, WebM and MOV videos can be uploaded."
)


@router.post(
    "",
    status_code=status.HTTP_201_CREATED,
    responses={
        400: {"description": "Empty file"},
        413: {"description": "File too large"},
        415: {"description": "Not an allowed image or video type"},
        422: {"description": "Damaged image, or too many pixels"},
    },
)
async def upload_item(
    request: Request,
    session: SessionDep,
    settings: SettingsDep,
    _user: CurrentUser,
    filename: Annotated[str, Query(min_length=1, max_length=1000)],
) -> ItemOut:
    """Upload one image or video. The request body is the raw file (not a multipart form)."""
    max_bytes = settings.max_upload_mb * 1024 * 1024
    too_large = HTTPException(
        status.HTTP_413_CONTENT_TOO_LARGE, f"Files can be at most {settings.max_upload_mb} MB."
    )
    # Refuse early when the browser already tells us the size; the streaming check below
    # still applies when it doesn't (or lies).
    declared = request.headers.get("content-length")
    if declared and declared.isdigit() and int(declared) > max_bytes:
        raise too_large

    try:
        item = await add_media(
            session, Storage(settings.data_dir), request.stream(), filename, max_bytes
        )
    except UploadTooLarge:
        raise too_large from None
    except UnsupportedFileType:
        raise HTTPException(status.HTTP_415_UNSUPPORTED_MEDIA_TYPE, UNSUPPORTED_MESSAGE) from None
    except EmptyUpload:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "The file is empty.") from None
    except InvalidImage as error:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT, IMAGE_ERRORS[str(error)]
        ) from None
    return ItemOut.model_validate(item)


@router.post(
    "/notes",
    status_code=status.HTTP_201_CREATED,
    responses={413: {"description": "Request too large"}},
)
async def create_note(
    body: NoteCreate,
    session: SessionDep,
    _user: CurrentUser,
) -> ItemOut:
    """Create a Markdown note. Stored in the database; there's no file."""
    note = Item(kind="note", title=body.title, body=body.body)
    session.add(note)
    await session.commit()
    return ItemOut.model_validate(note)


# Listing, editing and deleting.


def _encode_cursor(item: Item) -> str:
    raw = f"{item.created_at.isoformat()}|{item.id}"
    return base64.urlsafe_b64encode(raw.encode()).decode().rstrip("=")


def _decode_cursor(cursor: str) -> tuple[datetime, uuid.UUID]:
    try:
        raw = base64.urlsafe_b64decode(cursor + "=" * (-len(cursor) % 4)).decode()
        created_at, item_id = raw.split("|")
        return datetime.fromisoformat(created_at), uuid.UUID(item_id)
    except ValueError:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Invalid cursor.") from None


def _escape_like(text: str) -> str:
    # In LIKE patterns % and _ are wildcards; a search for "50%" should mean the text "50%".
    return text.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


@router.get("")
async def list_items(
    session: SessionDep,
    _user: CurrentUser,
    kind: ItemKind | None = None,
    q: Annotated[str | None, Query(max_length=200, description="Search in titles")] = None,
    cursor: str | None = None,
    limit: Annotated[int, Query(ge=1, le=100)] = 40,
) -> ItemPage:
    """The library, newest first, a page at a time."""
    query = select(Item).order_by(Item.created_at.desc(), Item.id.desc()).limit(limit + 1)
    if kind:
        query = query.where(Item.kind == kind)
    if q and q.strip():
        query = query.where(Item.title.ilike(f"%{_escape_like(q.strip())}%", escape="\\"))
    if cursor:
        # Keyset pagination: continue strictly after the last item of the previous page, so
        # new uploads between page loads never cause duplicates or skipped items.
        query = query.where(tuple_(Item.created_at, Item.id) < _decode_cursor(cursor))

    rows = list((await session.scalars(query)).all())
    has_more = len(rows) > limit
    page = rows[:limit]
    counts = await share_counts(session, (item.id for item in page))
    return ItemPage(
        items=[
            ItemSummary.model_validate(item).model_copy(
                update={"share_count": counts.get(item.id, 0)}
            )
            for item in page
        ],
        next_cursor=_encode_cursor(page[-1]) if has_more else None,
    )


async def _get_item(session: SessionDep, item_id: uuid.UUID) -> Item:
    item = await session.get(Item, item_id)
    if item is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Item not found.")
    return item


# Declared before "/{item_id}", which would otherwise try to read "upload-limits" as an id.
@router.get("/upload-limits")
async def get_upload_limits(settings: SettingsDep, _user: CurrentUser) -> UploadLimits:
    return UploadLimits(
        max_bytes=settings.max_upload_mb * 1024 * 1024, accepted_types=sorted(ALLOWED_TYPES)
    )


async def _item_out(session: SessionDep, item: Item) -> ItemOut:
    counts = await share_counts(session, [item.id])
    return ItemOut.model_validate(item).model_copy(update={"share_count": counts.get(item.id, 0)})


@router.get("/{item_id}")
async def get_item(item_id: uuid.UUID, session: SessionDep, _user: CurrentUser) -> ItemOut:
    return await _item_out(session, await _get_item(session, item_id))


@router.patch("/{item_id}")
async def update_item(
    item_id: uuid.UUID, changes: ItemUpdate, session: SessionDep, _user: CurrentUser
) -> ItemOut:
    item = await _get_item(session, item_id)
    if changes.body is not None and item.kind != "note":
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Only notes have a body.")
    if changes.title is not None:
        item.title = changes.title
    if changes.body is not None:
        item.body = changes.body
    await session.commit()
    await session.refresh(item)
    return await _item_out(session, item)


async def _delete_files(storage: Storage, item_ids: list[uuid.UUID]) -> None:
    for item_id in item_ids:
        try:
            await storage.delete_files(item_id)
        except OSError:
            # The row is already gone; a leftover file wastes space but harms nothing.
            logger.exception("Could not delete the files of item %s", item_id)


@router.delete("/{item_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_item(
    item_id: uuid.UUID, session: SessionDep, settings: SettingsDep, _user: CurrentUser
) -> Response:
    item = await _get_item(session, item_id)
    await session.delete(item)
    await session.commit()
    # Only after the commit: if it had failed, the item would still exist with its files.
    await _delete_files(Storage(settings.data_dir), [item_id])
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/bulk-delete")
async def bulk_delete_items(
    selection: BulkDelete, session: SessionDep, settings: SettingsDep, _user: CurrentUser
) -> BulkDeleteResult:
    """Delete several items at once. Ids that don't exist are ignored."""
    deleted = list(
        (
            await session.scalars(delete(Item).where(Item.id.in_(selection.ids)).returning(Item.id))
        ).all()
    )
    await session.commit()
    await _delete_files(Storage(settings.data_dir), deleted)
    return BulkDeleteResult(deleted=len(deleted))


# Serving files.

# Content never changes for a given id (renaming only changes the title), so browsers may keep
# it; "private" keeps shared caches and CDNs from storing it.
FILE_CACHE = "private, max-age=31536000, immutable"
# If a file URL is opened directly, nothing in it may run or load anything.
FILE_SECURITY_HEADERS = {
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "default-src 'none'; sandbox",
}


def download_name(item: Item) -> str:
    """The current title plus the original extension, e.g. "Checkout v2.png"."""
    suffix = Path(item.original_filename or "").suffix
    return item.title if not suffix or item.title.endswith(suffix) else item.title + suffix


@router.get(
    "/{item_id}/file",
    response_class=FileResponse,
    responses={200: {"description": "The file itself"}, 206: {"description": "Part of it"}},
)
async def get_item_file(
    item_id: uuid.UUID,
    session: SessionDep,
    settings: SettingsDep,
    _user: CurrentUser,
    download: bool = False,
) -> FileResponse:
    """The original file: shown in the browser, or saved with ?download=1.

    Supports Range requests, so videos can be seeked.
    """
    item = await _get_item(session, item_id)
    path = Storage(settings.data_dir).original_path(item.id)
    if item.kind == "note" or not await anyio.Path(path).is_file():
        if item.kind != "note":
            logger.error("Item %s has no file on disk", item.id)
        raise HTTPException(status.HTTP_404_NOT_FOUND, "This item has no file.")
    return FileResponse(
        path,
        media_type=item.mime_type,
        filename=download_name(item),
        content_disposition_type="attachment" if download else "inline",
        headers={"Cache-Control": FILE_CACHE, **FILE_SECURITY_HEADERS},
    )


@router.get(
    "/{item_id}/thumbnail",
    response_class=FileResponse,
    responses={200: {"description": "A WebP preview, at most 640x640"}},
)
async def get_item_thumbnail(
    item_id: uuid.UUID, session: SessionDep, settings: SettingsDep, _user: CurrentUser
) -> FileResponse:
    item = await _get_item(session, item_id)
    path = Storage(settings.data_dir).thumbnail_path(item.id)
    if not item.has_thumbnail or not await anyio.Path(path).is_file():
        raise HTTPException(status.HTTP_404_NOT_FOUND, "This item has no thumbnail.")
    return FileResponse(
        path,
        media_type="image/webp",
        headers={"Cache-Control": FILE_CACHE, **FILE_SECURITY_HEADERS},
    )
