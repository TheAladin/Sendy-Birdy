from collections.abc import AsyncIterator
from pathlib import Path

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from app.core.config import Settings
from app.main import create_app
from tests.frontend_build import ASSET, INDEX, SCRIPT, make_build


@pytest.fixture
def frontend_dir(settings: Settings) -> Path:
    return make_build(settings.frontend_dir)


@pytest.fixture
async def web(frontend_dir: Path, app: FastAPI) -> AsyncIterator[AsyncClient]:
    # A new app: the build has to exist when create_app() runs, and `app` was made before it.
    assert app.state.settings.frontend_dir == frontend_dir
    built = create_app(app.state.settings)
    built.dependency_overrides = app.dependency_overrides
    async with AsyncClient(transport=ASGITransport(app=built), base_url="https://test") as client:
        yield client


@pytest.mark.parametrize("path", ["/", "/login", "/library", "/s/some-token", "/shares/x/y"])
async def test_app_paths_get_index_html(web: AsyncClient, path: str) -> None:
    response = await web.get(path)
    assert response.status_code == 200
    assert response.text == INDEX
    assert response.headers["content-type"].startswith("text/html")
    assert response.headers["cache-control"] == "no-cache"


async def test_hashed_assets_are_cached_for_a_year(web: AsyncClient) -> None:
    response = await web.get(ASSET)
    assert response.status_code == 200
    assert response.text == SCRIPT
    assert response.headers["content-type"].startswith("text/javascript")
    assert response.headers["cache-control"] == "public, max-age=31536000, immutable"


async def test_unhashed_files_are_revalidated(web: AsyncClient) -> None:
    response = await web.get("/favicon.svg")
    assert response.status_code == 200
    assert response.headers["content-type"] == "image/svg+xml"
    assert response.headers["cache-control"] == "no-cache"


async def test_unchanged_files_answer_304(web: AsyncClient) -> None:
    etag = (await web.get("/")).headers["etag"]
    response = await web.get("/", headers={"If-None-Match": etag})
    assert response.status_code == 304
    assert response.headers["cache-control"] == "no-cache"


async def test_missing_assets_are_404_not_html(web: AsyncClient) -> None:
    # An old build asking for a chunk that's gone must fail loudly, not get index.html as JS.
    response = await web.get("/assets/old-chunk-Zz99.js")
    assert response.status_code == 404
    assert "text/html" not in response.headers["content-type"]


@pytest.mark.parametrize("path", ["/api", "/api/", "/api/nope", "/api/items/x/y/z"])
async def test_unknown_api_paths_stay_404(web: AsyncClient, path: str) -> None:
    response = await web.get(path)
    assert response.status_code == 404
    assert response.json() == {"detail": "Not Found"}


async def test_api_routes_still_answer(web: AsyncClient) -> None:
    assert (await web.get("/api/health")).json() == {"status": "ok"}
    assert (await web.get("/api/docs")).status_code == 200
    # Wrong method on a real API route keeps its 405; the frontend doesn't swallow it.
    assert (await web.get("/api/auth/login")).status_code == 405


async def test_nothing_outside_the_build_is_served(web: AsyncClient, frontend_dir: Path) -> None:
    (frontend_dir.parent / "secret.txt").write_text("private")
    for path in ["/../secret.txt", "/%2e%2e/secret.txt", "/assets/..%2f..%2fsecret.txt"]:
        response = await web.get(path)
        assert "private" not in response.text


async def test_only_reads_are_allowed(web: AsyncClient) -> None:
    response = await web.post("/library", headers={"X-Requested-With": "fetch"})
    assert response.status_code == 405


async def test_without_a_build_only_the_api_is_served(client: AsyncClient) -> None:
    assert (await client.get("/")).status_code == 404
    assert (await client.get("/api/health")).status_code == 200
