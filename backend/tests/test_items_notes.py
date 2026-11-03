import json

import pytest
from httpx import AsyncClient
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings
from app.models import Item

MARKDOWN = "# Round 2\n\n- New checkout flow\n- **Faster** pages\n"


async def create(client: AsyncClient, title: str, body: str):
    return await client.post("/api/items/notes", json={"title": title, "body": body})


async def test_creating_a_note_stores_it_in_the_database_only(
    signed_in: AsyncClient, settings: Settings, db_session: AsyncSession
) -> None:
    response = await create(signed_in, "  Release notes  ", MARKDOWN)

    assert response.status_code == 201
    body = response.json()
    assert body["kind"] == "note"
    assert body["title"] == "Release notes"
    assert body["body"] == MARKDOWN
    assert body["has_thumbnail"] is False
    assert (body["original_filename"], body["mime_type"], body["size_bytes"]) == (None, None, None)
    assert not (settings.data_dir / "media").exists()
    stored = await db_session.get(Item, body["id"])
    assert stored is not None
    assert stored.body == MARKDOWN


async def test_a_note_of_exactly_100_kb_is_accepted(signed_in: AsyncClient) -> None:
    # "é" is two bytes in UTF-8, so this is 51,200 characters but exactly 100 KB.
    response = await create(signed_in, "Long", "é" * (50 * 1024))

    assert response.status_code == 201


async def test_the_limit_counts_bytes_not_characters(signed_in: AsyncClient) -> None:
    response = await create(signed_in, "Too long", "é" * (50 * 1024) + "x")

    assert response.status_code == 422
    assert "at most 100 KB" in json.dumps(response.json())


@pytest.mark.parametrize(
    ("title", "body", "message"),
    [
        ("   ", MARKDOWN, "needs a title"),
        ("Empty", "  \n ", "can't be empty"),
        ("x" * 201, MARKDOWN, "at most 200"),
    ],
    ids=["blank-title", "blank-body", "long-title"],
)
async def test_invalid_notes_are_refused(
    signed_in: AsyncClient, db_session: AsyncSession, title: str, body: str, message: str
) -> None:
    response = await create(signed_in, title, body)

    assert response.status_code == 422
    assert message in json.dumps(response.json())
    assert await db_session.scalar(select(func.count()).select_from(Item)) == 0


async def test_creating_notes_requires_signing_in(client: AsyncClient) -> None:
    response = await create(client, "Hi", MARKDOWN)

    assert response.status_code == 401


async def test_huge_json_bodies_are_refused_before_being_read(signed_in: AsyncClient) -> None:
    huge = json.dumps({"title": "x", "body": "x" * (2 * 1024 * 1024)})

    declared = await signed_in.post(
        "/api/items/notes", content=huge, headers={"Content-Type": "application/json"}
    )

    async def chunks():
        # No Content-Length: the limit has to be counted while reading.
        for start in range(0, len(huge), 64 * 1024):
            yield huge[start : start + 64 * 1024].encode()

    streamed = await signed_in.post(
        "/api/items/notes", content=chunks(), headers={"Content-Type": "application/json"}
    )

    assert declared.status_code == streamed.status_code == 413
    assert streamed.json() == {"detail": "The request is too large."}


async def test_the_database_refuses_a_note_without_a_body(db_session: AsyncSession) -> None:
    db_session.add(Item(kind="note", title="Broken"))

    with pytest.raises(IntegrityError, match="ck_items_note_has_body"):
        await db_session.flush()
    await db_session.rollback()


async def test_the_database_refuses_media_without_file_details(db_session: AsyncSession) -> None:
    db_session.add(Item(kind="image", title="Broken", original_filename="x.png"))

    with pytest.raises(IntegrityError, match="ck_items_media_has_file"):
        await db_session.flush()
    await db_session.rollback()
