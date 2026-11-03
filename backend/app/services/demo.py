"""Demo content: plausible screenshots, notes and a screen recording for a fictional client.

Used for development, tests and README screenshots, so real client work never has to be.
Everything goes through the same pipeline as real uploads.
"""

import io
import math
import shutil
import subprocess
import tempfile
from collections.abc import AsyncIterator, Callable
from datetime import UTC, datetime, timedelta
from pathlib import Path

import anyio
from PIL import Image, ImageDraw, ImageFont
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Item
from app.services.library import add_media
from app.services.storage import Storage
from app.services.videos import ffmpeg_available

BRAND = (37, 99, 235)
INK = (24, 24, 27)
MUTED = (113, 113, 122)
LINE = (228, 228, 231)
SOFT = (244, 244, 245)
WHITE = (255, 255, 255)


class LibraryNotEmpty(Exception):
    pass


def _font(size: int) -> ImageFont.FreeTypeFont:
    return ImageFont.load_default(size=size)


def _lines(draw: ImageDraw.ImageDraw, x: int, y: int, widths: list[int], color=LINE) -> None:
    """Grey bars standing in for paragraphs of text."""
    for index, width in enumerate(widths):
        draw.rounded_rectangle((x, y + index * 22, x + width, y + index * 22 + 10), 5, fill=color)


