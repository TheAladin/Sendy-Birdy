import uuid
from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, HTTPException, Query, Request, Response, status
from sqlalchemy import delete, func, select
from sqlalchemy.orm import selectinload

from app.core.config import Settings
from app.core.deps import CurrentUser, SettingsDep
from app.core.security import hash_password
from app.db.session import SessionDep
from app.models import Item, Share, ShareItem
from app.schemas.items import ItemSummary
from app.schemas.shares import (
    MAX_SHARE_ITEMS,
    ShareCreate,
    ShareOut,
    ShareSummary,
    ShareUpdate,
)
from app.services.activity import add_event
from app.services.sharing import share_counts, share_url

router = APIRouter(prefix="/shares", tags=["shares"])

REVOKED_MESSAGE = "This link was revoked, so it can't be changed. Create a new link instead."


def _summary_fields(share: Share, item_count: int, settings: Settings) -> dict[str, object]:
    return {
        "id": share.id,
        "title": share.title,
        "url": share_url(settings.public_base_url, share.token),
        "status": share.status_at(datetime.now(UTC)),
        "expires_at": share.expires_at,
        "revoked_at": share.revoked_at,
        "allow_downloads": share.allow_downloads,
        "has_password": share.password_hash is not None,
        "view_count": share.view_count,
        "last_viewed_at": share.last_viewed_at,
        "item_count": item_count,
        "created_at": share.created_at,
        "updated_at": share.updated_at,
    }


async def _load(session: SessionDep, share_id: uuid.UUID) -> Share:
    share = await session.scalar(
        select(Share)
        .where(Share.id == share_id)
        .options(selectinload(Share.entries).selectinload(ShareItem.item))
        # Always reload: entries may have just been replaced, or removed by an item delete.
        .execution_options(populate_existing=True)
    )
    if share is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Share not found.")
    return share


async def _share_out(session: SessionDep, share: Share, settings: Settings) -> ShareOut:
    items = [entry.item for entry in share.entries]
    counts = await share_counts(session, (item.id for item in items))
    return ShareOut(
        **_summary_fields(share, len(items), settings),
        message=share.message,
        items=[
            ItemSummary.model_validate(item).model_copy(
                update={"share_count": counts.get(item.id, 0)}
            )
            for item in items
        ],
    )


async def _check_items_exist(session: SessionDep, item_ids: list[uuid.UUID]) -> None:
    found = await session.scalar(select(func.count()).where(Item.id.in_(item_ids)))
    if found != len(item_ids):
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            "Some of these items no longer exist. Refresh the library and try again.",
        )


def _entries(item_ids: list[uuid.UUID]) -> list[ShareItem]:
    return [ShareItem(item_id=item_id, position=index) for index, item_id in enumerate(item_ids)]


@router.post("", status_code=status.HTTP_201_CREATED)
async def create_share(
    body: ShareCreate, session: SessionDep, settings: SettingsDep, _user: CurrentUser
) -> ShareOut:
    """Create a link to these items, in this order."""
    await _check_items_exist(session, body.item_ids)
    share = Share(
        password_hash=await hash_password(body.password) if body.password else None,
        title=body.title,
        message=body.message,
        expires_at=body.expires_at,
        allow_downloads=body.allow_downloads,
        entries=_entries(body.item_ids),
    )
    session.add(share)
    await session.commit()
    return await _share_out(session, await _load(session, share.id), settings)


@router.get("")
async def list_shares(
    session: SessionDep,
    settings: SettingsDep,
    _user: CurrentUser,
    item_id: Annotated[
        list[uuid.UUID] | None,
        Query(max_length=MAX_SHARE_ITEMS, description="Only shares containing any of these items"),
    ] = None,
) -> list[ShareSummary]:
    """Every share, newest first. There's no paging: one person creates these by hand."""
    item_count = (
        select(func.count())
        .where(ShareItem.share_id == Share.id)
        .correlate(Share)
        .scalar_subquery()
    )
    query = select(Share, item_count).order_by(Share.created_at.desc(), Share.id.desc())
    if item_id:
        # Used to warn, before deleting items, which links will lose them.
        query = query.where(
            Share.id.in_(select(ShareItem.share_id).where(ShareItem.item_id.in_(item_id)))
        )
    rows = await session.execute(query)
    return [ShareSummary(**_summary_fields(share, count, settings)) for share, count in rows]


@router.get("/{share_id}")
async def get_share(
    share_id: uuid.UUID, session: SessionDep, settings: SettingsDep, _user: CurrentUser
) -> ShareOut:
    return await _share_out(session, await _load(session, share_id), settings)


@router.patch("/{share_id}", responses={409: {"description": "The share was revoked"}})
async def update_share(
    share_id: uuid.UUID,
    changes: ShareUpdate,
    session: SessionDep,
    settings: SettingsDep,
    _user: CurrentUser,
) -> ShareOut:
    """Edit a share; item_ids replaces the items and their order."""
    share = await _load(session, share_id)
    if share.revoked_at is not None:
        raise HTTPException(status.HTTP_409_CONFLICT, REVOKED_MESSAGE)
    # Check everything before changing anything, so a refused edit leaves no half-applied changes.
    if changes.item_ids is not None:
        await _check_items_exist(session, changes.item_ids)
    sent = changes.model_fields_set
    if changes.title is not None:
        share.title = changes.title
    if "message" in sent:
        share.message = changes.message
    # Unlike the others, null is meaningful here: it removes the expiry.
    if "expires_at" in sent:
        share.expires_at = changes.expires_at
    if changes.allow_downloads is not None:
        share.allow_downloads = changes.allow_downloads
    # A new hash also signs out everyone who unlocked the link with the old password.
    if "password" in sent:
        share.password_hash = await hash_password(changes.password) if changes.password else None
    if changes.item_ids is not None:
        share.entries = _entries(changes.item_ids)
    await session.commit()
    return await _share_out(session, await _load(session, share_id), settings)


@router.post("/{share_id}/revoke")
async def revoke_share(
    share_id: uuid.UUID,
    request: Request,
    session: SessionDep,
    settings: SettingsDep,
    _user: CurrentUser,
) -> ShareOut:
    """Turn the link off for good. Revoking twice keeps the first date."""
    share = await _load(session, share_id)
    if share.revoked_at is None:
        share.revoked_at = datetime.now(UTC)
        add_event(session, request, "share_revoked", share=share)
        await session.commit()
    return await _share_out(session, await _load(session, share_id), settings)


@router.delete("/{share_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_share(share_id: uuid.UUID, session: SessionDep, _user: CurrentUser) -> Response:
    """Delete the link. The items stay in the library."""
    deleted = await session.scalar(delete(Share).where(Share.id == share_id).returning(Share.id))
    if deleted is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Share not found.")
    await session.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
