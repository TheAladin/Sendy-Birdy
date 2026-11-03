import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.services.text import excerpt

MAX_NOTE_BYTES = 100 * 1024
EXCERPT_LENGTH = 200

ItemKind = Literal["image", "video", "note"]


def _clean_title(title: str) -> str:
    title = title.strip()
    if not title:
        raise ValueError("A title can't be empty.")
    return title


def _check_body(body: str) -> str:
    if not body.strip():
        raise ValueError("A note can't be empty.")
    # Bytes, not characters: "é" is 2 bytes and an emoji 4.
    if len(body.encode()) > MAX_NOTE_BYTES:
        raise ValueError("A note can be at most 100 KB.")
    return body


class ItemSummary(BaseModel):
    """An item as shown in lists: everything except a note's full text."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    kind: ItemKind
    title: str
    # Images and videos only.
    original_filename: str | None
    mime_type: str | None
    size_bytes: int | None
    width: int | None
    height: int | None
    duration_s: float | None
    has_thumbnail: bool
    created_at: datetime
    updated_at: datetime
    # Notes only: the start of the text, for previews.
    excerpt: str | None = None

    @model_validator(mode="before")
    @classmethod
    def _add_excerpt(cls, item: object) -> object:
        body = getattr(item, "body", None)
        if body is None:
            return item
        fields = {name: getattr(item, name) for name in cls.model_fields if hasattr(item, name)}
        return {**fields, "excerpt": excerpt(body, EXCERPT_LENGTH)}


class ItemOut(ItemSummary):
    """A single item in full, including a note's Markdown text."""

    body: str | None


class ItemPage(BaseModel):
    items: list[ItemSummary]
    # Pass as ?cursor= to get the next page; null on the last page.
    next_cursor: str | None


class NoteCreate(BaseModel):
    title: str = Field(max_length=200)
    body: str = Field(description="Markdown. At most 100 KB once encoded as UTF-8.")

    @field_validator("title")
    @classmethod
    def _title_not_blank(cls, title: str) -> str:
        return _clean_title(title)

    @field_validator("body")
    @classmethod
    def _body_within_limit(cls, body: str) -> str:
        return _check_body(body)


class ItemUpdate(BaseModel):
    """Change an item's title, or a note's text. Omitted fields stay as they are."""

    title: str | None = Field(default=None, max_length=200)
    body: str | None = Field(default=None, description="Notes only.")

    @field_validator("title")
    @classmethod
    def _title_not_blank(cls, title: str | None) -> str | None:
        return None if title is None else _clean_title(title)

    @field_validator("body")
    @classmethod
    def _body_within_limit(cls, body: str | None) -> str | None:
        return None if body is None else _check_body(body)

    @model_validator(mode="after")
    def _something_to_change(self) -> "ItemUpdate":
        if self.title is None and self.body is None:
            raise ValueError("Nothing to change: send a title and/or a body.")
        return self


class BulkDelete(BaseModel):
    ids: list[uuid.UUID] = Field(min_length=1, max_length=500)


class BulkDeleteResult(BaseModel):
    deleted: int


class UploadLimits(BaseModel):
    """What the server accepts, so the browser can check files before uploading them."""

    max_bytes: int
    accepted_types: list[str]
