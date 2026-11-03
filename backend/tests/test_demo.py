import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings
from app.services import demo
from app.services.storage import Storage
from app.services.videos import ffmpeg_available

MAX_BYTES = 50 * 1024 * 1024


async def test_seeding_fills_an_empty_library(
    signed_in: AsyncClient, db_session: AsyncSession, settings: Settings
) -> None:
    items = await demo.seed_demo(db_session, Storage(settings.data_dir), MAX_BYTES)

    kinds = [item.kind for item in items]
    assert kinds.count("image") == len(demo.SCREENSHOTS)
    assert kinds.count("note") == len(demo.NOTES)
    assert kinds.count("video") == (1 if ffmpeg_available() else 0)

    listed = (await signed_in.get("/api/items", params={"limit": 100})).json()["items"]
    assert len(listed) == len(items)
    # Spread over time, newest first, and the images went through the real upload pipeline.
    times = [item["created_at"] for item in listed]
    assert times == sorted(times, reverse=True)
    assert len(set(times)) == len(times)
    images = [item for item in listed if item["kind"] == "image"]
    assert all(image["has_thumbnail"] and image["width"] for image in images)
    thumbs = list((settings.data_dir / "media" / "thumbs").glob("*.webp"))
    assert len(thumbs) == len(images) + kinds.count("video")


async def test_seeding_refuses_a_library_that_has_items(
    db_session: AsyncSession, settings: Settings
) -> None:
    storage = Storage(settings.data_dir)
    await demo.seed_demo(db_session, storage, MAX_BYTES)

    with pytest.raises(demo.LibraryNotEmpty):
        await demo.seed_demo(db_session, storage, MAX_BYTES)


@pytest.mark.skipif(not ffmpeg_available(), reason="ffmpeg is not installed")
async def test_the_demo_video_is_a_real_playable_recording() -> None:
    video = await demo.make_walkthrough_video(seconds=1)

    assert video is not None
    assert video[4:8] == b"ftyp"
