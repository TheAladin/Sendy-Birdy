import uuid
from collections.abc import AsyncIterator
from datetime import UTC, datetime, timedelta

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient, Response
from sqlalchemy import update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Share
from tests import media

PUBLIC_ITEM_FIELDS = {
    "id",
    "kind",
    "title",
    "mime_type",
    "size_bytes",
    "width",
    "height",
    "duration_s",
    "has_thumbnail",
    "body",
}


@pytest.fixture
async def visitor(app: FastAPI) -> AsyncIterator[AsyncClient]:
    """A client opening a link: no session cookie, and no CSRF header either."""
    async with AsyncClient(transport=ASGITransport(app=app), base_url="https://test") as client:
        yield client


class Shared:
    """Two shares made through the admin API: `share` (a screenshot and a note) and `other`
    (another screenshot), plus a screenshot that's in no share."""

    def __init__(self, admin: AsyncClient) -> None:
        self.admin = admin

    async def setup(self) -> "Shared":
        self.shot = await self._upload("Homepage.png", media.png(40, 30))
        self.other_shot = await self._upload("Secret.png", media.png(20, 10))
        self.unshared = await self._upload("Unshared.png", media.png(10, 10))
        note = await self.admin.post(
            "/api/items/notes", json={"title": "Feedback", "body": "# Thanks\n\n- Shorter hero"}
        )
        self.note = note.json()["id"]
        self.share = await self.create([self.shot, self.note], message="Hi! **Round 2**")
        self.other = await self.create([self.other_shot])
        return self

    async def _upload(self, filename: str, content: bytes) -> str:
        response = await self.admin.post(
            "/api/items", params={"filename": filename}, content=content
        )
        assert response.status_code == 201
        return response.json()["id"]

    async def create(self, item_ids: list[str], **fields: object) -> dict:
        response = await self.admin.post(
            "/api/shares", json={"title": "Northwind - round 2", "item_ids": item_ids, **fields}
        )
        assert response.status_code == 201
        return response.json()

    @property
    def token(self) -> str:
        return self.share["url"].rsplit("/", 1)[1]

    def file(self, item_id: str, token: str | None = None) -> str:
        return f"/api/public/shares/{token or self.token}/items/{item_id}/file"

    def thumbnail(self, item_id: str, token: str | None = None) -> str:
        return f"/api/public/shares/{token or self.token}/items/{item_id}/thumbnail"


@pytest.fixture
async def shared(signed_in: AsyncClient) -> Shared:
    return await Shared(signed_in).setup()


def assert_public_headers(response: Response) -> None:
    assert response.headers["referrer-policy"] == "no-referrer"
    assert response.headers["x-robots-tag"] == "noindex, nofollow"
    assert response.headers["cache-control"].startswith("private")


# The share itself.


async def test_a_link_shows_the_share_without_signing_in(
    visitor: AsyncClient, shared: Shared, signed_in: AsyncClient
) -> None:
    me = (await signed_in.get("/api/auth/me")).json()

    response = await visitor.get(f"/api/public/shares/{shared.token}")

    assert response.status_code == 200
    body = response.json()
    assert body["title"] == "Northwind - round 2"
    assert body["message"] == "Hi! **Round 2**"
    assert body["shared_by"] == me["display_name"]
    assert body["expires_at"] is None
    assert body["allow_downloads"] is True
    assert [item["title"] for item in body["items"]] == ["Homepage", "Feedback"]
    assert body["items"][1]["body"] == "# Thanks\n\n- Shorter hero"


async def test_nothing_internal_is_revealed(visitor: AsyncClient, shared: Shared) -> None:
    body = (await visitor.get(f"/api/public/shares/{shared.token}")).json()

    assert set(body) == {
        "title",
        "message",
        "shared_by",
        "retention_days",
        "expires_at",
        "allow_downloads",
        "items",
    }
    assert body["retention_days"] == 90
    for item in body["items"]:
        # No hashes, original file names, dates, share counts or ids of other things.
        assert set(item) == PUBLIC_ITEM_FIELDS


async def test_each_view_is_counted(
    visitor: AsyncClient, shared: Shared, signed_in: AsyncClient
) -> None:
    await visitor.get(f"/api/public/shares/{shared.token}")
    await visitor.get(f"/api/public/shares/{shared.token}")
    # Loading the files isn't a new view.
    await visitor.get(shared.file(shared.shot))
    await visitor.get(shared.thumbnail(shared.shot))

    seen = (await signed_in.get(f"/api/shares/{shared.share['id']}")).json()
    assert seen["view_count"] == 2
    assert datetime.fromisoformat(seen["last_viewed_at"]) > datetime.now(UTC) - timedelta(minutes=1)
    other = (await signed_in.get(f"/api/shares/{shared.other['id']}")).json()
    assert other["view_count"] == 0


async def test_an_unknown_token_is_404(visitor: AsyncClient, shared: Shared) -> None:
    for path in [
        "/api/public/shares/not-a-real-token",
        shared.file(shared.shot, token="not-a-real-token"),
        shared.thumbnail(shared.shot, token="not-a-real-token"),
    ]:
        response = await visitor.get(path)
        assert response.status_code == 404, path
        assert_public_headers(response)


# Expired and revoked links.


async def expire(db_session: AsyncSession, share: dict) -> None:
    await db_session.execute(
        update(Share)
        .where(Share.id == uuid.UUID(share["id"]))
        .values(expires_at=datetime.now(UTC) - timedelta(seconds=1))
    )


