import uuid
from pathlib import Path

import pytest
from httpx import AsyncClient
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings
from app.models import Item
from tests import media
from tests.conftest import MakeItem


async def titles(client: AsyncClient, **params: object) -> list[str]:
    response = await client.get("/api/items", params=params)
    assert response.status_code == 200
    return [item["title"] for item in response.json()["items"]]


async def test_items_are_listed_newest_first(signed_in: AsyncClient, make_item: MakeItem) -> None:
    await make_item("old", minutes=1)
    await make_item("newest", minutes=3)
    await make_item("middle", minutes=2)

    assert await titles(signed_in) == ["newest", "middle", "old"]


async def test_items_can_be_filtered_by_kind(signed_in: AsyncClient, make_item: MakeItem) -> None:
    await make_item("a note", "note", 1)
    await make_item("a photo", "image", 2)
    await make_item("a clip", "video", 3)

    assert await titles(signed_in, kind="image") == ["a photo"]
    assert await titles(signed_in, kind="note") == ["a note"]


async def test_search_matches_part_of_a_title_in_any_case(
    signed_in: AsyncClient, make_item: MakeItem
) -> None:
    await make_item("Homepage Redesign", minutes=1)
    await make_item("Checkout flow", minutes=2)

    assert await titles(signed_in, q="redes") == ["Homepage Redesign"]
    assert await titles(signed_in, q="  FLOW ") == ["Checkout flow"]
    assert await titles(signed_in, q="nothing like this") == []


async def test_search_treats_percent_and_underscore_literally(
    signed_in: AsyncClient, make_item: MakeItem
) -> None:
    await make_item("50% off banner", minutes=1)
    await make_item("500 users", minutes=2)
    await make_item("final_v2", minutes=3)
    await make_item("final-v2", minutes=4)

    assert await titles(signed_in, q="50%") == ["50% off banner"]
    assert await titles(signed_in, q="final_") == ["final_v2"]


async def test_pages_follow_each_other_without_gaps_or_repeats(
    signed_in: AsyncClient, make_item: MakeItem
) -> None:
    for minute in range(5):
        await make_item(f"item {minute}", minutes=minute)

    first = (await signed_in.get("/api/items", params={"limit": 2})).json()
    # Something new arrives between page loads; it must not shift the next pages.
    await make_item("brand new", minutes=99)
    second = (
        await signed_in.get("/api/items", params={"limit": 2, "cursor": first["next_cursor"]})
    ).json()
    third = (
        await signed_in.get("/api/items", params={"limit": 2, "cursor": second["next_cursor"]})
    ).json()

    pages = [[item["title"] for item in page["items"]] for page in (first, second, third)]
    assert pages == [["item 4", "item 3"], ["item 2", "item 1"], ["item 0"]]
    assert third["next_cursor"] is None


async def test_an_invalid_cursor_is_refused(signed_in: AsyncClient) -> None:
    response = await signed_in.get("/api/items", params={"cursor": "not-a-cursor"})

    assert response.status_code == 400


async def test_lists_show_a_short_excerpt_of_notes_but_not_the_full_text(
    signed_in: AsyncClient, make_item: MakeItem
) -> None:
    long_body = "# Changes\n\n" + "word " * 100
    note = await make_item("Release notes", body=long_body)

    listed = (await signed_in.get("/api/items")).json()["items"][0]
    single = (await signed_in.get(f"/api/items/{note.id}")).json()

    assert "body" not in listed
    # Plain text: the Markdown "#" is gone.
    assert listed["excerpt"].startswith("Changes word word")
    assert listed["excerpt"].endswith("…")
    assert len(listed["excerpt"]) <= 201
    assert single["body"] == long_body


async def test_getting_an_unknown_item_is_a_404(signed_in: AsyncClient) -> None:
    assert (await signed_in.get(f"/api/items/{uuid.uuid4()}")).status_code == 404
    assert (await signed_in.get("/api/items/not-a-uuid")).status_code == 422


async def test_renaming_an_item(signed_in: AsyncClient, make_item: MakeItem) -> None:
    item = await make_item("Old name", kind="image")

    response = await signed_in.patch(f"/api/items/{item.id}", json={"title": "  New name "})

    assert response.status_code == 200
    assert response.json()["title"] == "New name"


