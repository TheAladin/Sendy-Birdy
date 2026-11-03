import uuid
from datetime import datetime
from ipaddress import IPv4Address, IPv6Address

from pydantic import BaseModel, ConfigDict, field_validator

from app.services.activity import EventKind


class AccessEventOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    kind: EventKind
    created_at: datetime
    # Null once the share is deleted; the title is kept.
    share_id: uuid.UUID | None
    share_title: str | None
    item_id: uuid.UUID | None
    item_title: str | None
    ip: str | None
    user_agent: str | None

    @field_validator("ip", mode="before")
    @classmethod
    def _ip_text(cls, ip: str | IPv4Address | IPv6Address | None) -> str | None:
        # asyncpg returns inet values as ipaddress objects.
        return None if ip is None else str(ip)


class ActivityPage(BaseModel):
    events: list[AccessEventOut]
    next_cursor: str | None
