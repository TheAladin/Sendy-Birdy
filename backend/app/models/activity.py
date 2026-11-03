import uuid

from sqlalchemy import CheckConstraint, ForeignKey, Index, String, Uuid
from sqlalchemy.dialects.postgresql import INET
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Model

EVENT_KINDS = (
    "share_viewed",
    "file_downloaded",
    "unlock_failed",
    "login_succeeded",
    "login_failed",
    "share_revoked",
    "item_deleted",
)


class AccessEvent(Model):
    """Something worth knowing happened: a link was opened, a file downloaded, a login tried.

    Titles are copied in, so the log still reads well after a share or item is deleted.
    """

    __tablename__ = "access_events"
    __table_args__ = (
        CheckConstraint(
            "kind IN (" + ", ".join(f"'{kind}'" for kind in EVENT_KINDS) + ")",
            name="kind_allowed",
        ),
        # Newest first, overall and per share.
        Index("ix_access_events_created_at_id", "created_at", "id"),
        Index("ix_access_events_share_id_created_at", "share_id", "created_at"),
    )

    kind: Mapped[str] = mapped_column(String(30))
    # The share stays linked while it exists; once deleted, the copied title remains.
    share_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("shares.id", ondelete="SET NULL"))
    share_title: Mapped[str | None] = mapped_column(String(200))
    # Not a foreign key: "item deleted" events outlive their item by design.
    item_id: Mapped[uuid.UUID | None] = mapped_column(Uuid)
    item_title: Mapped[str | None] = mapped_column(String(200))
    ip: Mapped[str | None] = mapped_column(INET)
    user_agent: Mapped[str | None] = mapped_column(String(500))
