import re
import uuid
from datetime import UTC, datetime, timedelta

import pytest
from httpx import AsyncClient
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Item, Share, ShareItem
from tests.conftest import MakeItem

TOKEN_URL = re.compile(r"^http://localhost:5173/s/[A-Za-z0-9_-]{22}$")


def soon(**delta: float) -> str:
    return (datetime.now(UTC) + timedelta(**delta)).isoformat()


@pytest.fixture
async def three(make_item: MakeItem) -> list[Item]:
    return [await make_item(title, minutes=index) for index, title in enumerate("ABC")]


async def create(client: AsyncClient, items: list[Item], **fields: object) -> dict:
    response = await client.post(
        "/api/shares",
        json={"title": "For Northwind", "item_ids": [str(item.id) for item in items], **fields},
    )
    assert response.status_code == 201, response.text
    return response.json()


def titles(share: dict) -> list[str]:
    return [item["title"] for item in share["items"]]


async def test_creating_a_share(signed_in: AsyncClient, three: list[Item]) -> None:
    a, b, c = three
    share = await create(signed_in, [c, a, b], message="Hi! **Round 2**", expires_at=soon(days=7))

    assert TOKEN_URL.match(share["url"])
    assert share["status"] == "active"
    assert share["message"] == "Hi! **Round 2**"
    assert share["allow_downloads"] is True
    assert share["item_count"] == 3
    assert share["view_count"] == 0
    # Kept in the order given, not the library's.
    assert titles(share) == ["C", "A", "B"]


async def test_links_use_the_public_base_url(
    signed_in: AsyncClient, three: list[Item], app: object
) -> None:
    app.state.settings.public_base_url = "https://share.example.com/"  # type: ignore[attr-defined]

    share = await create(signed_in, three)

    assert re.match(r"^https://share\.example\.com/s/[A-Za-z0-9_-]{22}$", share["url"])


async def test_every_link_gets_its_own_random_token(
    signed_in: AsyncClient, three: list[Item]
) -> None:
    urls = {(await create(signed_in, three))["url"] for _ in range(5)}

    assert len(urls) == 5


@pytest.mark.parametrize(
    ("fields", "message"),
    [
        ({"item_ids": []}, "at least 1 item"),
        ({"title": "   "}, "A title can't be empty."),
        ({"expires_at": "2020-01-01T00:00:00Z"}, "The expiry date must be in the future."),
        # Without a timezone, "midnight" would silently mean the server's midnight.
        ({"expires_at": "2099-01-01T00:00:00"}, "timezone"),
        ({"message": "x" * (100 * 1024 + 1)}, "A message can be at most 100 KB."),
    ],
)
async def test_invalid_shares_are_refused(
    signed_in: AsyncClient, three: list[Item], fields: dict, message: str
) -> None:
    body = {"title": "T", "item_ids": [str(three[0].id)], **fields}

    response = await signed_in.post("/api/shares", json=body)

    assert response.status_code == 422
    assert message in response.text


async def test_an_item_can_only_appear_once(signed_in: AsyncClient, three: list[Item]) -> None:
    response = await signed_in.post(
        "/api/shares", json={"title": "T", "item_ids": [str(three[0].id)] * 2}
    )

    assert response.status_code == 422
    assert "only appear once" in response.text


async def test_unknown_items_are_refused(
    signed_in: AsyncClient, three: list[Item], db_session: AsyncSession
) -> None:
    response = await signed_in.post(
        "/api/shares", json={"title": "T", "item_ids": [str(three[0].id), str(uuid.uuid4())]}
    )

    assert response.status_code == 422
    assert "no longer exist" in response.text
    assert await db_session.scalar(select(func.count()).select_from(Share)) == 0


async def test_a_blank_message_is_stored_as_none(signed_in: AsyncClient, three: list[Item]) -> None:
    assert (await create(signed_in, three, message="  \n"))["message"] is None


# Status.


async def expire(db_session: AsyncSession, share: dict) -> None:
    """Move the expiry into the past directly; the API only accepts future dates."""
    await db_session.execute(
        update(Share)
        .where(Share.id == uuid.UUID(share["id"]))
        .values(expires_at=datetime.now(UTC) - timedelta(minutes=1))
    )


async def status_of(client: AsyncClient, share: dict) -> str:
    return (await client.get(f"/api/shares/{share['id']}")).json()["status"]


async def test_a_share_is_active_until_it_expires(
    signed_in: AsyncClient, three: list[Item], db_session: AsyncSession
) -> None:
    share = await create(signed_in, three, expires_at=soon(hours=1))
    assert await status_of(signed_in, share) == "active"

    await expire(db_session, share)

    assert await status_of(signed_in, share) == "expired"


