"""Image processing for uploads: fix rotation, strip metadata, record size, make a thumbnail.

Everything here is CPU-bound and synchronous; callers run it in a worker thread.
"""

import io
import warnings
from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path

from PIL import Image, ImageOps

# Above this, an image is refused. Tiny files can claim huge dimensions and use gigabytes of
# memory once decoded ("decompression bombs"); 100 megapixels covers any real photo or screenshot.
MAX_PIXELS = 100_000_000
Image.MAX_IMAGE_PIXELS = MAX_PIXELS
THUMBNAIL_BOX = (640, 640)

# Only parse the format the upload was detected as, rather than letting Pillow guess.
PILLOW_FORMATS = {
    "image/png": "PNG",
    "image/jpeg": "JPEG",
    "image/webp": "WEBP",
    "image/gif": "GIF",
}

# Metadata keys Pillow exposes in Image.info that can identify a person, place or device.
METADATA_KEYS = ("exif", "xmp", "XML:com.adobe.xmp", "comment", "photoshop", "iptc")


class InvalidImage(Exception):
    """The file is damaged, or too large to decode safely."""


@dataclass(frozen=True)
class ProcessedImage:
    width: int
    height: int
    # True when the original file was rewritten (so its size and hash changed).
    rewritten: bool
    thumbnail_webp: bytes


@contextmanager
def _open(path: Path, mime_type: str) -> Iterator[Image.Image]:
    """Open and fully decode the image, always closing the file afterwards."""
    try:
        with warnings.catch_warnings():
            # Pillow only warns between 1x and 2x the limit; treat that as a refusal too.
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            image = Image.open(path, formats=[PILLOW_FORMATS[mime_type]])
    except (Image.DecompressionBombError, Image.DecompressionBombWarning) as error:
        raise InvalidImage("too_large") from error
    except (OSError, SyntaxError, ValueError) as error:
        raise InvalidImage("damaged") from error
    with image:
        try:
            image.load()
        except (OSError, SyntaxError, ValueError) as error:
            raise InvalidImage("damaged") from error
        yield image


def _has_metadata(image: Image.Image) -> bool:
    return any(image.info.get(key) for key in METADATA_KEYS) or bool(image.getexif())


def _save_clean(
    image: Image.Image, path: Path, pillow_format: str, icc_profile: bytes | None
) -> None:
    """Write the image without metadata, replacing the file atomically."""
    options: dict[str, object] = {"icc_profile": icc_profile} if icc_profile else {}
    if pillow_format in ("JPEG", "WEBP"):
        options["quality"] = 95
    temp = path.with_name(path.name + ".clean")
    image.save(temp, format=pillow_format, **options)
    temp.replace(path)


def _thumbnail(image: Image.Image) -> bytes:
    thumb = image.copy()
    if thumb.mode not in ("RGB", "RGBA"):
        thumb = thumb.convert(
            "RGBA" if "transparency" in thumb.info or "A" in thumb.mode else "RGB"
        )
    thumb.thumbnail(THUMBNAIL_BOX)
    buffer = io.BytesIO()
    thumb.save(buffer, format="WEBP", quality=80)
    return buffer.getvalue()


def process_image(path: Path, mime_type: str) -> ProcessedImage:
    """Validate an uploaded image in place and return its details and a WebP thumbnail."""
    pillow_format = PILLOW_FORMATS[mime_type]
    with _open(path, mime_type) as image:
        if getattr(image, "is_animated", False):
            # Rewriting animations risks changing their timing and colors; GIFs can't carry
            # EXIF and animated WebP almost never does, so animations are kept untouched.
            image.seek(0)
            return ProcessedImage(image.width, image.height, False, _thumbnail(image))

        icc_profile = image.info.get("icc_profile")
        orientation = image.getexif().get(0x0112, 1)
        upright = ImageOps.exif_transpose(image)
        # PNG rewrites are lossless, so always clean them. JPEG and WebP are re-encoded only
        # when there's something to remove or rotate, so plain screenshots keep their quality.
        rewrite = pillow_format == "PNG" or orientation != 1 or _has_metadata(image)
    if rewrite:
        _save_clean(upright, path, pillow_format, icc_profile)
    return ProcessedImage(upright.width, upright.height, rewrite, _thumbnail(upright))
