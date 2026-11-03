from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    Float,
    Index,
    Integer,
    String,
    Text,
    false,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Model


class Item(Model):
    """Something in the library: an uploaded image or video (file on disk, named by id), or a
    Markdown note (text in the database)."""

    __tablename__ = "items"
    __table_args__ = (
        CheckConstraint("kind IN ('image', 'video', 'note')", name="kind_allowed"),
        # Each kind carries exactly what it needs, so half-filled rows can't exist.
        CheckConstraint("kind <> 'note' OR body IS NOT NULL", name="note_has_body"),
        CheckConstraint(
            "kind = 'note' OR (original_filename IS NOT NULL AND mime_type IS NOT NULL"
            " AND size_bytes IS NOT NULL AND sha256 IS NOT NULL)",
            name="media_has_file",
        ),
        # Newest-first listing walks this index (in reverse) instead of sorting the table.
        Index("ix_items_created_at_id", "created_at", "id"),
        # Trigram index: makes case-insensitive "contains" search on titles fast.
        Index(
            "ix_items_title_trgm",
            "title",
            postgresql_using="gin",
            postgresql_ops={"title": "gin_trgm_ops"},
        ),
    )

    kind: Mapped[str] = mapped_column(String(10))
    title: Mapped[str] = mapped_column(String(200))
    # Notes only: Markdown source.
    body: Mapped[str | None] = mapped_column(Text)
    # Images and videos only.
    original_filename: Mapped[str | None] = mapped_column(String(255))
    # Detected from the file's content when uploaded, never taken from the browser.
    mime_type: Mapped[str | None] = mapped_column(String(100))
    size_bytes: Mapped[int | None] = mapped_column(BigInteger)
    sha256: Mapped[str | None] = mapped_column(String(64))
    width: Mapped[int | None] = mapped_column(Integer)
    height: Mapped[int | None] = mapped_column(Integer)
    duration_s: Mapped[float | None] = mapped_column(Float)
    # Images always get one; videos only when ffmpeg could extract a poster frame.
    has_thumbnail: Mapped[bool] = mapped_column(Boolean, server_default=false())
