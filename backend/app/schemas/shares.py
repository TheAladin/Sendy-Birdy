import uuid
from datetime import UTC, datetime
from typing import Annotated

from pydantic import AwareDatetime, BaseModel, Field, StringConstraints, field_validator

from app.models.share import ShareStatus
from app.schemas.items import MAX_NOTE_BYTES, ItemSummary, clean_title

# Same as the bulk-delete limit: keeps one request a reasonable size.
MAX_SHARE_ITEMS = 500


def _clean_message(message: str | None) -> str | None:
    if message is None or not message.strip():
        return None
    if len(message.encode()) > MAX_NOTE_BYTES:
        raise ValueError("A message can be at most 100 KB.")
    return message


def _check_expiry(expires_at: datetime | None) -> datetime | None:
    if expires_at is not None and expires_at <= datetime.now(UTC):
        raise ValueError("The expiry date must be in the future.")
    return expires_at


def _check_item_ids(item_ids: list[uuid.UUID] | None) -> list[uuid.UUID] | None:
    if item_ids is not None and len(set(item_ids)) != len(item_ids):
        raise ValueError("An item can only appear once in a share.")
    return item_ids


# Typed by the client from another message, so it can be short; Argon2 and rate limiting do
# the protecting. The upper bound keeps hashing time reasonable.
SharePassword = Annotated[str, StringConstraints(min_length=4, max_length=128)]


class _ShareFields(BaseModel):
    """Validation shared by creating and editing a share."""

    @field_validator("title", check_fields=False)
    @classmethod
    def _title(cls, title: str | None) -> str | None:
        return None if title is None else clean_title(title)

    @field_validator("message", check_fields=False)
    @classmethod
    def _message(cls, message: str | None) -> str | None:
        return _clean_message(message)

    @field_validator("expires_at", check_fields=False)
    @classmethod
    def _expiry(cls, expires_at: datetime | None) -> datetime | None:
        return _check_expiry(expires_at)

    @field_validator("item_ids", check_fields=False)
    @classmethod
    def _items(cls, item_ids: list[uuid.UUID] | None) -> list[uuid.UUID] | None:
        return _check_item_ids(item_ids)


class ShareCreate(_ShareFields):
    item_ids: list[uuid.UUID] = Field(
        min_length=1, max_length=MAX_SHARE_ITEMS, description="In the order the client sees them."
    )
    title: str = Field(max_length=200)
    message: str | None = Field(default=None, description="Markdown, shown above the items.")
    # A timezone is required, so "midnight" can't silently mean the server's midnight.
    expires_at: AwareDatetime | None = Field(default=None, description="null: never expires.")
    allow_downloads: bool = True
    password: SharePassword | None = Field(default=None, description="null: no password.")


class ShareUpdate(_ShareFields):
    """Change a share. Omitted fields stay as they are; "expires_at": null means never."""

    item_ids: list[uuid.UUID] | None = Field(default=None, min_length=1, max_length=MAX_SHARE_ITEMS)
    title: str | None = Field(default=None, max_length=200)
    message: str | None = None
    expires_at: AwareDatetime | None = None
    allow_downloads: bool | None = None
    # A new password; null removes it.
    password: SharePassword | None = None


class ShareSummary(BaseModel):
    id: uuid.UUID
    title: str
    # The link to send to the client.
    url: str
    status: ShareStatus
    expires_at: datetime | None
    revoked_at: datetime | None
    allow_downloads: bool
    has_password: bool
    view_count: int
    last_viewed_at: datetime | None
    item_count: int
    created_at: datetime
    updated_at: datetime


class ShareOut(ShareSummary):
    message: str | None
    items: list[ItemSummary]
