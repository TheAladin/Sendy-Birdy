import uuid
from typing import Annotated

from fastapi import APIRouter, Query
from sqlalchemy import select, tuple_

from app.core.deps import CurrentUser
from app.core.pagination import decode_cursor, encode_cursor
from app.db.session import SessionDep
from app.models import AccessEvent
from app.schemas.activity import AccessEventOut, ActivityPage
from app.services.activity import EventKind

router = APIRouter(prefix="/activity", tags=["activity"])


@router.get("")
async def list_activity(
    session: SessionDep,
    _user: CurrentUser,
    share_id: uuid.UUID | None = None,
    kind: Annotated[list[EventKind] | None, Query(description="Any of these kinds")] = None,
    cursor: str | None = None,
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
) -> ActivityPage:
    """Access events, newest first, a page at a time."""
    query = (
        select(AccessEvent)
        .order_by(AccessEvent.created_at.desc(), AccessEvent.id.desc())
        .limit(limit + 1)
    )
    if share_id:
        query = query.where(AccessEvent.share_id == share_id)
    if kind:
        query = query.where(AccessEvent.kind.in_(kind))
    if cursor:
        query = query.where(tuple_(AccessEvent.created_at, AccessEvent.id) < decode_cursor(cursor))
    rows = list((await session.scalars(query)).all())
    page = rows[:limit]
    return ActivityPage(
        events=[AccessEventOut.model_validate(event) for event in page],
        next_cursor=encode_cursor(page[-1].created_at, page[-1].id) if len(rows) > limit else None,
    )
