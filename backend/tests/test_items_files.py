import uuid
from urllib.parse import quote

import pytest
from httpx import AsyncClient

from app.core.config import Settings
from tests import media


async def upload(client: AsyncClient, data: bytes, filename: str) -> dict:
    response = await client.post("/api/items", params={"filename": filename}, content=data)
    assert response.status_code == 201
    return response.json()


def stored(settings: Settings, item_id: str) -> bytes:
    return (settings.data_dir / "media" / "originals" / item_id).read_bytes()


async def test_a_file_is_served_inline_with_its_detected_type(
    signed_in: AsyncClient, settings: Settings
) -> None:
    item = await upload(signed_in, media.png(), "hero.png")

    response = await signed_in.get(f"/api/items/{item['id']}/file")

    assert response.status_code == 200
    assert response.content == stored(settings, item["id"])
    assert response.headers["content-type"] == "image/png"
    assert response.headers["content-disposition"].startswith("inline")
    assert response.headers["x-content-type-options"] == "nosniff"
    assert "sandbox" in response.headers["content-security-policy"]
    assert response.headers["cache-control"].startswith("private")


async def test_download_uses_the_current_title_and_original_extension(
    signed_in: AsyncClient,
) -> None:
    item = await upload(signed_in, media.png(), "IMG_2041.png")
    await signed_in.patch(f"/api/items/{item['id']}", json={"title": "Écran accueil v2"})

    response = await signed_in.get(f"/api/items/{item['id']}/file", params={"download": 1})

    disposition = response.headers["content-disposition"]
    assert disposition.startswith("attachment")
    # Non-ASCII names are sent in the RFC 5987 form browsers understand.
    assert f"filename*=utf-8''{quote('Écran accueil v2.png')}" in disposition


async def test_range_requests_return_just_that_part(
    signed_in: AsyncClient, settings: Settings, tmp_path
) -> None:
    item = await upload(signed_in, b"\x00\x00\x00\x18ftypmp42" + bytes(range(256)) * 40, "demo.mp4")
    whole = stored(settings, item["id"])

    response = await signed_in.get(
        f"/api/items/{item['id']}/file", headers={"Range": "bytes=100-199"}
    )

    assert response.status_code == 206
    assert response.content == whole[100:200]
    assert response.headers["content-range"] == f"bytes 100-199/{len(whole)}"
    assert response.headers["accept-ranges"] == "bytes"


async def test_an_impossible_range_is_refused(signed_in: AsyncClient) -> None:
    item = await upload(signed_in, media.png(), "hero.png")

    response = await signed_in.get(
        f"/api/items/{item['id']}/file", headers={"Range": "bytes=999999-"}
    )

    assert response.status_code == 416


async def test_thumbnails_are_webp(signed_in: AsyncClient) -> None:
    item = await upload(signed_in, media.png(1200, 800), "wide.png")

    response = await signed_in.get(f"/api/items/{item['id']}/thumbnail")

    assert response.status_code == 200
    assert response.headers["content-type"] == "image/webp"
    assert response.content[8:12] == b"WEBP"


async def test_items_without_a_file_or_thumbnail_answer_404(signed_in: AsyncClient) -> None:
    note = (
        await signed_in.post("/api/items/notes", json={"title": "Notes", "body": "# Hi"})
    ).json()
    unreadable_video = await upload(signed_in, b"\x00\x00\x00\x18ftypmp42" + b"\x00" * 64, "x.mp4")

    assert (await signed_in.get(f"/api/items/{note['id']}/file")).status_code == 404
    assert (await signed_in.get(f"/api/items/{note['id']}/thumbnail")).status_code == 404
    assert (
        await signed_in.get(f"/api/items/{unreadable_video['id']}/thumbnail")
    ).status_code == 404
    assert (await signed_in.get(f"/api/items/{uuid.uuid4()}/file")).status_code == 404


async def test_a_file_missing_from_disk_is_a_404_not_a_crash(
    signed_in: AsyncClient, settings: Settings
) -> None:
    item = await upload(signed_in, media.png(), "hero.png")
    (settings.data_dir / "media" / "originals" / item["id"]).unlink()

    response = await signed_in.get(f"/api/items/{item['id']}/file")

    assert response.status_code == 404


@pytest.mark.parametrize("path", ["file", "thumbnail"])
async def test_files_require_signing_in(
    signed_in: AsyncClient, client: AsyncClient, path: str
) -> None:
    item = await upload(signed_in, media.png(), "hero.png")
    await signed_in.post("/api/auth/logout")

    response = await client.get(f"/api/items/{item['id']}/{path}")

    assert response.status_code == 401
