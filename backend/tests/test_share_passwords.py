import uuid
from collections.abc import AsyncIterator
from datetime import UTC, datetime, timedelta

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings
from app.core.unlock import UNLOCK_COOKIE, make_unlock
from app.models import Share
from tests import media

PASSWORD = "blue heron"


@pytest.fixture
async def visitor(app: FastAPI) -> AsyncIterator[AsyncClient]:
    """A client's browser: no session cookie. It sends the CSRF header like our page does."""
    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="https://test",
        headers={"X-Requested-With": "fetch"},
    ) as client:
        yield client


class Link:
    def __init__(self, share: dict, item_id: str) -> None:
        self.id = share["id"]
        self.token = share["url"].rsplit("/", 1)[1]
        self.item_id = item_id
        self.page = f"/api/public/shares/{self.token}"
        self.unlock = f"{self.page}/unlock"
        self.file = f"{self.page}/items/{item_id}/file"
        self.thumbnail = f"{self.page}/items/{item_id}/thumbnail"


@pytest.fixture
async def make_link(signed_in: AsyncClient):
    upload = await signed_in.post(
        "/api/items", params={"filename": "Homepage.png"}, content=media.png()
    )
    item_id = upload.json()["id"]

    async def make(password: str | None = PASSWORD) -> Link:
        response = await signed_in.post(
            "/api/shares",
            json={"title": "Northwind", "item_ids": [item_id], "password": password},
        )
        assert response.status_code == 201, response.text
        return Link(response.json(), item_id)

    return make


@pytest.fixture
async def link(make_link) -> Link:
    return await make_link()


async def unlock(visitor: AsyncClient, link: Link, password: str = PASSWORD) -> int:
    return (await visitor.post(link.unlock, json={"password": password})).status_code


# The admin side.


async def test_the_admin_sees_whether_a_link_has_a_password_but_never_the_hash(
    signed_in: AsyncClient, link: Link, db_session: AsyncSession
) -> None:
    detail = (await signed_in.get(f"/api/shares/{link.id}")).text
    listed = (await signed_in.get("/api/shares")).json()

    assert '"has_password":true' in detail
    assert listed[0]["has_password"] is True
    stored = await db_session.scalar(select(Share.password_hash))
    assert stored is not None
    assert stored.startswith("$argon2id$")
    assert stored not in detail
    assert PASSWORD not in stored


async def test_a_password_must_be_at_least_four_characters(
    signed_in: AsyncClient, link: Link
) -> None:
    response = await signed_in.patch(f"/api/shares/{link.id}", json={"password": "abc"})

    assert response.status_code == 422


# Locked.


async def test_a_locked_link_reveals_only_that_it_is_locked_and_by_whom(
    visitor: AsyncClient, link: Link, signed_in: AsyncClient
) -> None:
    me = (await signed_in.get("/api/auth/me")).json()

    response = await visitor.get(link.page)

    assert response.status_code == 403
    assert response.json() == {
        "detail": {
            "reason": "locked",
            "message": "This link is protected by a password.",
            "shared_by": me["display_name"],
            "retention_days": 90,
        }
    }
    assert "Northwind" not in response.text
    assert response.headers["referrer-policy"] == "no-referrer"
    # Not shown, so not a view.
    assert (await signed_in.get(f"/api/shares/{link.id}")).json()["view_count"] == 0


async def test_a_locked_links_files_are_locked_too(visitor: AsyncClient, link: Link) -> None:
    for path in [link.file, link.file + "?download=1", link.thumbnail]:
        response = await visitor.get(path)
        assert response.status_code == 403, path
        assert response.json()["detail"]["reason"] == "locked"


# Unlocking.


async def test_a_wrong_password_is_refused(visitor: AsyncClient, link: Link) -> None:
    response = await visitor.post(link.unlock, json={"password": "grey heron"})

    assert response.status_code == 401
    assert response.json()["detail"] == "That password isn't right."
    assert "set-cookie" not in response.headers
    assert (await visitor.get(link.page)).status_code == 403


async def test_the_right_password_opens_the_link_and_its_files(
    visitor: AsyncClient, link: Link, signed_in: AsyncClient
) -> None:
    response = await visitor.post(link.unlock, json={"password": PASSWORD})

    assert response.status_code == 204
    cookie = response.headers["set-cookie"]
    assert cookie.startswith(f"{UNLOCK_COOKIE}=")
    # Sent back only to this share's own URLs, never readable by scripts, for 12 hours.
    assert f"Path=/api/public/shares/{link.token}" in cookie
    assert "HttpOnly" in cookie
    assert "SameSite=strict" in cookie
    assert "Max-Age=43200" in cookie
    assert "Secure" in cookie

    page = await visitor.get(link.page)
    assert page.status_code == 200
    assert page.json()["title"] == "Northwind"
    assert (await visitor.get(link.file)).status_code == 200
    assert (await visitor.get(link.thumbnail)).status_code == 200
    assert (await signed_in.get(f"/api/shares/{link.id}")).json()["view_count"] == 1


async def test_an_unlock_works_for_that_link_only(
    visitor: AsyncClient, make_link, app: FastAPI
) -> None:
    first = await make_link()
    second = await make_link()  # Same password, different link.
    await unlock(visitor, first)
    cookie = visitor.cookies.get(UNLOCK_COOKIE)
    assert cookie

    # The browser wouldn't send it to the other link (its path differs)...
    assert (await visitor.get(second.page)).status_code == 403
    # ...and even sent on purpose, it's signed for the first link only.
    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="https://test",
        cookies={UNLOCK_COOKIE: cookie},
    ) as copied:
        assert (await copied.get(second.page)).status_code == 403


