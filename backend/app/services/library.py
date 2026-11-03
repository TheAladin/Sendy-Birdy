"""Adding media to the library: the one pipeline every new image or video goes through."""

from collections.abc import AsyncIterator

import anyio
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Item
from app.services.images import ProcessedImage, process_image
from app.services.storage import Storage, clean_filename, title_from_filename
from app.services.videos import VideoInfo, inspect_video


async def add_media(
    session: AsyncSession,
    storage: Storage,
    chunks: AsyncIterator[bytes],
    filename: str,
    max_bytes: int,
) -> Item:
    """Receive, validate, process and store one upload, and commit its Item.

    Raises the storage errors (UploadTooLarge, UnsupportedFileType, EmptyUpload) and
    InvalidImage; on any failure nothing is left on disk or in the database.
    """
    upload = await storage.receive(chunks, max_bytes)

    image: ProcessedImage | None = None
    video: VideoInfo | None = None
    try:
        if upload.kind == "image":
            # Pillow work is CPU-heavy; a worker thread keeps other requests responsive.
            image = await anyio.to_thread.run_sync(
                process_image, upload.temp_path, upload.mime_type
            )
            if image.rewritten:
                upload = await storage.remeasure(upload)
        else:
            video = await inspect_video(upload.temp_path)
    except BaseException:
        await storage.discard(upload)
        raise

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
    return item
