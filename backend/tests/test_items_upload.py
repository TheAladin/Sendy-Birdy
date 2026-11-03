import hashlib
from pathlib import Path

import pytest
from httpx import AsyncClient
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings
from app.models import Item
from tests import media

PNG = media.png()
MP4 = b"\x00\x00\x00\x18ftypmp42" + b"\x00" * 200
MOV = b"\x00\x00\x00\x14ftypqt  " + b"\x00" * 200
HTML = b"<!doctype html><html><script>alert(document.cookie)</script></html>"
SVG = b'<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'
PDF = b"%PDF-1.7\n" + b"\x00" * 200


async def upload(client: AsyncClient, data: bytes, filename: str, **headers: str):
    return await client.post(
        "/api/items", params={"filename": filename}, content=data, headers=headers
    )


def stored_files(settings: Settings) -> list[Path]:
    media = settings.data_dir / "media"
    return sorted(path for path in media.rglob("*") if path.is_file()) if media.exists() else []


async def item_count(db_session: AsyncSession) -> int:
    return await db_session.scalar(select(func.count()).select_from(Item)) or 0


async def test_uploading_an_image_stores_it_under_its_id(
    signed_in: AsyncClient, settings: Settings
) -> None:
    # The browser's claimed type is ignored; the content decides.
    response = await upload(signed_in, PNG, "Hero shot.png", **{"Content-Type": "text/html"})

    assert response.status_code == 201
    body = response.json()
    assert body["kind"] == "image"
    assert body["mime_type"] == "image/png"
    assert body["title"] == "Hero shot"
    assert body["original_filename"] == "Hero shot.png"
    stored = settings.data_dir / "media" / "originals" / body["id"]
    thumb = settings.data_dir / "media" / "thumbs" / f"{body['id']}.webp"
    assert stored_files(settings) == sorted([stored, thumb])
    assert body["size_bytes"] == stored.stat().st_size


async def test_the_content_hash_is_recorded(
    signed_in: AsyncClient, db_session: AsyncSession
) -> None:
    response = await upload(signed_in, MP4, "demo.mp4")

    item = await db_session.get(Item, response.json()["id"])
    assert item is not None
    assert item.sha256 == hashlib.sha256(MP4).hexdigest()


@pytest.mark.parametrize(
    ("data", "filename", "mime"),
    [(MP4, "demo.mp4", "video/mp4"), (MOV, "screen recording.mov", "video/quicktime")],
)
async def test_videos_are_accepted(
    signed_in: AsyncClient, data: bytes, filename: str, mime: str
) -> None:
    response = await upload(signed_in, data, filename)

    assert response.status_code == 201
    assert (response.json()["kind"], response.json()["mime_type"]) == ("video", mime)


@pytest.mark.parametrize(
    ("data", "filename"),
    [(HTML, "innocent.png"), (SVG, "logo.svg"), (PDF, "invoice.pdf")],
    ids=["html-renamed-to-png", "svg", "pdf"],
)
async def test_other_file_types_are_refused_and_nothing_is_kept(
    signed_in: AsyncClient,
    settings: Settings,
    db_session: AsyncSession,
    data: bytes,
    filename: str,
) -> None:
    response = await upload(signed_in, data, filename)

    assert response.status_code == 415
    assert "PNG, JPEG, WebP and GIF" in response.json()["detail"]
    assert stored_files(settings) == []
    assert await item_count(db_session) == 0


@pytest.fixture
def small_limit(settings: Settings) -> Settings:
    settings.max_upload_mb = 1
    return settings


async def test_oversized_uploads_are_stopped_while_streaming(
    signed_in: AsyncClient, small_limit: Settings, db_session: AsyncSession
) -> None:
    too_big = PNG + b"\x00" * (1024 * 1024)

    async def chunks():
        # No Content-Length header: the limit has to be enforced while reading.
        for start in range(0, len(too_big), 64 * 1024):
            yield too_big[start : start + 64 * 1024]

    response = await signed_in.post("/api/items", params={"filename": "big.png"}, content=chunks())

    assert response.status_code == 413
    assert response.json()["detail"] == "Files can be at most 1 MB."
    assert stored_files(small_limit) == []
    assert await item_count(db_session) == 0


async def test_an_oversized_declared_length_is_refused_before_reading(
    signed_in: AsyncClient, small_limit: Settings
) -> None:
    response = await upload(signed_in, PNG + b"\x00" * (1024 * 1024), "big.png")

    assert response.status_code == 413
    assert stored_files(small_limit) == []


async def test_an_upload_at_exactly_the_limit_is_accepted(
    signed_in: AsyncClient, small_limit: Settings
) -> None:
    exactly = PNG + b"\x00" * (1024 * 1024 - len(PNG))

    response = await upload(signed_in, exactly, "edge.png")

    assert response.status_code == 201


async def test_empty_files_are_refused(signed_in: AsyncClient, settings: Settings) -> None:
    response = await upload(signed_in, b"", "empty.png")

    assert response.status_code == 400
    assert stored_files(settings) == []


async def test_paths_in_the_filename_are_ignored(signed_in: AsyncClient) -> None:
    response = await upload(signed_in, PNG, "../../etc/passwd.png")
    windows = await upload(signed_in, PNG, "C:\\fakepath\\shot.png")

    assert response.json()["original_filename"] == "passwd.png"
    assert windows.json()["original_filename"] == "shot.png"


async def test_a_filename_is_required(signed_in: AsyncClient) -> None:
    response = await signed_in.post("/api/items", content=PNG)

    assert response.status_code == 422


async def test_uploading_requires_signing_in(
    client: AsyncClient, settings: Settings, db_session: AsyncSession
) -> None:
    response = await upload(client, PNG, "hero.png")

    assert response.status_code == 401
    assert stored_files(settings) == []
    assert await item_count(db_session) == 0


async def test_upload_limits_tell_the_browser_what_is_accepted(
    signed_in: AsyncClient, small_limit: Settings
) -> None:
    response = await signed_in.get("/api/items/upload-limits")

    assert response.json() == {
        "max_bytes": 1024 * 1024,
        "accepted_types": [
            "image/gif",
            "image/jpeg",
            "image/png",
            "image/webp",
            "video/mp4",
            "video/quicktime",
            "video/webm",
        ],
    }