async def test_a_share_without_expiry_stays_active(
    signed_in: AsyncClient, three: list[Item]
) -> None:
    share = await create(signed_in, three)

    assert share["expires_at"] is None
    assert share["status"] == "active"


async def test_revoking_is_permanent(
    signed_in: AsyncClient, three: list[Item], db_session: AsyncSession
) -> None:
    share = await create(signed_in, three, expires_at=soon(days=1))

    first = await signed_in.post(f"/api/shares/{share['id']}/revoke")
    again = await signed_in.post(f"/api/shares/{share['id']}/revoke")
    edit = await signed_in.patch(f"/api/shares/{share['id']}", json={"expires_at": soon(days=30)})

    assert first.json()["status"] == "revoked"
    assert again.json()["revoked_at"] == first.json()["revoked_at"]
    assert edit.status_code == 409
    assert "Create a new link" in edit.json()["detail"]
    # Revoked wins over expired.
    await expire(db_session, share)
    assert await status_of(signed_in, share) == "revoked"


async def test_shares_are_listed_newest_first_with_status_and_counts(
    signed_in: AsyncClient, three: list[Item], db_session: AsyncSession
) -> None:
    old = await create(signed_in, three[:1], title="old")
    middle = await create(signed_in, three, title="middle")
    new = await create(signed_in, three[:2], title="new")
    # One transaction means one now(); spread the creation times out by hand.
    for minutes, share in enumerate([old, middle, new]):
        await db_session.execute(
            update(Share)
            .where(Share.id == uuid.UUID(share["id"]))
            .values(created_at=datetime(2026, 1, 1, tzinfo=UTC) + timedelta(minutes=minutes))
        )
    await signed_in.post(f"/api/shares/{middle['id']}/revoke")

    listed = (await signed_in.get("/api/shares")).json()

    assert [(s["title"], s["status"], s["item_count"]) for s in listed] == [
        ("new", "active", 2),
        ("middle", "revoked", 3),
        ("old", "active", 1),
    ]
    assert "items" not in listed[0]
    assert "message" not in listed[0]


# Editing.


async def test_editing_changes_only_what_is_sent(signed_in: AsyncClient, three: list[Item]) -> None:
    share = await create(signed_in, three, message="Hello", expires_at=soon(days=1))

    edited = (await signed_in.patch(f"/api/shares/{share['id']}", json={"title": "Round 2"})).json()

    assert edited["title"] == "Round 2"
    assert edited["message"] == "Hello"
    assert edited["expires_at"] == share["expires_at"]
    assert edited["url"] == share["url"]


async def test_expiry_can_be_extended_or_removed(
    signed_in: AsyncClient, three: list[Item], db_session: AsyncSession
) -> None:
    share = await create(signed_in, three, expires_at=soon(hours=1))
    await expire(db_session, share)
    path = f"/api/shares/{share['id']}"

    extended = (await signed_in.patch(path, json={"expires_at": soon(days=30)})).json()
    never = (await signed_in.patch(path, json={"expires_at": None})).json()

    assert extended["status"] == "active"
    assert never["expires_at"] is None
    assert never["status"] == "active"


async def test_message_and_downloads_can_be_changed(
    signed_in: AsyncClient, three: list[Item]
) -> None:
    share = await create(signed_in, three, message="Hello")

    edited = (
        await signed_in.patch(
            f"/api/shares/{share['id']}", json={"message": None, "allow_downloads": False}
        )
    ).json()

    assert edited["message"] is None
    assert edited["allow_downloads"] is False


async def test_items_can_be_reordered_added_and_removed(
    signed_in: AsyncClient, three: list[Item], make_item: MakeItem
) -> None:
    a, b, c = three
    d = await make_item("D")
    share = await create(signed_in, [a, b, c])

    edited = await signed_in.patch(
        f"/api/shares/{share['id']}", json={"item_ids": [str(c.id), str(d.id), str(a.id)]}
    )

    assert edited.status_code == 200
    assert titles(edited.json()) == ["C", "D", "A"]
    assert titles((await signed_in.get(f"/api/shares/{share['id']}")).json()) == ["C", "D", "A"]


async def test_editing_with_unknown_items_changes_nothing(
    signed_in: AsyncClient, three: list[Item]
) -> None:
    share = await create(signed_in, three)

    response = await signed_in.patch(
        f"/api/shares/{share['id']}", json={"title": "New", "item_ids": [str(uuid.uuid4())]}
    )

    assert response.status_code == 422
    current = (await signed_in.get(f"/api/shares/{share['id']}")).json()
    assert current["title"] == "For Northwind"
    assert titles(current) == ["A", "B", "C"]


