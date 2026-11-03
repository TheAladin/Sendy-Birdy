"""Builders for real image files used in tests."""

import io
import struct
import zlib

from PIL import Image, ImageCms
from PIL.PngImagePlugin import PngInfo

RED = (220, 30, 30)
BLUE = (30, 30, 220)


def png(width: int = 32, height: int = 24, text: dict[str, str] | None = None) -> bytes:
    image = Image.new("RGB", (width, height), BLUE)
    info = PngInfo()
    for key, value in (text or {}).items():
        info.add_text(key, value)
    buffer = io.BytesIO()
    image.save(buffer, format="PNG", pnginfo=info)
    return buffer.getvalue()


def jpeg(
    *, orientation: int | None = None, gps: bool = False, icc: bool = False, size=(40, 20)
) -> bytes:
    """A JPEG whose left half is red and right half blue, with optional EXIF and color profile."""
    image = Image.new("RGB", size, BLUE)
    image.paste(RED, (0, 0, size[0] // 2, size[1]))
    exif = Image.Exif()
    if orientation:
        exif[0x0112] = orientation
    if gps:
        exif[0x010F] = "PhoneMaker"  # camera make
        gps_ifd = exif.get_ifd(0x8825)
        gps_ifd[1] = "N"
        gps_ifd[2] = (48.0, 51.0, 29.0)
        gps_ifd[3] = "E"
        gps_ifd[4] = (2.0, 17.0, 40.0)
    options: dict[str, object] = {"quality": 95}
    if len(exif):
        options["exif"] = exif.tobytes()
    if icc:
        options["icc_profile"] = ImageCms.ImageCmsProfile(ImageCms.createProfile("sRGB")).tobytes()
    buffer = io.BytesIO()
    image.save(buffer, format="JPEG", **options)
    return buffer.getvalue()


def animated_gif(frames: int = 3, size=(30, 20)) -> bytes:
    images = [Image.new("P", size, color) for color in range(frames)]
    buffer = io.BytesIO()
    images[0].save(buffer, format="GIF", save_all=True, append_images=images[1:], duration=100)
    return buffer.getvalue()


def png_claiming_size(width: int, height: int) -> bytes:
    """A tiny PNG whose header claims huge dimensions: a "decompression bomb"."""

    def chunk(kind: bytes, data: bytes) -> bytes:
        crc = zlib.crc32(kind + data) & 0xFFFFFFFF
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", crc)

    header = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)
    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", header)
        + chunk(b"IDAT", zlib.compress(b"\x00"))
        + chunk(b"IEND", b"")
    )
