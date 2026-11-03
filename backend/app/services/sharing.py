import uuid
from collections.abc import Iterable

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import ShareItem


def share_url(public_base_url: str, token: str) -> str:
    return f"{public_base_url.rstrip('/')}/s/{token}"


async def share_counts(
    session: AsyncSession, item_ids: Iterable[uuid.UUID]
) -> dict[uuid.UUID, int]:
    """How many shares include each item, in one query. Items in no share are left out."""
    ids = list(item_ids)
    if not ids:
        return {}
    rows = await session.execute(
        select(ShareItem.item_id, func.count())
        .where(ShareItem.item_id.in_(ids))
        .group_by(ShareItem.item_id)
    )
    return dict(rows.all())