def _browser(width: int, height: int, url: str) -> tuple[Image.Image, ImageDraw.ImageDraw]:
    image = Image.new("RGB", (width, height), WHITE)
    draw = ImageDraw.Draw(image)
    draw.rectangle((0, 0, width, 52), fill=SOFT)
    for index, color in enumerate([(248, 113, 113), (251, 191, 36), (74, 222, 128)]):
        draw.ellipse((20 + index * 22, 20, 32 + index * 22, 32), fill=color)
    draw.rounded_rectangle((width // 2 - 260, 12, width // 2 + 260, 40), 14, fill=WHITE)
    draw.text((width // 2 - 240, 18), url, font=_font(15), fill=MUTED)
    return image, draw


def _homepage() -> Image.Image:
    image, draw = _browser(1440, 900, "northwind.example")
    draw.text((80, 84), "Northwind", font=_font(26), fill=INK)
    for index, label in enumerate(["Product", "Pricing", "Customers", "Blog"]):
        draw.text((880 + index * 110, 90), label, font=_font(17), fill=MUTED)
    draw.text((80, 210), "Ship your roadmap,", font=_font(64), fill=INK)
    draw.text((80, 285), "not your weekends.", font=_font(64), fill=BRAND)
    _lines(draw, 82, 390, [520, 480, 360])
    draw.rounded_rectangle((80, 480, 280, 536), 12, fill=BRAND)
    draw.text((112, 494), "Start for free", font=_font(20), fill=WHITE)
    draw.rounded_rectangle((300, 480, 470, 536), 12, outline=LINE, width=2)
    draw.text((330, 494), "Watch demo", font=_font(20), fill=INK)
    for row in range(14):  # hero illustration: a soft gradient panel
        shade = 235 - row * 4
        draw.rectangle(
            (780, 180 + row * 26, 1360, 206 + row * 26), fill=(shade - 40, shade - 10, 250)
        )
    draw.rounded_rectangle((820, 230, 1320, 520), 18, fill=WHITE)
    _lines(draw, 860, 270, [300, 400, 250, 380, 320])
    for index, title in enumerate(["Plan", "Track", "Ship"]):
        x = 80 + index * 440
        draw.rounded_rectangle((x, 640, x + 400, 840), 16, outline=LINE, width=2)
        draw.ellipse((x + 30, 670, x + 74, 714), fill=(219, 234, 254))
        draw.text((x + 30, 735), title, font=_font(24), fill=INK)
        _lines(draw, x + 30, 780, [300, 240])
    return image


def _checkout() -> Image.Image:
    image = Image.new("RGB", (390, 844), WHITE)
    draw = ImageDraw.Draw(image)
    draw.text((24, 18), "9:41", font=_font(16), fill=INK)
    draw.text((24, 70), "Checkout", font=_font(30), fill=INK)
    products = [
        ("Desk lamp", "$48.00", (253, 230, 138)),
        ("Notebook set", "$24.00", (191, 219, 254)),
    ]
    for index, (name, price, color) in enumerate(products):
        y = 140 + index * 100
        draw.rounded_rectangle((24, y, 96, y + 72), 12, fill=color)
        draw.text((112, y + 12), name, font=_font(18), fill=INK)
        draw.text((112, y + 40), "Qty 1", font=_font(14), fill=MUTED)
        draw.text((296, y + 24), price, font=_font(18), fill=INK)
    draw.line((24, 360, 366, 360), fill=LINE, width=2)
    for index, (label, value) in enumerate([("Subtotal", "$72.00"), ("Shipping", "Free")]):
        draw.text((24, 384 + index * 34), label, font=_font(16), fill=MUTED)
        draw.text((296, 384 + index * 34), value, font=_font(16), fill=INK)
    draw.text((24, 470), "Total", font=_font(22), fill=INK)
    draw.text((280, 470), "$72.00", font=_font(22), fill=INK)
    draw.rounded_rectangle((24, 540, 366, 600), 14, outline=LINE, width=2)
    draw.text((44, 560), "Card ending 4242", font=_font(17), fill=INK)
    draw.rounded_rectangle((24, 740, 366, 800), 16, fill=BRAND)
    draw.text((150, 758), "Pay now", font=_font(20), fill=WHITE)
    return image


def _dashboard() -> Image.Image:
    image, draw = _browser(1440, 900, "app.northwind.example/analytics")
    draw.rectangle((0, 52, 240, 900), fill=(250, 250, 250))
    draw.text((32, 84), "Northwind", font=_font(22), fill=INK)
    for index, label in enumerate(["Overview", "Analytics", "Customers", "Settings"]):
        if index == 1:
            draw.rounded_rectangle(
                (20, 140 + index * 44, 220, 176 + index * 44), 8, fill=(219, 234, 254)
            )
        draw.text(
            (36, 148 + index * 44), label, font=_font(16), fill=BRAND if index == 1 else MUTED
        )
    draw.text((280, 90), "Analytics", font=_font(32), fill=INK)
    for index, (label, value, change) in enumerate(
        [
            ("Visitors", "48,210", "+12%"),
            ("Sign-ups", "1,934", "+8%"),
            ("Revenue", "$32.4k", "+21%"),
        ]
    ):
        x = 280 + index * 380
        draw.rounded_rectangle((x, 160, x + 350, 290), 14, outline=LINE, width=2)
        draw.text((x + 24, 182), label, font=_font(16), fill=MUTED)
        draw.text((x + 24, 214), value, font=_font(36), fill=INK)
        draw.text((x + 250, 226), change, font=_font(18), fill=(22, 163, 74))
    draw.rounded_rectangle((280, 320, 1390, 840), 14, outline=LINE, width=2)
    draw.text((308, 344), "Visitors, last 30 days", font=_font(18), fill=INK)
    points = [
        (330 + day * 35, 760 - int(160 + 120 * math.sin(day / 4) + day * 6)) for day in range(30)
    ]
    for level in range(4):
        draw.line((320, 440 + level * 100, 1360, 440 + level * 100), fill=SOFT, width=1)
    draw.line(points, fill=BRAND, width=4, joint="curve")
    return image


def _pricing() -> Image.Image:
    image, draw = _browser(1440, 900, "northwind.example/pricing")
    draw.text((560, 110), "Simple pricing", font=_font(48), fill=INK)
    _lines(draw, 560, 190, [330])
    plans = [("Starter", "$0"), ("Team", "$12"), ("Business", "$29")]
    for index, (name, price) in enumerate(plans):
        x = 150 + index * 400
        featured = index == 1
        draw.rounded_rectangle(
            (x, 260, x + 360, 820), 20, fill=WHITE, outline=BRAND if featured else LINE,
            width=3 if featured else 2,
        )  # fmt: skip
        if featured:
            draw.rounded_rectangle((x + 230, 280, x + 340, 310), 15, fill=(219, 234, 254))
            draw.text((x + 246, 284), "Popular", font=_font(15), fill=BRAND)
        draw.text((x + 32, 300), name, font=_font(24), fill=INK)
        draw.text((x + 32, 350), price, font=_font(56), fill=INK)
        price_width = draw.textlength(price, font=_font(56))
        draw.text((x + 40 + price_width, 384), "/ month", font=_font(16), fill=MUTED)
        for row in range(5):
            draw.ellipse((x + 32, 470 + row * 44, x + 46, 484 + row * 44), fill=(134, 239, 172))
            _lines(draw, x + 60, 472 + row * 44, [200 - row * 15])
        draw.rounded_rectangle(
            (x + 32, 730, x + 328, 786), 12, fill=BRAND if featured else SOFT
        )  # fmt: skip
        draw.text((x + 128, 746), "Choose plan", font=_font(18), fill=WHITE if featured else INK)
    return image


def _settings_dark() -> Image.Image:
    background, panel, line, text, muted = (
        (9, 9, 11),
        (24, 24, 27),
        (39, 39, 42),
        (244, 244, 245),
        (161, 161, 170),
    )
    image = Image.new("RGB", (1280, 800), background)
    draw = ImageDraw.Draw(image)
    draw.text((80, 70), "Settings", font=_font(34), fill=text)
    draw.text((80, 120), "Dark mode preview", font=_font(17), fill=muted)
    draw.rounded_rectangle((80, 180, 1200, 720), 18, fill=panel, outline=line, width=2)
    for index, label in enumerate(["Display name", "Email", "Time zone"]):
        y = 220 + index * 110
        draw.text((120, y), label, font=_font(16), fill=muted)
        draw.rounded_rectangle(
            (120, y + 30, 700, y + 76), 10, fill=background, outline=line, width=2
        )
    draw.text((780, 220), "Notifications", font=_font(16), fill=muted)
    for index in range(3):
        y = 260 + index * 60
        draw.rounded_rectangle(
            (780, y, 836, y + 30), 15, fill=(59, 130, 246) if index != 1 else line
        )
        knob = 810 if index != 1 else 784
        draw.ellipse((knob, y + 3, knob + 24, y + 27), fill=WHITE)
        _lines(draw, 856, y + 10, [220 - index * 30], color=line)
    draw.rounded_rectangle((1000, 640, 1160, 690), 12, fill=(59, 130, 246))
    draw.text((1040, 653), "Save", font=_font(19), fill=WHITE)
    return image


SCREENSHOTS: list[tuple[str, Callable[[], Image.Image]]] = [
    ("Homepage redesign - desktop", _homepage),
    ("Checkout flow - mobile", _checkout),
    ("Analytics dashboard", _dashboard),
    ("Pricing page", _pricing),
    ("Settings - dark mode", _settings_dark),
]

NOTES = [
    (
        "Release notes v2.3",
        "# Release notes v2.3\n\n## New\n- Redesigned checkout with Apple Pay and Google Pay\n"
        "- Dark mode for the settings page\n\n## Fixed\n- Pricing toggle kept the wrong currency\n"
        "- Dashboard chart cut off on small screens\n",
    ),
    (
        "Feedback from Monday's call",
        "Thanks for the review! Summary of what we agreed:\n\n1. **Hero copy**: shorter headline, "
        "keep the blue accent.\n2. **Pricing**: highlight the *Team* plan.\n3. **Checkout**: "
        "move the total above the payment method.\n\nNext round of screens by Friday.",
    ),
    (
        "Design tokens",
        "| Token | Value |\n|---|---|\n| Brand | `#2563EB` |\n| Radius | `12px` |\n"
        "| Font | Inter, 16px base |\n\nSpacing follows a 4px grid.",
    ),
]


def _png(render: Callable[[], Image.Image]) -> bytes:
    buffer = io.BytesIO()
    render().save(buffer, format="PNG")
    return buffer.getvalue()


async def _one_chunk(data: bytes) -> AsyncIterator[bytes]:
    yield data


def _render_walkthrough(ffmpeg: str, destination: Path, seconds: int, fps: int) -> None:
    """Draw the frames with Pillow and stream them into ffmpeg, which writes an MP4 file."""
    page = Image.new("RGB", (1280, 1500), WHITE)
    page.paste(_dashboard().resize((1280, 800)), (0, 0))
    page.paste(_pricing().resize((1280, 800)).crop((0, 100, 1280, 800)), (0, 800))
    command = [
        ffmpeg, "-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", "1280x720",
        "-r", str(fps), "-i", "-", "-c:v", "libx264", "-pix_fmt", "yuv420p",
        # Index at the start of the file, so browsers can play it before it fully downloads.
        "-movflags", "+faststart", str(destination),
    ]  # fmt: skip
    with subprocess.Popen(command, stdin=subprocess.PIPE, stderr=subprocess.PIPE) as process:  # noqa: S603
        if process.stdin is None:
            raise RuntimeError("ffmpeg has no input pipe")
        total = seconds * fps
        for index in range(total):
            progress = index / (total - 1)
            top = int((page.height - 720) * (0.5 - 0.5 * math.cos(math.pi * progress)))
            frame = page.crop((0, top, 1280, top + 720))
            draw = ImageDraw.Draw(frame)
            x, y = 300 + int(700 * progress), 200 + int(120 * math.sin(progress * 6))
            draw.polygon([(x, y), (x, y + 26), (x + 7, y + 19), (x + 18, y + 19)], fill=INK)
            process.stdin.write(frame.tobytes())
        process.stdin.close()
        errors = process.stderr.read().decode(errors="replace") if process.stderr else ""
    if process.returncode != 0:
        raise RuntimeError(f"ffmpeg failed: {errors.strip()[:500]}")


async def make_walkthrough_video(seconds: int = 5, fps: int = 24) -> bytes | None:
    """A fake screen recording: the dashboard scrolling, with a moving cursor."""
    ffmpeg = shutil.which("ffmpeg")
    if ffmpeg is None:
        return None
    with tempfile.TemporaryDirectory() as folder:
        destination = Path(folder) / "walkthrough.mp4"
        await anyio.to_thread.run_sync(_render_walkthrough, ffmpeg, destination, seconds, fps)
        return await anyio.Path(destination).read_bytes()


async def seed_demo(
    session: AsyncSession, storage: Storage, max_bytes: int, *, force: bool = False
) -> list[Item]:
    """Fill the library with demo content. Refuses a non-empty library unless forced."""
    if not force and await session.scalar(select(func.count()).select_from(Item)):
        raise LibraryNotEmpty
    items: list[Item] = []
    for title, render in SCREENSHOTS:
        png = await anyio.to_thread.run_sync(_png, render)
        items.append(await add_media(session, storage, _one_chunk(png), f"{title}.png", max_bytes))
    for title, body in NOTES:
        note = Item(kind="note", title=title, body=body)
        session.add(note)
        await session.commit()
        items.append(note)
    if ffmpeg_available():
        video = await make_walkthrough_video()
        if video:
            items.append(
                await add_media(
                    session, storage, _one_chunk(video), "Onboarding walkthrough.mp4", max_bytes
                )
            )
    # Spread creation times over the past days, so the library looks lived-in.
    now = datetime.now(UTC)
    for age, item in enumerate(reversed(items)):
        moment = now - timedelta(hours=5 * age, minutes=7 * age)
        await session.execute(update(Item).where(Item.id == item.id).values(created_at=moment))
    await session.commit()
    return items
