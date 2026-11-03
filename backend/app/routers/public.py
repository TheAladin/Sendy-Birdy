"""Share links, as clients see them. No sign-in: the token in the URL is the key."""

import uuid
from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, HTTPException, Path, status
from fastapi.responses import FileResponse
from sqlalchemy import select, update
from sqlalchemy.orm import selectinload

from app.core.deps import SettingsDep
from app.db.session import SessionDep
from app.models import Item, Share, ShareItem, User
from app.schemas.public import PublicItem, PublicShare, ShareGone
from app.services.serving import original_response, thumbnail_response
from app.services.storage import Storage

router = APIRouter(prefix="/public/shares", tags=["public"])

Token = Annotated[str, Path(max_length=64)]

# Shorter than the admin's year: a client's browser shouldn't hold on to files for long, and the
# share is checked again whenever they're fetched anew.
FILE_CACHE = "private, max-age=3600"
GONE_MESSAGES = {
    "expired": "This link has expired.",
    "revoked": "This link is no longer available.",
}
NOT_FOUND = "This link doesn't exist. Check that it was copied completely."
SHARE_RESPONSES: dict[int | str, dict[str, object]] = {
    404: {"description": "No share has this token"},
    410: {"description": "The share expired or was revoked", "model": ShareGone},
}


async def _open_share(session: SessionDep, token: str, *, with_items: bool = False) -> Share:
    """The share behind a token, if it can be opened right now. Checked on every request, so
    revoking or expiry takes effect immediately, even for files."""
    query = select(Share).where(Share.token == token)
    if with_items:
        query = query.options(selectinload(Share.entries).selectinload(ShareItem.item))
    share = await session.scalar(query)
    if share is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, NOT_FOUND)
    state = share.status_at(datetime.now(UTC))
    if state != "active":
        raise HTTPException(
            status.HTTP_410_GONE, {"reason": state, "message": GONE_MESSAGES[state]}
        )
    return share


async def _shared_item(session: SessionDep, share: Share, item_id: uuid.UUID) -> Item:
    """An item of this share. Any other item gets the same 404 as one that doesn't exist, so a
    link can't be used to learn anything about the rest of the library."""
    item = await session.scalar(
        select(Item)
        .join(ShareItem, ShareItem.item_id == Item.id)
        .where(ShareItem.share_id == share.id, Item.id == item_id)
    )
    if item is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Not found.")
    return item


@router.get("/{token}", responses=SHARE_RESPONSES)
async def view_share(token: Token, session: SessionDep) -> PublicShare:
    """A share's content. Each call counts as a view."""
    share = await _open_share(session, token, with_items=True)
    # One UPDATE, so simultaneous views can't overwrite each other's count.
    await session.execute(
        update(Share)
        .where(Share.id == share.id)
        .values(view_count=Share.view_count + 1, last_viewed_at=datetime.now(UTC))
    )
    await session.commit()
    # There's a single admin account; theirs is the name clients see.
    shared_by = await session.scalar(select(User.display_name).order_by(User.created_at).limit(1))
    return PublicShare(
        title=share.title,
        message=share.message,
        shared_by=shared_by or "",
        expires_at=share.expires_at,
        allow_downloads=share.allow_downloads,
        items=[PublicItem.model_validate(entry.item) for entry in share.entries],
    )


@router.get(
    "/{token}/items/{item_id}/file",
    response_class=FileResponse,
    responses={
        **SHARE_RESPONSES,
        200: {"description": "The file itself"},
        206: {"description": "Part of it"},
        403: {"description": "Downloads are turned off for this share"},
    },
)
async def get_shared_file(
    token: Token,
    item_id: uuid.UUID,
    session: SessionDep,
    settings: SettingsDep,
    download: bool = False,
) -> FileResponse:
    """An item's file, shown in the page; with ?download=1, saved instead (if allowed)."""
    share = await _open_share(session, token)
    if download and not share.allow_downloads:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Downloads are turned off for this link.")
    item = await _shared_item(session, share, item_id)
    response = await original_response(
        item, Storage(settings.data_dir), download=download, cache_control=FILE_CACHE
    )
    if response is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Not found.")
    return response


@router.get(
    "/{token}/items/{item_id}/thumbnail",
    response_class=FileResponse,
    responses={**SHARE_RESPONSES, 200: {"description": "A WebP preview, at most 640x640"}},
)
async def get_shared_thumbnail(
    token: Token, item_id: uuid.UUID, session: SessionDep, settings: SettingsDep
) -> FileResponse:
    share = await _open_share(session, token)
    item = await _shared_item(session, share, item_id)
    response = await thumbnail_response(item, Storage(settings.data_dir), cache_control=FILE_CACHE)
    if response is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Not found.")
    return response
