import asyncio
import uuid
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from datetime import UTC, datetime, timedelta

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.requests import Request

from app.core.client_ip import client_ip
from app.models import AccessEvent, AuthSession, User
from app.services import activity
from app.services.activity import purge_old_records
from tests import media
from tests.conftest import ADMIN_EMAIL, ADMIN_PASSWORD

VISITOR_IP = "203.0.113.7"
BROWSER = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Safari/604.1"


@pytest.fixture
async def visitor(app: FastAPI) -> AsyncIterator[AsyncClient]:
    """A client's browser reaching the app through the local tunnel, like in production."""
    async with AsyncClient(
        transport=ASGITransport(app=app, client=("127.0.0.1", 50000)),
        base_url="https://test",
        headers={
            "X-Forwarded-For": VISITOR_IP,
            "User-Agent": BROWSER,
            "X-Requested-With": "fetch",
        },
    ) as client:
        yield client


async def events(db_session: AsyncSession, *, logins: bool = False) -> list[AccessEvent]:
    """Recorded events, by kind. The `signed_in` fixture's own sign-in is left out unless
    asked for."""
    query = select(AccessEvent).order_by(AccessEvent.kind)
    if not logins:
        query = query.where(AccessEvent.kind.not_in(["login_succeeded", "login_failed"]))
    return list((await db_session.scalars(query)).all())


async def kinds(db_session: AsyncSession, *, logins: bool = False) -> list[str]:
    return [event.kind for event in await events(db_session, logins=logins)]


async def make_share(client: AsyncClient, **fields: object) -> dict:
    upload = await client.post("/api/items", params={"filename": "Hero.png"}, content=media.png())
    response = await client.post(
        "/api/shares", json={"title": "Northwind", "item_ids": [upload.json()["id"]], **fields}
    )
    assert response.status_code == 201
    return response.json()


def public_path(share: dict) -> str:
    return "/api/public/shares/" + share["url"].rsplit("/", 1)[1]


# Recording.


async def test_opening_a_link_is_recorded_with_address_and_browser(
    signed_in: AsyncClient, visitor: AsyncClient, db_session: AsyncSession
) -> None:
    share = await make_share(signed_in)

    await visitor.get(public_path(share))

    [event] = await events(db_session)
    assert event.kind == "share_viewed"
    assert str(event.share_id) == share["id"]
    assert event.share_title == "Northwind"
    assert str(event.ip) == VISITOR_IP
    assert event.user_agent == BROWSER


async def test_only_deliberate_downloads_are_recorded(
    signed_in: AsyncClient, visitor: AsyncClient, db_session: AsyncSession
) -> None:
    share = await make_share(signed_in)
    item_id = share["items"][0]["id"]
    files = f"{public_path(share)}/items/{item_id}"

    # Shown in the page: not recorded.
    await visitor.get(f"{files}/file")
    await visitor.get(f"{files}/thumbnail")
    assert await kinds(db_session) == []

    await visitor.get(f"{files}/file", params={"download": 1})

    [event] = await events(db_session)
    assert event.kind == "file_downloaded"
    assert event.item_title == "Hero"
    assert str(event.share_id) == share["id"]


async def test_wrong_share_passwords_are_recorded(
    signed_in: AsyncClient, visitor: AsyncClient, db_session: AsyncSession
) -> None:
    share = await make_share(signed_in, password="blue heron")
    unlock = f"{public_path(share)}/unlock"

    await visitor.post(unlock, json={"password": "guess"})
    # Locked: not a view yet.
    assert (await visitor.get(public_path(share))).status_code == 403
    await visitor.post(unlock, json={"password": "blue heron"})
    assert (await visitor.get(public_path(share))).status_code == 200

    [viewed, failed] = await events(db_session)  # sorted by kind
    assert failed.kind == "unlock_failed"
    assert str(failed.ip) == VISITOR_IP
    assert viewed.kind == "share_viewed"


