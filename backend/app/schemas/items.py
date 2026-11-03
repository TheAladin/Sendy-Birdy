import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

MAX_NOTE_BYTES = 100 * 1024


class ItemOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    kind: Literal["image", "video", "note"]
    title: str
    # Notes only.
    body: str | None
    # Images and videos only.
    original_filename: str | None
    mime_type: str | None
    size_bytes: int | None
    width: int | None
    height: int | None
    duration_s: float | None
    has_thumbnail: bool
    created_at: datetime


class NoteCreate(BaseModel):
    title: str = Field(max_length=200)
    body: str = Field(description="Markdown. At most 100 KB once encoded as UTF-8.")

    @field_validator("title")
    @classmethod
    def _title_not_blank(cls, title: str) -> str:
        title = title.strip()
        if not title:
            raise ValueError("A note needs a title.")
        return title

    @field_validator("body")
    @classmethod
    def _body_within_limit(cls, body: str) -> str:
        if not body.strip():
            raise ValueError("A note can't be empty.")
        # Bytes, not characters: "é" is 2 bytes and an emoji 4.
        if len(body.encode()) > MAX_NOTE_BYTES:
            raise ValueError("A note can be at most 100 KB.")
        return body