async def test_an_expired_link_is_gone_with_the_reason(
    visitor: AsyncClient, shared: Shared, db_session: AsyncSession, signed_in: AsyncClient
) -> None:
    await expire(db_session, shared.share)

    response = await visitor.get(f"/api/public/shares/{shared.token}")

    assert response.status_code == 410
    assert response.json()["detail"] == {
        "reason": "expired",
        "message": "This link has expired.",
    }
    assert_public_headers(response)
    # Nothing was shown, so it isn't a view.
    assert (await signed_in.get(f"/api/shares/{shared.share['id']}")).json()["view_count"] == 0


async def test_revoking_cuts_off_the_page_and_its_files_at_once(
    visitor: AsyncClient, shared: Shared, signed_in: AsyncClient
) -> None:
    # Working before...
    assert (await visitor.get(shared.file(shared.shot))).status_code == 200

    await signed_in.post(f"/api/shares/{shared.share['id']}/revoke")

    # ...and gone right after, for the page and for files a client may still have open.
    for path in [
        f"/api/public/shares/{shared.token}",
        shared.file(shared.shot),
        shared.file(shared.shot) + "?download=1",
        shared.thumbnail(shared.shot),
    ]:
        response = await visitor.get(path)
        assert response.status_code == 410, path
        assert response.json()["detail"]["reason"] == "revoked"


async def test_files_of_an_expired_link_are_gone(
    visitor: AsyncClient, shared: Shared, db_session: AsyncSession
) -> None:
    await expire(db_session, shared.share)

    assert (await visitor.get(shared.file(shared.shot))).status_code == 410
    assert (await visitor.get(shared.thumbnail(shared.shot))).status_code == 410


# Files.


async def test_a_shared_file_is_shown_inline(
    visitor: AsyncClient, shared: Shared, signed_in: AsyncClient
) -> None:
    response = await visitor.get(shared.file(shared.shot))

    assert response.status_code == 200
    assert response.headers["content-type"] == "image/png"
    assert response.headers["content-disposition"].startswith("inline")
    assert response.content == (await signed_in.get(f"/api/items/{shared.shot}/file")).content
    # The same protections as admin files, but a short private cache.
    assert response.headers["x-content-type-options"] == "nosniff"
    assert response.headers["content-security-policy"] == (
        "default-src 'none'; sandbox; frame-ancestors 'none'"
    )
    assert response.headers["cache-control"] == "private, max-age=3600"
    assert_public_headers(response)


async def test_shared_files_support_ranges(visitor: AsyncClient, shared: Shared) -> None:
    response = await visitor.get(shared.file(shared.shot), headers={"Range": "bytes=0-7"})

    assert response.status_code == 206
    assert response.content == b"\x89PNG\r\n\x1a\n"


async def test_a_shared_thumbnail(visitor: AsyncClient, shared: Shared) -> None:
    response = await visitor.get(shared.thumbnail(shared.shot))

    assert response.status_code == 200
    assert response.headers["content-type"] == "image/webp"
    assert_public_headers(response)


async def test_downloading_is_allowed_by_default(visitor: AsyncClient, shared: Shared) -> None:
    response = await visitor.get(shared.file(shared.shot), params={"download": 1})

    assert response.status_code == 200
    assert response.headers["content-disposition"] == 'attachment; filename="Homepage.png"'


async def test_downloads_can_be_turned_off(
    visitor: AsyncClient, shared: Shared, signed_in: AsyncClient
) -> None:
    await signed_in.patch(f"/api/shares/{shared.share['id']}", json={"allow_downloads": False})

    download = await visitor.get(shared.file(shared.shot), params={"download": 1})
    shown = await visitor.get(shared.file(shared.shot))

    assert download.status_code == 403
    assert download.json()["detail"] == "Downloads are turned off for this link."
    # Viewing in the page still works: the switch is about the download button.
    assert shown.status_code == 200
    page = (await visitor.get(f"/api/public/shares/{shared.token}")).json()
    assert page["allow_downloads"] is False


async def test_items_from_elsewhere_are_not_found(visitor: AsyncClient, shared: Shared) -> None:
    for item_id in [shared.other_shot, shared.unshared, str(uuid.uuid4())]:
        for path in [shared.file(item_id), shared.thumbnail(item_id)]:
            response = await visitor.get(path)
            # The same answer whether the item exists or not, so a link reveals nothing else.
            assert response.status_code == 404, path
            assert response.json()["detail"] == "Not found."


async def test_notes_have_no_file(visitor: AsyncClient, shared: Shared) -> None:
    assert (await visitor.get(shared.file(shared.note))).status_code == 404
    assert (await visitor.get(shared.thumbnail(shared.note))).status_code == 404


async def test_a_deleted_item_disappears_from_the_link(
    visitor: AsyncClient, shared: Shared, signed_in: AsyncClient
) -> None:
    await signed_in.delete(f"/api/items/{shared.shot}")

    page = (await visitor.get(f"/api/public/shares/{shared.token}")).json()

    assert [item["title"] for item in page["items"]] == ["Feedback"]
    assert (await visitor.get(shared.file(shared.shot))).status_code == 404


async def test_the_share_page_is_never_cached(visitor: AsyncClient, shared: Shared) -> None:
    response = await visitor.get(f"/api/public/shares/{shared.token}")

    assert response.headers["cache-control"] == "private, no-store"
    assert_public_headers(response)


async def test_admin_responses_do_not_get_public_headers(signed_in: AsyncClient) -> None:
    response = await signed_in.get("/api/items")

    assert "x-robots-tag" not in response.headers
