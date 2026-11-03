import secrets
import uuid
from datetime import datetime
from typing import Literal

from sqlalchemy import Boolean, DateTime, ForeignKey, Index, Integer, String, Text, true
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, Model
from app.models.item import Item

ShareStatus = Literal["active", "expired", "revoked"]


def new_token() -> str:
    """128 random bits, URL-safe (22 characters): unguessable, and short enough to paste."""
    return secrets.token_urlsafe(16)


class Share(Model):
    """A private link to an ordered set of items, for a client."""

    __tablename__ = "shares"

    token: Mapped[str] = mapped_column(String(64), unique=True, default=new_token)
    title: Mapped[str] = mapped_column(String(200))
    # Markdown, shown above the items.
    message: Mapped[str | None] = mapped_column(Text)
    # None: never expires.
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    allow_downloads: Mapped[bool] = mapped_column(Boolean, server_default=true())
    # Set once and never cleared: a revoked link stays dead; you create a new one instead.
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # Argon2 hash; None when the link needs no password.
    password_hash: Mapped[str | None] = mapped_column(String(255))
    view_count: Mapped[int] = mapped_column(Integer, server_default="0")
    last_viewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    entries: Mapped[list["ShareItem"]] = relationship(
        order_by="ShareItem.position",
        cascade="all, delete-orphan",
        # The database removes the rows (ON DELETE CASCADE); no need to load them first.
        passive_deletes=True,
        lazy="raise",
    )

    def status_at(self, now: datetime) -> ShareStatus:
        # Revoked wins over expired: revoking is the deliberate, permanent decision.
        if self.revoked_at is not None:
            return "revoked"
        if self.expires_at is not None and self.expires_at <= now:
            return "expired"
        return "active"


class ShareItem(Base):
    """One item in a share, at a position. Deleting the item (or the share) removes the row."""

    __tablename__ = "share_items"
    # "Which shares contain this item?" (for share counts) would otherwise scan the table.
    __table_args__ = (Index("ix_share_items_item_id", "item_id"),)

    share_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("shares.id", ondelete="CASCADE"), primary_key=True
    )
    item_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("items.id", ondelete="CASCADE"), primary_key=True
    )
    position: Mapped[int] = mapped_column(Integer)

    item: Mapped[Item] = relationship(lazy="raise")
