"""Recording access events, and forgetting them (and expired sessions) after a while."""

import asyncio
import logging
import uuid
from datetime import UTC, datetime, timedelta
from typing import Literal, Protocol

from fastapi import FastAPI, Request
from sqlalchemy import delete
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.core.client_ip import client_ip
from app.models import AccessEvent, AuthSession

logger = logging.getLogger(__name__)

EventKind = Literal[
    "share_viewed",
    "file_downloaded",
    "unlock_failed",
    "login_succeeded",
    "login_failed",
    "share_revoked",
    "item_deleted",
]

CLEANUP_INTERVAL = timedelta(days=1)


class Titled(Protocol):
    """A share or an item, or a row with just those columns (e.g. from a bulk delete)."""

    @property
    def id(self) -> uuid.UUID: ...
    @property
    def title(self) -> str: ...


def add_event(
    session: AsyncSession,
    request: Request,
    kind: EventKind,
    *,
    share: Titled | None = None,
    item: Titled | None = None,
) -> None:
    """Adds an event to the session; it's saved with the caller's next commit."""
    user_agent = request.headers.get("user-agent")
    session.add(
        AccessEvent(
            kind=kind,
            share_id=share.id if share else None,
            share_title=share.title if share else None,
            item_id=item.id if item else None,
            item_title=item.title if item else None,
            ip=client_ip(request),
            user_agent=user_agent[:500] if user_agent else None,
        )
    )


async def purge_old_records(
    session: AsyncSession, retention_days: int, now: datetime | None = None
) -> tuple[int, int]:
    """Deletes events older than the retention period and expired sessions.

    Returns (events deleted, sessions deleted).
    """
    now = now or datetime.now(UTC)
    events = await session.execute(
        delete(AccessEvent).where(AccessEvent.created_at < now - timedelta(days=retention_days))
    )
    sessions = await session.execute(delete(AuthSession).where(AuthSession.expires_at < now))
    await session.commit()
    return events.rowcount, sessions.rowcount  # type: ignore[attr-defined]


async def cleanup_daily(app: FastAPI) -> None:
    """Runs the purge at startup and then once a day, for as long as the app runs."""
    sessionmaker: async_sessionmaker[AsyncSession] = app.state.sessionmaker
    while True:
        try:
            async with sessionmaker() as session:
                events, sessions = await purge_old_records(
                    session, app.state.settings.log_retention_days
                )
            if events or sessions:
                logger.info(
                    "Deleted %d old access events and %d expired sessions", events, sessions
                )
        except Exception:
            # A failed run (database restarting, say) must not stop tomorrow's.
            logger.exception("Cleaning up old records failed")
        await asyncio.sleep(CLEANUP_INTERVAL.total_seconds())