async def test_sign_ins_are_recorded_whether_they_work_or_not(
    client: AsyncClient, admin: User, db_session: AsyncSession
) -> None:
    await client.post("/api/auth/login", json={"email": ADMIN_EMAIL, "password": "wrong"})
    await client.post("/api/auth/login", json={"email": "nobody@example.com", "password": "x"})
    await client.post("/api/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD})

    assert await kinds(db_session, logins=True) == [
        "login_failed",
        "login_failed",
        "login_succeeded",
    ]


async def test_revoking_is_recorded_once(signed_in: AsyncClient, db_session: AsyncSession) -> None:
    share = await make_share(signed_in)

    await signed_in.post(f"/api/shares/{share['id']}/revoke")
    await signed_in.post(f"/api/shares/{share['id']}/revoke")

    [event] = await events(db_session)
    assert event.kind == "share_revoked"
    assert event.share_title == "Northwind"


async def test_deleted_items_are_recorded_by_title(
    signed_in: AsyncClient, db_session: AsyncSession
) -> None:
    ids = []
    for name in ["One.png", "Two.png", "Three.png"]:
        upload = await signed_in.post("/api/items", params={"filename": name}, content=media.png())
        ids.append(upload.json()["id"])

    await signed_in.delete(f"/api/items/{ids[0]}")
    await signed_in.post("/api/items/bulk-delete", json={"ids": ids[1:]})

    assert sorted(event.item_title or "" for event in await events(db_session)) == [
        "One",
        "Three",
        "Two",
    ]
    assert set(await kinds(db_session)) == {"item_deleted"}


# The visitor's address.


def request(peer: str, forwarded: str | None = None) -> Request:
    headers = [(b"x-forwarded-for", forwarded.encode())] if forwarded else []
    return Request({"type": "http", "client": (peer, 1234), "headers": headers})


@pytest.mark.parametrize(
    ("peer", "forwarded", "expected"),
    [
        # Straight from the internet: the header could say anything, so it's ignored.
        ("198.51.100.9", "1.2.3.4", "198.51.100.9"),
        # Through the local tunnel: the address it added (the last one) is the visitor's.
        ("127.0.0.1", VISITOR_IP, VISITOR_IP),
        ("127.0.0.1", f"1.2.3.4, {VISITOR_IP}", VISITOR_IP),
        ("::1", "2001:db8::7", "2001:db8::7"),
        # Through the tunnel but nothing usable: the tunnel's own address.
        ("127.0.0.1", None, "127.0.0.1"),
        ("127.0.0.1", "not an address", "127.0.0.1"),
    ],
)
def test_the_forwarded_address_is_trusted_only_from_this_machine(
    peer: str, forwarded: str | None, expected: str
) -> None:
    assert client_ip(request(peer, forwarded)) == expected


async def test_a_spoofed_header_from_outside_is_ignored_end_to_end(
    signed_in: AsyncClient, app: FastAPI, db_session: AsyncSession
) -> None:
    share = await make_share(signed_in)

    async with AsyncClient(
        transport=ASGITransport(app=app, client=("198.51.100.9", 50000)),
        base_url="https://test",
        headers={"X-Forwarded-For": "10.0.0.1"},
    ) as outsider:
        await outsider.get(public_path(share))

    [event] = await events(db_session)
    assert str(event.ip) == "198.51.100.9"


# Listing.


async def add(db_session: AsyncSession, kind: str, minutes: int, **fields: object) -> None:
    db_session.add(
        AccessEvent(
            kind=kind,
            created_at=datetime(2026, 1, 1, tzinfo=UTC) + timedelta(minutes=minutes),
            **fields,
        )
    )
    await db_session.flush()


async def test_activity_is_listed_newest_first_a_page_at_a_time(
    signed_in: AsyncClient, db_session: AsyncSession
) -> None:
    for minute in range(5):
        await add(db_session, "share_viewed", minute, ip=f"192.0.2.{minute}")

    # (Filtered by kind, leaving out the sign-in the fixture just made.)
    params = {"limit": 3, "kind": "share_viewed"}
    first = (await signed_in.get("/api/activity", params=params)).json()
    second = (
        await signed_in.get("/api/activity", params={**params, "cursor": first["next_cursor"]})
    ).json()

    assert [event["ip"] for event in first["events"]] == ["192.0.2.4", "192.0.2.3", "192.0.2.2"]
    assert [event["ip"] for event in second["events"]] == ["192.0.2.1", "192.0.2.0"]
    assert second["next_cursor"] is None


async def test_activity_can_be_filtered_by_share_and_kind(
    signed_in: AsyncClient, db_session: AsyncSession
) -> None:
    share = await make_share(signed_in)
    share_id = uuid.UUID(share["id"])
    await add(db_session, "share_viewed", 1, share_id=share_id)
    await add(db_session, "file_downloaded", 2, share_id=share_id)
    await add(db_session, "share_viewed", 3)
    await add(db_session, "login_failed", 4)

    async def listed(**params: object) -> list[str]:
        response = await signed_in.get("/api/activity", params=params)
        assert response.status_code == 200
        return [event["kind"] for event in response.json()["events"]]

    assert await listed(share_id=share["id"]) == ["file_downloaded", "share_viewed"]
    assert await listed(kind="share_viewed") == ["share_viewed", "share_viewed"]
    assert await listed(kind=["login_failed", "file_downloaded"]) == [
        "login_failed",
        "file_downloaded",
    ]
    assert await listed(share_id=share["id"], kind="share_viewed") == ["share_viewed"]
    assert (await signed_in.get("/api/activity", params={"kind": "nonsense"})).status_code == 422


async def test_events_outlive_their_share_with_its_title(
    signed_in: AsyncClient, visitor: AsyncClient, db_session: AsyncSession
) -> None:
    share = await make_share(signed_in)
    await visitor.get(public_path(share))

    await signed_in.delete(f"/api/shares/{share['id']}")

    response = await signed_in.get("/api/activity", params={"kind": "share_viewed"})
    [event] = response.json()["events"]
    assert event["share_id"] is None
    assert event["share_title"] == "Northwind"
    assert event["ip"] == VISITOR_IP


async def test_activity_requires_signing_in(client: AsyncClient) -> None:
    assert (await client.get("/api/activity")).status_code == 401


# Retention.


async def test_old_events_and_expired_sessions_are_deleted(
    db_session: AsyncSession, admin: User
) -> None:
    now = datetime(2026, 6, 1, tzinfo=UTC)
    for age_days, ip in [(91, "192.0.2.1"), (89, "192.0.2.2"), (1, "192.0.2.3")]:
        db_session.add(
            AccessEvent(kind="share_viewed", ip=ip, created_at=now - timedelta(days=age_days))
        )
    for token, expires in [
        ("a" * 64, now - timedelta(minutes=1)),
        ("b" * 64, now + timedelta(days=1)),
    ]:
        db_session.add(AuthSession(token_hash=token, user_id=admin.id, expires_at=expires))
    await db_session.flush()

    deleted = await purge_old_records(db_session, retention_days=90, now=now)

    assert deleted == (1, 1)
    kept = await db_session.scalars(select(AccessEvent.ip).order_by(AccessEvent.ip))
    assert [str(ip) for ip in kept] == ["192.0.2.2", "192.0.2.3"]
    assert await db_session.scalar(select(func.count()).select_from(AuthSession)) == 1


async def test_the_daily_cleanup_keeps_going_after_a_failure(
    app: FastAPI, monkeypatch: pytest.MonkeyPatch
) -> None:
    runs: list[int] = []
    sleeps: list[float] = []

    async def purge(_session: object, retention_days: int) -> tuple[int, int]:
        runs.append(retention_days)
        if len(runs) == 1:
            raise RuntimeError("database restarting")
        return 0, 0

    async def sleep(seconds: float) -> None:
        sleeps.append(seconds)
        if len(sleeps) == 2:
            raise asyncio.CancelledError

    @asynccontextmanager
    async def fake_session() -> AsyncIterator[object]:
        yield object()

    monkeypatch.setattr(activity, "purge_old_records", purge)
    monkeypatch.setattr(activity.asyncio, "sleep", sleep)
    app.state.sessionmaker = fake_session

    with pytest.raises(asyncio.CancelledError):
        await activity.cleanup_daily(app)

    # Ran at start, failed, waited a day, ran again.
    assert runs == [90, 90]
    assert sleeps == [86400, 86400]
