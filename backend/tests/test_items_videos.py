import shutil
import subprocess
from pathlib import Path

import pytest
from httpx import AsyncClient
from PIL import Image

from app.core.config import Settings
from app.services import videos

requires_ffmpeg = pytest.mark.skipif(
    not videos.ffmpeg_available(), reason="ffmpeg and ffprobe are not installed"
)


def make_video(folder: Path, name: str, *extra: str, codec: str = "libx264") -> bytes:
    """A 2-second 320x240 test pattern, built with ffmpeg."""
    plain = folder / f"plain-{name}"
    ffmpeg = shutil.which("ffmpeg") or "ffmpeg"
    subprocess.run(  # noqa: S603 (fixed arguments, test-only)
        [ffmpeg, "-v", "error", "-y", "-f", "lavfi", "-i", "testsrc=size=320x240:rate=10",
         "-t", "2", "-pix_fmt", "yuv420p", "-c:v", codec, str(plain)],
        check=True,
    )  # fmt: skip
    if not extra:
        return plain.read_bytes()
    final = folder / name
    subprocess.run(  # noqa: S603 (fixed arguments, test-only)
        [ffmpeg, "-v", "error", "-y", *extra, "-i", str(plain), "-c", "copy", str(final)],
        check=True,
    )
    return final.read_bytes()


async def upload(client: AsyncClient, data: bytes, filename: str):
    return await client.post("/api/items", params={"filename": filename}, content=data)


def thumbnail(settings: Settings, item_id: str) -> Path:
    return settings.data_dir / "media" / "thumbs" / f"{item_id}.webp"


@requires_ffmpeg
async def test_videos_get_a_poster_duration_and_size(
    signed_in: AsyncClient, settings: Settings, tmp_path: Path
) -> None:
    response = await upload(signed_in, make_video(tmp_path, "demo.mp4"), "demo.mp4")

    body = response.json()
    assert response.status_code == 201
    assert (body["width"], body["height"]) == (320, 240)
    assert body["duration_s"] == pytest.approx(2.0, abs=0.1)
    assert body["has_thumbnail"] is True
    with Image.open(thumbnail(settings, body["id"])) as poster:
        assert poster.format == "WEBP"
        assert poster.size == (320, 240)


@requires_ffmpeg
async def test_a_rotated_phone_video_reports_its_upright_size(
    signed_in: AsyncClient, settings: Settings, tmp_path: Path
) -> None:
    rotated = make_video(tmp_path, "portrait.mp4", "-display_rotation", "90")

    response = await upload(signed_in, rotated, "portrait.mp4")

    body = response.json()
    assert (body["width"], body["height"]) == (240, 320)
    with Image.open(thumbnail(settings, body["id"])) as poster:
        assert poster.size == (240, 320)


@requires_ffmpeg
async def test_webm_videos_work_too(signed_in: AsyncClient, tmp_path: Path) -> None:
    webm = make_video(tmp_path, "clip.webm", codec="libvpx-vp9")

    response = await upload(signed_in, webm, "clip.webm")

    assert response.json()["mime_type"] == "video/webm"
    assert response.json()["has_thumbnail"] is True


async def test_an_unreadable_video_is_kept_without_a_poster(
    signed_in: AsyncClient, settings: Settings
) -> None:
    # Passes the type check (MP4 header) but isn't a real video.
    fake = b"\x00\x00\x00\x18ftypmp42" + b"\x00" * 200

    response = await upload(signed_in, fake, "broken.mp4")

    body = response.json()
    assert response.status_code == 201
    assert body["has_thumbnail"] is False
    assert (body["width"], body["height"], body["duration_s"]) == (None, None, None)
    assert not thumbnail(settings, body["id"]).exists()


async def test_without_ffmpeg_videos_are_accepted_without_a_poster(
    signed_in: AsyncClient, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    monkeypatch.setattr(videos.shutil, "which", lambda _name: None)
    data = (
        make_video(tmp_path, "demo.mp4")
        if shutil.which("ffmpeg")
        else (b"\x00\x00\x00\x18ftypmp42" + b"\x00" * 200)
    )

    response = await upload(signed_in, data, "demo.mp4")

    assert response.status_code == 201
    assert response.json()["has_thumbnail"] is False


async def test_images_always_have_a_thumbnail(signed_in: AsyncClient) -> None:
    from tests import media

    response = await upload(signed_in, media.png(), "shot.png")

    assert response.json()["has_thumbnail"] is True
