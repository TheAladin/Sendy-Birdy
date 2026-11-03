from sqlalchemy import BigInteger, CheckConstraint, Float, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Model


class Item(Model):
    """Something in the library: an uploaded image or video. The file lives on disk under its id."""

    __tablename__ = "items"
    __table_args__ = (CheckConstraint("kind IN ('image', 'video')", name="kind_allowed"),)

    kind: Mapped[str] = mapped_column(String(10))
    title: Mapped[str] = mapped_column(String(200))
    original_filename: Mapped[str] = mapped_column(String(255))
    # Detected from the file's content when uploaded, never taken from the browser.
    mime_type: Mapped[str] = mapped_column(String(100))
    size_bytes: Mapped[int] = mapped_column(BigInteger)
    sha256: Mapped[str] = mapped_column(String(64))
    width: Mapped[int | None] = mapped_column(Integer)
    height: Mapped[int | None] = mapped_column(Integer)
    duration_s: Mapped[float | None] = mapped_column(Float)