async def test_changing_the_password_ends_earlier_unlocks(
    visitor: AsyncClient, link: Link, signed_in: AsyncClient
) -> None:
    assert await unlock(visitor, link) == 204
    assert (await visitor.get(link.page)).status_code == 200

    await signed_in.patch(f"/api/shares/{link.id}", json={"password": "green heron"})

    assert (await visitor.get(link.page)).status_code == 403
    assert await unlock(visitor, link) == 401
    assert await unlock(visitor, link, "green heron") == 204
    assert (await visitor.get(link.page)).status_code == 200


async def test_setting_the_same_password_again_also_ends_earlier_unlocks(
    visitor: AsyncClient, link: Link, signed_in: AsyncClient
) -> None:
    # Useful when a password leaked along with an unlocked laptop: re-saving it signs everyone out.
    await unlock(visitor, link)

    await signed_in.patch(f"/api/shares/{link.id}", json={"password": PASSWORD})

    assert (await visitor.get(link.page)).status_code == 403


async def test_removing_the_password_opens_the_link_to_anyone(
    visitor: AsyncClient, link: Link, signed_in: AsyncClient
) -> None:
    await signed_in.patch(f"/api/shares/{link.id}", json={"password": None})

    assert (await visitor.get(link.page)).status_code == 200
    assert (await signed_in.get(f"/api/shares/{link.id}")).json()["has_password"] is False


async def test_editing_other_fields_keeps_the_password(
    visitor: AsyncClient, link: Link, signed_in: AsyncClient
) -> None:
    await unlock(visitor, link)

    await signed_in.patch(f"/api/shares/{link.id}", json={"title": "Round 2"})

    # Same hash, so the unlock still holds.
    assert (await visitor.get(link.page)).json()["title"] == "Round 2"


@pytest.mark.parametrize(
    "forge",
    [
        pytest.param(lambda real: "", id="empty"),
        pytest.param(lambda real: "garbage", id="garbage"),
        # Pushing the expiry later breaks the signature.
        pytest.param(lambda real: f"9999999999.{real.split('.')[1]}", id="later-expiry"),
        pytest.param(lambda real: real[:-1] + ("0" if real[-1] != "0" else "1"), id="flipped"),
    ],
)
async def test_forged_unlocks_are_refused(
    link: Link, app: FastAPI, visitor: AsyncClient, forge
) -> None:
    await unlock(visitor, link)
    real = visitor.cookies.get(UNLOCK_COOKIE)
    assert real

    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="https://test",
        cookies={UNLOCK_COOKIE: forge(real)},
    ) as forger:
        assert (await forger.get(link.page)).status_code == 403


async def test_an_unlock_expires(
    link: Link, app: FastAPI, settings: Settings, db_session: AsyncSession
) -> None:
    share = await db_session.get(Share, uuid.UUID(link.id))
    assert share
    assert share.password_hash
    old = make_unlock(
        settings.secret_key.get_secret_value(),
        share.id,
        share.password_hash,
        datetime.now(UTC) - timedelta(hours=13),
    )

    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="https://test", cookies={UNLOCK_COOKIE: old}
    ) as late:
        assert (await late.get(link.page)).status_code == 403


async def test_unlocking_checks_the_link_first(
    visitor: AsyncClient, link: Link, signed_in: AsyncClient
) -> None:
    assert (
        await visitor.post("/api/public/shares/nope/unlock", json={"password": PASSWORD})
    ).status_code == 404

    await signed_in.post(f"/api/shares/{link.id}/revoke")

    # Revoked: the right password doesn't help, and isn't even checked.
    assert await unlock(visitor, link) == 410


async def test_revoking_beats_an_existing_unlock(
    visitor: AsyncClient, link: Link, signed_in: AsyncClient
) -> None:
    await unlock(visitor, link)

    await signed_in.post(f"/api/shares/{link.id}/revoke")

    response = await visitor.get(link.page)
    assert response.status_code == 410
    assert response.json()["detail"]["reason"] == "revoked"


async def test_unlocking_a_link_without_password_does_nothing(
    visitor: AsyncClient, make_link
) -> None:
    open_link = await make_link(password=None)

    response = await visitor.post(open_link.unlock, json={"password": "anything"})

    assert response.status_code == 204
    assert "set-cookie" not in response.headers


async def test_an_unlock_is_bound_to_the_link_even_with_an_identical_hash(
    make_link,
    app: FastAPI,
    visitor: AsyncClient,
    db_session: AsyncSession,
) -> None:
    # Salts make two hashes differ, which already ties an unlock to one link; the share id in
    # the signature keeps it that way even if a hash were ever copied to another share.
    first = await make_link()
    second = await make_link()
    first_hash = await db_session.scalar(
        select(Share.password_hash).where(Share.id == uuid.UUID(first.id))
    )
    await db_session.execute(
        update(Share).where(Share.id == uuid.UUID(second.id)).values(password_hash=first_hash)
    )
    await unlock(visitor, first)

    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="https://test",
        cookies={UNLOCK_COOKIE: visitor.cookies.get(UNLOCK_COOKIE) or ""},
    ) as copied:
        assert (await copied.get(second.page)).status_code == 403
