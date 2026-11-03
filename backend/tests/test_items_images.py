import hashlib
from pathlib import Path

import pytest
from httpx import AsyncClient
from PIL import Image
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings
from app.models import Item
from tests import media


async def upload(client: AsyncClient, data: bytes, filename: str):
    return await client.post("/api/items", params={"filename": filename}, content=data)


def original(settings: Settings, item_id: str) -> Path:
    return settings.data_dir / "media" / "originals" / item_id


def thumbnail(settings: Settings, item_id: str) -> Path:
    return settings.data_dir / "media" / "thumbs" / f"{item_id}.webp"


def close_to(pixel: tuple[int, ...], color: tuple[int, int, int]) -> bool:
    return all(abs(a - b) < 40 for a, b in zip(pixel, color, strict=False))


async def test_a_sideways_photo_with_gps_is_turned_upright_and_stripped(
    signed_in: AsyncClient, settings: Settings
) -> None:
    # Stored 40x20 with the left half red, plus "rotate 90° clockwise" and GPS in its EXIF.
    photo = media.jpeg(orientation=6, gps=True)

    response = await upload(signed_in, photo, "beach.jpg")

    assert response.status_code == 201
    assert (response.json()["width"], response.json()["height"]) == (20, 40)
    stored = original(settings, response.json()["id"]).read_bytes()
    assert b"Exif\x00\x00" not in stored
    with Image.open(original(settings, response.json()["id"])) as image:
        assert image.size == (20, 40)
        assert not image.getexif()
        # Rotated clockwise, the red left half is now on top.
        assert close_to(image.getpixel((10, 5)), media.RED)
        assert close_to(image.getpixel((10, 35)), media.BLUE)


async def test_size_and_hash_describe_the_cleaned_file(
    signed_in: AsyncClient, settings: Settings, db_session: AsyncSession
) -> None:
    response = await upload(signed_in, media.jpeg(gps=True), "photo.jpg")

    stored = original(settings, response.json()["id"]).read_bytes()
    item = await db_session.get(Item, response.json()["id"])
    assert item is not None
    assert item.size_bytes == len(stored) == response.json()["size_bytes"]
    assert item.sha256 == hashlib.sha256(stored).hexdigest()


async def test_a_clean_jpeg_is_kept_exactly_as_uploaded(
    signed_in: AsyncClient, settings: Settings
) -> None:
    clean = media.jpeg()

    response = await upload(signed_in, clean, "screenshot.jpg")

    assert original(settings, response.json()["id"]).read_bytes() == clean


async def test_the_color_profile_survives_stripping(
    signed_in: AsyncClient, settings: Settings
) -> None:
    response = await upload(signed_in, media.jpeg(gps=True, icc=True), "photo.jpg")

    with Image.open(original(settings, response.json()["id"])) as image:
        assert image.info.get("icc_profile")
        assert not image.getexif()


async def test_text_metadata_is_removed_from_pngs(
    signed_in: AsyncClient, settings: Settings
) -> None:
    tagged = media.png(text={"Location": "48.85N 2.29E", "Author": "Alex"})

    response = await upload(signed_in, tagged, "map.png")

    stored = original(settings, response.json()["id"]).read_bytes()
    assert b"48.85N" not in stored
    assert b"Alex" not in stored


async def test_every_image_gets_a_small_webp_thumbnail(
    signed_in: AsyncClient, settings: Settings
) -> None:
    response = await upload(signed_in, media.png(2000, 1000), "wide.png")

    with Image.open(thumbnail(settings, response.json()["id"])) as thumb:
        assert thumb.format == "WEBP"
        assert thumb.size == (640, 320)
    assert (response.json()["width"], response.json()["height"]) == (2000, 1000)


async def test_small_images_are_not_enlarged_for_the_thumbnail(
    signed_in: AsyncClient, settings: Settings
) -> None:
    response = await upload(signed_in, media.png(100, 60), "icon.png")

    with Image.open(thumbnail(settings, response.json()["id"])) as thumb:
        assert thumb.size == (100, 60)


async def test_animated_gifs_are_kept_untouched_with_a_first_frame_thumbnail(
    signed_in: AsyncClient, settings: Settings
) -> None:
    gif = media.animated_gif(frames=3, size=(30, 20))

    response = await upload(signed_in, gif, "loading.gif")

    assert response.status_code == 201
    assert original(settings, response.json()["id"]).read_bytes() == gif
    assert (response.json()["width"], response.json()["height"]) == (30, 20)
    assert thumbnail(settings, response.json()["id"]).exists()


def stored_files(settings: Settings) -> list[Path]:
    media_dir = settings.data_dir / "media"
    return [path for path in media_dir.rglob("*") if path.is_file()] if media_dir.exists() else []


@pytest.mark.parametrize(
    ("data", "message"),
    [
        (media.png()[:60], "damaged or incomplete"),
        (media.png_claiming_size(20_000, 20_000), "too many pixels"),
        # Between 1x and 2x the limit Pillow only warns; that must be a refusal too.
        (media.png_claiming_size(12_000, 12_000), "too many pixels"),
    ],
    ids=["truncated", "decompression-bomb", "just-over-the-limit"],
)
async def test_damaged_and_oversized_images_are_refused(
    signed_in: AsyncClient,
    settings: Settings,
    db_session: AsyncSession,
    data: bytes,
    message: str,
) -> None:
    response = await upload(signed_in, data, "broken.png")

    assert response.status_code == 422
    assert message in response.json()["detail"]
    assert stored_files(settings) == []
    assert await db_session.scalar(select(func.count()).select_from(Item)) == 0
