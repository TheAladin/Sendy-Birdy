"""What clients opening a share link get to see: only what the page needs, nothing internal
(no file names on disk, hashes, view counts or other shares)."""

import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict

from app.schemas.items import ItemKind


class PublicItem(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    kind: ItemKind
    title: str
    mime_type: str | None
    size_bytes: int | None
    width: int | None
    height: int | None
    duration_s: float | None
    has_thumbnail: bool
    # Notes only: the Markdown text.
    body: str | None


class PublicShare(BaseModel):
    title: str
    message: str | None
    # The admin's display name, for "Shared by …".
    shared_by: str
    expires_at: datetime | None
    allow_downloads: bool
    items: list[PublicItem]


class ShareGoneDetail(BaseModel):
    reason: Literal["expired", "revoked"]
    message: str


class ShareGone(BaseModel):
    """The 410 body: the link existed but can't be opened anymore, and why."""

    detail: ShareGoneDetail
