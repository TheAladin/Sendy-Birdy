import asyncio
import re
import uuid
from collections.abc import AsyncIterator, Coroutine

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app import main
from app.core.config import Settings
from app.db.session import get_session
from app.main import create_app
from tests import media
from tests.frontend_build import ASSET, INDEX, make_build
from tests.test_public_shares import Shared


def public_app(settings: Settings, db_session: AsyncSession) -> FastAPI:
    app = create_app(settings.model_copy(update={"app_mode": "public"}))
    app.dependency_overrides[get_session] = lambda: db_session
    return app


@pytest.fixture
async def public(settings: Settings, db_session: AsyncSession) -> AsyncIterator[AsyncClient]:
    """A client on the public app (APP_MODE=public), sharing the admin app's database."""
    async with AsyncClient(
        transport=ASGITransport(app=public_app(settings, db_session)),
        base_url="https://test",
        # The CSRF header, so refused writes really are "no such route", not the CSRF check.
        headers={"X-Requested-With": "fetch"},
    ) as client:
        yield client


def admin_routes(app: FastAPI) -> list[tuple[str, str]]:
    """Every (method, path) the admin app answers outside /api/public, docs included."""
    routes = [
        ("GET", "/api/docs"),
        ("GET", "/api/docs/oauth2-redirect"),
        ("GET", "/api/openapi.json"),
    ]
    for path, operations in app.openapi()["paths"].items():
        if path.startswith("/api/public/"):
            continue
        # Any id will do: the route itself must be missing, whatever the parameters.
        concrete = re.sub(r"\{[^}]+\}", str(uuid.uuid4()), path)
        routes += [(method.upper(), concrete) for method in operations]
    return routes


async def test_every_admin_route_is_404_in_public_mode(app: FastAPI, public: AsyncClient) -> None:
    routes = admin_routes(app)
    # Make sure the list really covers the admin API, or this test proves nothing.
    assert ("GET", "/api/docs") in routes
    assert ("GET", "/api/openapi.json") in routes
    assert ("POST", "/api/auth/login") in routes
    assert ("POST", "/api/items/bulk-delete") in routes
    assert len(routes) >= 20

    for method, path in routes:
        response = await public.request(method, path, json={})
        assert response.status_code == 404, (method, path)


async def test_shares_open_on_the_public_app(signed_in: AsyncClient, public: AsyncClient) -> None:
    shared = await Shared(signed_in).setup()

    page = await public.get(f"/api/public/shares/{shared.token}")
    assert page.status_code == 200
    assert page.json()["title"] == "Northwind - round 2"
    assert (await public.get(shared.file(shared.shot))).status_code == 200
    assert (await public.get(shared.thumbnail(shared.shot))).status_code == 200


async def test_protected_shares_unlock_on_the_public_app(
    signed_in: AsyncClient, public: AsyncClient
) -> None:
    shared = Shared(signed_in)
    shot = await shared._upload("Homepage.png", media.png(10, 10))
    token = (await shared.create([shot], password="open sesame"))["url"].rsplit("/", 1)[1]
    url = f"/api/public/shares/{token}"

    assert (await public.get(url)).status_code == 403
    assert (await public.post(f"{url}/unlock", json={"password": "wrong"})).status_code == 401
    assert (await public.post(f"{url}/unlock", json={"password": "open sesame"})).status_code == 204
    assert (await public.get(url)).status_code == 200


async def test_the_admin_app_still_has_everything(client: AsyncClient) -> None:
    paths = (await client.get("/api/openapi.json")).json()["paths"]
    assert "/api/auth/login" in paths
    assert "/api/public/shares/{token}" in paths


@pytest.fixture
async def public_web(settings: Settings, db_session: AsyncSession) -> AsyncIterator[AsyncClient]:
    make_build(settings.frontend_dir)
    async with AsyncClient(
        transport=ASGITransport(app=public_app(settings, db_session)), base_url="https://test"
    ) as client:
        yield client


async def test_the_public_app_serves_only_the_share_page(public_web: AsyncClient) -> None:
    page = await public_web.get("/s/some-token")
    assert page.status_code == 200
    assert page.text == INDEX

    # The share page needs the build's files; every other page of the app is gone.
    assert (await public_web.get(ASSET)).status_code == 200
    assert (await public_web.get("/favicon.svg")).status_code == 200
    for path in ["/", "/login", "/library", "/shares", "/activity", "/ui", "/s", "/s/a/b"]:
        assert (await public_web.get(path)).status_code == 404, path


@pytest.mark.parametrize(("mode", "cleans"), [("admin", True), ("public", False)])
async def test_only_the_admin_app_cleans_up_old_records(
    settings: Settings, monkeypatch: pytest.MonkeyPatch, mode: str, cleans: bool
) -> None:
    started = []

    # Records the call itself: lifespan cancels the task before its body would get to run.
    def fake_cleanup(app: FastAPI) -> Coroutine[None, None, None]:
        started.append(app)
        return asyncio.sleep(0)

    monkeypatch.setattr(main, "cleanup_daily", fake_cleanup)
    app = create_app(settings.model_copy(update={"app_mode": mode}))
    async with main.lifespan(app):
        pass
    assert bool(started) is cleans
