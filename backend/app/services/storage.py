"""Where uploaded files live on disk, and how they get there safely."""

import dataclasses
import hashlib
import uuid
from collections.abc import AsyncIterator
from dataclasses import dataclass
from pathlib import Path, PurePosixPath, PureWindowsPath

import anyio
import filetype

# Only formats browsers display natively. Everything else, including SVG and HTML (which can
# carry scripts), is refused.
ALLOWED_TYPES = {
    "image/png": "image",
    "image/jpeg": "image",
    "image/webp": "image",
    "image/gif": "image",
    "video/mp4": "video",
    "video/webm": "video",
    "video/quicktime": "video",
}
# filetype needs at most this many leading bytes to recognize a format.
SNIFF_BYTES = 262


class UploadTooLarge(Exception):
    pass


class UnsupportedFileType(Exception):
    pass


class EmptyUpload(Exception):
    pass


@dataclass(frozen=True)
class StoredUpload:
    """A validated upload waiting in the temporary folder until it's given its final name."""

    temp_path: Path
    mime_type: str
    kind: str
    size_bytes: int
    sha256: str


class Storage:
    def __init__(self, data_dir: Path) -> None:
        self.originals = data_dir / "media" / "originals"
        self.thumbs = data_dir / "media" / "thumbs"
        # Same filesystem as the final folder, so moving a finished upload is atomic.
        self.incoming = data_dir / "media" / "incoming"

    def original_path(self, item_id: uuid.UUID) -> Path:
        return self.originals / str(item_id)

    def thumbnail_path(self, item_id: uuid.UUID) -> Path:
        return self.thumbs / f"{item_id}.webp"

    async def receive(self, chunks: AsyncIterator[bytes], max_bytes: int) -> StoredUpload:
        """Stream an upload to a temporary file, enforcing the size limit and checking its type.

        On any failure the temporary file is deleted.
        """
        for folder in (self.incoming, self.originals, self.thumbs):
            await anyio.Path(folder).mkdir(parents=True, exist_ok=True)
        temp_path = self.incoming / f"{uuid.uuid4()}.part"
        digest = hashlib.sha256()
        head = b""
        size = 0
        try:
            async with await anyio.open_file(temp_path, "wb") as file:
                async for chunk in chunks:
                    size += len(chunk)
                    if size > max_bytes:
                        raise UploadTooLarge
                    if len(head) < SNIFF_BYTES:
                        head += chunk[: SNIFF_BYTES - len(head)]
                    digest.update(chunk)
                    await file.write(chunk)
            if size == 0:
                raise EmptyUpload
            guess = filetype.guess(head)
            if guess is None or guess.mime not in ALLOWED_TYPES:
                raise UnsupportedFileType
        except BaseException:
            await anyio.Path(temp_path).unlink(missing_ok=True)
            raise
        return StoredUpload(
            temp_path=temp_path,
            mime_type=guess.mime,
            kind=ALLOWED_TYPES[guess.mime],
            size_bytes=size,
            sha256=digest.hexdigest(),
        )

    async def remeasure(self, upload: StoredUpload) -> StoredUpload:
        """Size and hash again, after the file was rewritten (e.g. metadata stripped)."""
        digest = hashlib.sha256()
        size = 0
        async with await anyio.open_file(upload.temp_path, "rb") as file:
            while chunk := await file.read(1024 * 1024):
                digest.update(chunk)
                size += len(chunk)
        return dataclasses.replace(upload, size_bytes=size, sha256=digest.hexdigest())

    async def save_thumbnail(self, item_id: uuid.UUID, webp: bytes) -> None:
        async with await anyio.open_file(self.thumbnail_path(item_id), "wb") as file:
            await file.write(webp)

    async def keep(self, upload: StoredUpload, item_id: uuid.UUID) -> Path:
        destination = self.original_path(item_id)
        await anyio.Path(upload.temp_path).rename(destination)
        return destination

    async def discard(self, upload: StoredUpload) -> None:
        await anyio.Path(upload.temp_path).unlink(missing_ok=True)

    async def delete_files(self, item_id: uuid.UUID) -> None:
        await anyio.Path(self.original_path(item_id)).unlink(missing_ok=True)
        await anyio.Path(self.thumbnail_path(item_id)).unlink(missing_ok=True)


def clean_filename(name: str) -> str:
    """The last part of a path a browser sent, e.g. "C:\\fakepath\\shot.png" -> "shot.png".

    Only ever used for display and download names; files on disk are named by id.
    """
    name = PureWindowsPath(PurePosixPath(name).name).name.strip()
    return name[:255] or "upload"


def title_from_filename(name: str) -> str:
    stem = PurePosixPath(name).stem.strip()
    return (stem or name)[:200]
