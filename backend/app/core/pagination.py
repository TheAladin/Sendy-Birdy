"""Opaque cursors for newest-first keyset pagination over (created_at, id)."""

import base64
import uuid
from datetime import datetime

from fastapi import HTTPException, status


def encode_cursor(created_at: datetime, row_id: uuid.UUID) -> str:
    raw = f"{created_at.isoformat()}|{row_id}"
    return base64.urlsafe_b64encode(raw.encode()).decode().rstrip("=")


def decode_cursor(cursor: str) -> tuple[datetime, uuid.UUID]:
    try:
        raw = base64.urlsafe_b64decode(cursor + "=" * (-len(cursor) % 4)).decode()
        created_at, row_id = raw.split("|")
        return datetime.fromisoformat(created_at), uuid.UUID(row_id)
    except ValueError:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Invalid cursor.") from None
