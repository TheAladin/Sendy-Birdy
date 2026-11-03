"""Share links, as clients see them. No sign-in: the token in the URL is the key."""

import uuid
from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, HTTPException, Path, Request, Response, status
from fastapi.responses import FileResponse
from sqlalchemy import select, update
from sqlalchemy.orm import selectinload

from app.core.client_ip import client_ip
from app.core.config import Settings
from app.core.deps import SettingsDep
from app.core.ratelimit import too_many_attempts
from app.core.security import verify_password
from app.core.unlock import UNLOCK_COOKIE, UNLOCK_LIFETIME, is_unlocked, make_unlock
from app.db.session import SessionDep
from app.models import Item, Share, ShareItem, User
from app.schemas.public import PublicItem, PublicShare, ShareGone, ShareLocked, UnlockRequest
from app.services.activity import add_event
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
LOCKED_MESSAGE = "This link is protected by a password."
SHARE_RESPONSES: dict[int | str, dict[str, object]] = {
    404: {"description": "No share has this token"},
    410: {"description": "The share expired or was revoked", "model": ShareGone},
}
CONTENT_RESPONSES: dict[int | str, dict[str, object]] = {
    **SHARE_RESPONSES,
    403: {"description": "The share needs its password first", "model": ShareLocked},
}


async def _shared_by(session: SessionDep) -> str:
    # There's a single admin account; theirs is the name clients see.
    name = await session.scalar(select(User.display_name).order_by(User.created_at).limit(1))
    return name or ""


def _cookie_path(token: str) -> str:
    # The browser sends the unlock only to this share's own URLs.
    return f"/api/public/shares/{token}"


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


async def _open_content(
    request: Request,
    session: SessionDep,
    settings: Settings,
    token: str,
    *,
    with_items: bool = False,
) -> Share:
    """Like _open_share, but a password-protected share also needs a valid unlock cookie."""
    share = await _open_share(session, token, with_items=with_items)
    if share.password_hash is not None and not is_unlocked(
        settings.secret_key.get_secret_value(),
        share.id,
        share.password_hash,
        request.cookies.get(UNLOCK_COOKIE),
        datetime.now(UTC),
    ):
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            {
                "reason": "locked",
                "message": LOCKED_MESSAGE,
                "shared_by": await _shared_by(session),
                "retention_days": settings.log_retention_days,
            },
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


@router.get("/{token}", responses=CONTENT_RESPONSES)
async def view_share(
    token: Token, request: Request, session: SessionDep, settings: SettingsDep
) -> PublicShare:
    """A share's content. Each call counts as a view."""
    share = await _open_content(request, session, settings, token, with_items=True)
    # One UPDATE, so simultaneous views can't overwrite each other's count.
    await session.execute(
        update(Share)
        .where(Share.id == share.id)
        .values(view_count=Share.view_count + 1, last_viewed_at=datetime.now(UTC))
    )
    add_event(session, request, "share_viewed", share=share)
    await session.commit()
    return PublicShare(
        title=share.title,
        message=share.message,
        shared_by=await _shared_by(session),
        retention_days=settings.log_retention_days,
        expires_at=share.expires_at,
        allow_downloads=share.allow_downloads,
        items=[PublicItem.model_validate(entry.item) for entry in share.entries],
    )


@router.get(
    "/{token}/items/{item_id}/file",
    response_class=FileResponse,
    responses={
        **CONTENT_RESPONSES,
        200: {"description": "The file itself"},
        206: {"description": "Part of it"},
        403: {"description": "Locked, or downloads are turned off for this share"},
    },
)
async def get_shared_file(
    token: Token,
    item_id: uuid.UUID,
    request: Request,
    session: SessionDep,
    settings: SettingsDep,
    download: bool = False,
) -> FileResponse:
    """An item's file, shown in the page; with ?download=1, saved instead (if allowed)."""
    share = await _open_content(request, session, settings, token)
    if download and not share.allow_downloads:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Downloads are turned off for this link.")
    item = await _shared_item(session, share, item_id)
    response = await original_response(
        item, Storage(settings.data_dir), download=download, cache_control=FILE_CACHE
    )
    if response is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Not found.")
    # Only deliberate downloads: files shown in the page would flood the log.
    if download:
        add_event(session, request, "file_downloaded", share=share, item=item)
        await session.commit()
    return response


@router.get(
    "/{token}/items/{item_id}/thumbnail",
    response_class=FileResponse,
    responses={**CONTENT_RESPONSES, 200: {"description": "A WebP preview, at most 640x640"}},
)
async def get_shared_thumbnail(
    token: Token, item_id: uuid.UUID, request: Request, session: SessionDep, settings: SettingsDep
) -> FileResponse:
    share = await _open_content(request, session, settings, token)
    item = await _shared_item(session, share, item_id)
    response = await thumbnail_response(item, Storage(settings.data_dir), cache_control=FILE_CACHE)
    if response is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Not found.")
    return response


@router.post(
    "/{token}/unlock",
    status_code=status.HTTP_204_NO_CONTENT,
    responses={
        **SHARE_RESPONSES,
        401: {"description": "Wrong password"},
        429: {"description": "Too many failed attempts"},
    },
)
async def unlock_share(
    token: Token,
    body: UnlockRequest,
    request: Request,
    session: SessionDep,
    settings: SettingsDep,
) -> Response:
    """Check a share's password; if right, a cookie lets this browser in for 12 hours."""
    share = await _open_share(session, token)
    response = Response(status_code=status.HTTP_204_NO_CONTENT)
    if share.password_hash is None:
        # Nothing to unlock; the page can simply be loaded.
        return response
    limits = request.app.state.rate_limits
    visitor_key = f"{client_ip(request) or 'unknown'}:{share.id}"
    share_key = str(share.id)
    wait = max(
        limits.unlock_per_visitor.retry_after(visitor_key) or 0,
        limits.unlock_per_share.retry_after(share_key) or 0,
    )
    if wait:
        raise too_many_attempts(wait)
    valid, new_hash = await verify_password(body.password, share.password_hash)
    if not valid:
        limits.unlock_per_visitor.record_failure(visitor_key)
        limits.unlock_per_share.record_failure(share_key)
        add_event(session, request, "unlock_failed", share=share)
        await session.commit()
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "That password isn't right.")
    if new_hash:
        # pwdlib asks for this when hashing settings got stronger since the password was set.
        # The cookie below is signed with the new hash, so it stays valid.
        share.password_hash = new_hash
        await session.commit()
    response.set_cookie(
        UNLOCK_COOKIE,
        make_unlock(
            settings.secret_key.get_secret_value(),
            share.id,
            share.password_hash,
            datetime.now(UTC),
        ),
        max_age=int(UNLOCK_LIFETIME.total_seconds()),
        path=_cookie_path(token),
        httponly=True,
        secure=settings.cookie_secure,
        samesite="strict",
    )
    return response