# Deleting.


async def test_deleting_a_share_keeps_its_items(
    signed_in: AsyncClient, three: list[Item], db_session: AsyncSession
) -> None:
    share = await create(signed_in, three)

    response = await signed_in.delete(f"/api/shares/{share['id']}")

    assert response.status_code == 204
    assert (await signed_in.get(f"/api/shares/{share['id']}")).status_code == 404
    assert await db_session.scalar(select(func.count()).select_from(Item)) == 3
    assert await db_session.scalar(select(func.count()).select_from(ShareItem)) == 0


async def test_unknown_shares_are_404(signed_in: AsyncClient) -> None:
    missing = uuid.uuid4()
    for method, path in [
        ("GET", f"/api/shares/{missing}"),
        ("PATCH", f"/api/shares/{missing}"),
        ("DELETE", f"/api/shares/{missing}"),
        ("POST", f"/api/shares/{missing}/revoke"),
    ]:
        response = await signed_in.request(method, path, json={})
        assert response.status_code == 404, (method, path)


async def test_deleting_an_item_removes_it_from_its_shares(
    signed_in: AsyncClient, three: list[Item]
) -> None:
    a, b, c = three
    share = await create(signed_in, [c, b, a])

    assert (await signed_in.delete(f"/api/items/{b.id}")).status_code == 204

    current = (await signed_in.get(f"/api/shares/{share['id']}")).json()
    # The share keeps working with what's left, in the same order.
    assert titles(current) == ["C", "A"]
    assert current["item_count"] == 2
    assert current["status"] == "active"


async def test_a_share_whose_items_are_all_deleted_remains_but_is_empty(
    signed_in: AsyncClient, three: list[Item]
) -> None:
    share = await create(signed_in, three[:2])

    await signed_in.post(
        "/api/items/bulk-delete", json={"ids": [str(item.id) for item in three[:2]]}
    )

    current = (await signed_in.get(f"/api/shares/{share['id']}")).json()
    assert current["items"] == []
    assert current["item_count"] == 0
    assert [s["item_count"] for s in (await signed_in.get("/api/shares")).json()] == [0]


# Share counts on items.


async def test_items_report_how_many_shares_include_them(
    signed_in: AsyncClient, three: list[Item]
) -> None:
    a, b, _ = three
    first = await create(signed_in, [a, b])
    await create(signed_in, [a])

    def counts(items: list[dict]) -> dict[str, int]:
        return {item["title"]: item["share_count"] for item in items}

    listed = (await signed_in.get("/api/items")).json()["items"]
    assert counts(listed) == {"A": 2, "B": 1, "C": 0}
    assert (await signed_in.get(f"/api/items/{a.id}")).json()["share_count"] == 2
    # As they were when the first share was created.
    assert counts(first["items"]) == {"A": 1, "B": 1}

    await signed_in.delete(f"/api/shares/{first['id']}")
    listed = (await signed_in.get("/api/items")).json()["items"]
    assert counts(listed) == {"A": 1, "B": 0, "C": 0}


@pytest.mark.parametrize(
    ("method", "path"),
    [
        ("GET", "/api/shares"),
        ("POST", "/api/shares"),
        ("GET", f"/api/shares/{uuid.uuid4()}"),
        ("PATCH", f"/api/shares/{uuid.uuid4()}"),
        ("DELETE", f"/api/shares/{uuid.uuid4()}"),
        ("POST", f"/api/shares/{uuid.uuid4()}/revoke"),
    ],
)
async def test_everything_requires_signing_in(client: AsyncClient, method: str, path: str) -> None:
    response = await client.request(method, path, json={"title": "T", "item_ids": []})

    assert response.status_code == 401


async def test_shares_can_be_filtered_by_the_items_they_contain(
    signed_in: AsyncClient, three: list[Item]
) -> None:
    a, b, c = three
    await create(signed_in, [a, b], title="has A and B")
    await create(signed_in, [b], title="has B")
    await create(signed_in, [c], title="has C")

    async def titles_for(*items: Item) -> set[str]:
        response = await signed_in.get(
            "/api/shares", params={"item_id": [str(item.id) for item in items]}
        )
        assert response.status_code == 200
        return {share["title"] for share in response.json()}

    assert await titles_for(a) == {"has A and B"}
    assert await titles_for(b) == {"has A and B", "has B"}
    assert await titles_for(a, c) == {"has A and B", "has C"}
    assert await titles_for(Item(id=uuid.uuid4())) == set()
