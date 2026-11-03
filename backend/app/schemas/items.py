import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict


class ItemOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    kind: Literal["image", "video"]
    title: str
    original_filename: str
    mime_type: str
    size_bytes: int
    width: int | None
    height: int | None
    duration_s: float | None
    has_thumbnail: bool
    created_at: datetime