async def test_editing_a_notes_text(signed_in: AsyncClient, make_item: MakeItem) -> None:
    note = await make_item("Notes", body="first draft")

    response = await signed_in.patch(f"/api/items/{note.id}", json={"body": "# Final"})

    assert response.json()["body"] == "# Final"
    assert response.json()["title"] == "Notes"


@pytest.mark.parametrize(
    ("kind", "changes", "status"),
    [
        ("image", {"body": "text"}, 422),
        ("note", {}, 422),
        ("note", {"title": "   "}, 422),
        ("note", {"body": "é" * (50 * 1024) + "x"}, 422),
    ],
    ids=["body-on-an-image", "nothing-to-change", "blank-title", "body-too-long"],
)
async def test_invalid_edits_are_refused(
    signed_in: AsyncClient, make_item: MakeItem, kind: str, changes: dict, status: int
) -> None:
    item = await make_item("Original", kind=kind)

    response = await signed_in.patch(f"/api/items/{item.id}", json=changes)

    assert response.status_code == status
    assert (await signed_in.get(f"/api/items/{item.id}")).json()["title"] == "Original"


def media_files(settings: Settings) -> list[Path]:
    folder = settings.data_dir / "media"
    return [path for path in folder.rglob("*") if path.is_file()] if folder.exists() else []


async def upload_image(client: AsyncClient) -> str:
    response = await client.post("/api/items", params={"filename": "shot.png"}, content=media.png())
    return response.json()["id"]


async def test_deleting_an_item_removes_its_files(
    signed_in: AsyncClient, settings: Settings, db_session: AsyncSession
) -> None:
    item_id = await upload_image(signed_in)
    assert len(media_files(settings)) == 2  # original + thumbnail

    response = await signed_in.delete(f"/api/items/{item_id}")

    assert response.status_code == 204
    assert media_files(settings) == []
    assert await db_session.get(Item, uuid.UUID(item_id)) is None
    assert (await signed_in.delete(f"/api/items/{item_id}")).status_code == 404


async def test_files_are_kept_when_the_delete_cannot_be_saved(
    signed_in: AsyncClient,
    settings: Settings,
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    item_id = await upload_image(signed_in)

    async def failing_commit() -> None:
        raise RuntimeError("database went away")

    monkeypatch.setattr(db_session, "commit", failing_commit)
    with pytest.raises(RuntimeError, match="database went away"):
        await signed_in.delete(f"/api/items/{item_id}")

    # The item wasn't deleted, so its files must still be there.
    assert len(media_files(settings)) == 2


async def test_bulk_delete_removes_several_items_and_ignores_unknown_ids(
    signed_in: AsyncClient, settings: Settings, db_session: AsyncSession, make_item: MakeItem
) -> None:
    first, second = await upload_image(signed_in), await upload_image(signed_in)
    note = await make_item("note")
    keep = await make_item("keep me")

    response = await signed_in.post(
        "/api/items/bulk-delete", json={"ids": [first, second, str(note.id), str(uuid.uuid4())]}
    )

    assert response.json() == {"deleted": 3}
    assert media_files(settings) == []
    remaining = await db_session.scalars(select(Item.title))
    assert list(remaining) == [keep.title]


async def test_bulk_delete_needs_at_least_one_id(signed_in: AsyncClient) -> None:
    response = await signed_in.post("/api/items/bulk-delete", json={"ids": []})

    assert response.status_code == 422


@pytest.mark.parametrize(
    ("method", "path"),
    [
        ("GET", "/api/items"),
        ("GET", f"/api/items/{uuid.uuid4()}"),
        ("PATCH", f"/api/items/{uuid.uuid4()}"),
        ("DELETE", f"/api/items/{uuid.uuid4()}"),
        ("POST", "/api/items/bulk-delete"),
    ],
)
async def test_everything_requires_signing_in(
    client: AsyncClient, db_session: AsyncSession, method: str, path: str
) -> None:
    response = await client.request(method, path, json={"ids": [str(uuid.uuid4())]})

    assert response.status_code == 401
    assert await db_session.scalar(select(func.count()).select_from(Item)) == 0
