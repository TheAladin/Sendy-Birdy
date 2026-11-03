"""Video details and poster frames, using ffprobe and ffmpeg when they're installed.

Everything here is best-effort: without ffmpeg, or for a file it can't read, the video is still
accepted, just without a poster or duration.
"""

import asyncio
import io
import json
import logging
import shutil
from dataclasses import dataclass
from pathlib import Path

from PIL import Image

from app.services.images import THUMBNAIL_BOX

logger = logging.getLogger(__name__)

TIMEOUT_SECONDS = 30
# Read only the local file: a crafted video can't make ffmpeg fetch URLs or other files.
LOCAL_ONLY = ["-protocol_whitelist", "file"]


@dataclass(frozen=True)
class VideoInfo:
    width: int | None
    height: int | None
    duration_s: float | None
    poster_webp: bytes | None


def ffmpeg_available() -> bool:
    return shutil.which("ffprobe") is not None and shutil.which("ffmpeg") is not None


async def _run(*args: str) -> bytes | None:
    """Run a command (never through a shell); return its output, or None on failure."""
    process = await asyncio.create_subprocess_exec(
        *args,
        stdin=asyncio.subprocess.DEVNULL,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    try:
        stdout, stderr = await asyncio.wait_for(process.communicate(), TIMEOUT_SECONDS)
    except TimeoutError:
        process.kill()
        await process.wait()
        logger.warning("%s timed out after %ss", args[0], TIMEOUT_SECONDS)
        return None
    if process.returncode != 0:
        logger.info("%s failed: %s", args[0], stderr.decode(errors="replace").strip()[:500])
        return None
    return stdout


def _parse_probe(output: bytes) -> tuple[int | None, int | None, float | None]:
    data = json.loads(output)
    stream = (data.get("streams") or [{}])[0]
    width, height = stream.get("width"), stream.get("height")
    # Phones store upright videos sideways plus a rotation; report the size as displayed.
    rotations = [side.get("rotation", 0) for side in stream.get("side_data_list", [])]
    if width and height and any(abs(int(r)) % 180 == 90 for r in rotations):
        width, height = height, width
    duration = data.get("format", {}).get("duration")
    return width, height, float(duration) if duration else None


def _poster_to_webp(png: bytes) -> bytes:
    with Image.open(io.BytesIO(png), formats=["PNG"]) as frame:
        frame.thumbnail(THUMBNAIL_BOX)
        buffer = io.BytesIO()
        frame.convert("RGB").save(buffer, format="WEBP", quality=80)
    return buffer.getvalue()


async def inspect_video(path: Path) -> VideoInfo:
    if not ffmpeg_available():
        return VideoInfo(None, None, None, None)

    probe = await _run(
        "ffprobe", "-v", "error", *LOCAL_ONLY, "-select_streams", "v:0",
        "-show_entries", "stream=width,height:stream_side_data=rotation:format=duration",
        "-of", "json", str(path),
    )  # fmt: skip
    if probe is None:
        return VideoInfo(None, None, None, None)
    width, height, duration = _parse_probe(probe)

    # One second in, or the very start for clips shorter than that, avoids black opening frames.
    seek = "1" if duration and duration > 1 else "0"
    frame = await _run(
        "ffmpeg", "-v", "error", "-nostdin", *LOCAL_ONLY, "-ss", seek, "-i", str(path),
        "-frames:v", "1", "-f", "image2pipe", "-c:v", "png", "-",
    )  # fmt: skip
    poster = None
    if frame:
        try:
            poster = _poster_to_webp(frame)
        except (OSError, ValueError):
            logger.info("Could not read the poster frame of %s", path.name)
    return VideoInfo(width, height, duration, poster)
