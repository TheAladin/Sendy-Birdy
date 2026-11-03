from typing import Annotated

import anyio
from fastapi import APIRouter, HTTPException, Query, Request, status

from app.core.deps import CurrentUser, SettingsDep
from app.db.session import SessionDep
from app.models import Item
from app.schemas.items import ItemOut, NoteCreate
from app.services.images import InvalidImage, ProcessedImage, process_image
from app.services.storage import (
    EmptyUpload,
    Storage,
    UnsupportedFileType,
    UploadTooLarge,
    clean_filename,
    title_from_filename,
)
from app.services.videos import VideoInfo, inspect_video

router = APIRouter(prefix="/items", tags=["items"])


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

    storage = Storage(settings.data_dir)
    try:
        upload = await storage.receive(request.stream(), max_bytes)
    except UploadTooLarge:
        raise too_large from None
    except UnsupportedFileType:
        raise HTTPException(status.HTTP_415_UNSUPPORTED_MEDIA_TYPE, UNSUPPORTED_MESSAGE) from None
    except EmptyUpload:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "The file is empty.") from None

    image: ProcessedImage | None = None
    if upload.kind == "image":
        try:
            # Pillow work is CPU-heavy; a worker thread keeps other requests responsive.
            image = await anyio.to_thread.run_sync(
                process_image, upload.temp_path, upload.mime_type
            )
        except InvalidImage as error:
            await storage.discard(upload)
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_CONTENT, IMAGE_ERRORS[str(error)]
            ) from None
        if image.rewritten:
            upload = await storage.remeasure(upload)

    video: VideoInfo | None = None
    if upload.kind == "video":
        video = await inspect_video(upload.temp_path)
    thumbnail = image.thumbnail_webp if image else video.poster_webp if video else None
    details = image or video

    name = clean_filename(filename)
    item = Item(
        kind=upload.kind,
        title=title_from_filename(name),
        original_filename=name,
        mime_type=upload.mime_type,
        size_bytes=upload.size_bytes,
        sha256=upload.sha256,
        width=details.width if details else None,
        height=details.height if details else None,
        duration_s=video.duration_s if video else None,
        has_thumbnail=thumbnail is not None,
    )
    try:
        session.add(item)
        await session.flush()  # assigns item.id
        await storage.keep(upload, item.id)
        if thumbnail:
            await storage.save_thumbnail(item.id, thumbnail)
        await session.commit()
    except BaseException:
        await storage.discard(upload)
        await storage.delete_files(item.id)
        raise
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
