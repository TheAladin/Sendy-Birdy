from collections.abc import AsyncIterator

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient, Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings
from app.core.headers import API_POLICY, APP_POLICY, DOCS_POLICY
from app.db.session import get_session
from app.main import create_app
from tests import media
from tests.frontend_build import ASSET, make_build


def built_app(settings: Settings, db_session: AsyncSession, mode: str = "admin") -> FastAPI:
    make_build(settings.frontend_dir)
    app = create_app(settings.model_copy(update={"app_mode": mode}))
    app.dependency_overrides[get_session] = lambda: db_session
    return app


@pytest.fixture
async def web(settings: Settings, db_session: AsyncSession) -> AsyncIterator[AsyncClient]:
    transport = ASGITransport(app=built_app(settings, db_session))
    async with AsyncClient(transport=transport, base_url="https://test") as client:
        yield client


def assert_common_headers(response: Response) -> None:
    assert response.headers["x-content-type-options"] == "nosniff"
    assert response.headers["referrer-policy"] == "no-referrer"
    assert "camera=()" in response.headers["permissions-policy"]
    assert response.headers["cross-origin-opener-policy"] == "same-origin"
    assert response.headers["cross-origin-resource-policy"] == "same-origin"
    assert response.headers["strict-transport-security"] == "max-age=31536000"


def test_the_app_policy_allows_nothing_inline_or_foreign() -> None:
    directives = dict(part.split(" ", 1) for part in APP_POLICY.split("; "))
    assert directives["default-src"] == "'self'"
    assert directives["frame-ancestors"] == "'none'"
    assert directives["object-src"] == "'none'"
    assert directives["base-uri"] == "'none'"
    # No directive may loosen default-src: no inline code, no eval, no other origins.
    assert "unsafe" not in APP_POLICY
    assert "http" not in APP_POLICY


@pytest.mark.parametrize("path", ["/", "/login", "/s/some-token", ASSET, "/favicon.svg"])
async def test_pages_and_their_files_get_the_app_policy(web: AsyncClient, path: str) -> None:
    response = await web.get(path)
    assert response.status_code == 200
    assert response.headers["content-security-policy"] == APP_POLICY
    assert_common_headers(response)


async def test_api_answers_get_the_strict_policy(web: AsyncClient) -> None:
    response = await web.get("/api/health")
    assert response.headers["content-security-policy"] == API_POLICY
    assert_common_headers(response)


async def test_errors_get_the_headers_too(web: AsyncClient) -> None:
    unknown = await web.get("/api/nope")
    assert unknown.status_code == 404
    assert unknown.headers["content-security-policy"] == API_POLICY
    assert_common_headers(unknown)

    # Refused by the CSRF middleware, before any route runs.
    refused = await web.post("/api/auth/logout")
    assert refused.status_code == 403
    assert_common_headers(refused)

    missing_asset = await web.get("/assets/gone.js")
    assert missing_asset.status_code == 404
    assert_common_headers(missing_asset)


async def test_the_api_docs_get_their_own_policy(web: AsyncClient) -> None:
    for path in ["/api/docs", "/api/docs/oauth2-redirect"]:
        response = await web.get(path)
        assert response.status_code == 200
        assert response.headers["content-security-policy"] == DOCS_POLICY
        assert_common_headers(response)
    assert (await web.get("/api/openapi.json")).headers["content-security-policy"] == API_POLICY


async def test_files_keep_their_sandbox(signed_in: AsyncClient) -> None:
    upload = await signed_in.post(
        "/api/items", params={"filename": "Shot.png"}, content=media.png(20, 10)
    )
    item = upload.json()["id"]
    for path in [f"/api/items/{item}/file", f"/api/items/{item}/thumbnail"]:
        response = await signed_in.get(path)
        assert response.headers["content-security-policy"] == (
            "default-src 'none'; sandbox; frame-ancestors 'none'"
        )
        assert_common_headers(response)


async def test_the_public_app_gets_the_same_headers(
    settings: Settings, db_session: AsyncSession
) -> None:
    transport = ASGITransport(app=built_app(settings, db_session, mode="public"))
    async with AsyncClient(transport=transport, base_url="https://test") as public:
        page = await public.get("/s/some-token")
        assert page.headers["content-security-policy"] == APP_POLICY
        assert_common_headers(page)

        share = await public.get("/api/public/shares/no-such-token")
        assert share.status_code == 404
        assert share.headers["content-security-policy"] == API_POLICY
        assert_common_headers(share)
        # The public middleware's own headers still apply.
        assert share.headers["x-robots-tag"] == "noindex, nofollow"


async def test_hsts_only_over_https(settings: Settings, db_session: AsyncSession) -> None:
    transport = ASGITransport(app=built_app(settings, db_session))
    async with AsyncClient(transport=transport, base_url="http://test") as plain:
        response = await plain.get("/")
    assert "strict-transport-security" not in response.headers
    # Everything else is still there.
    assert response.headers["content-security-policy"] == APP_POLICY
    assert response.headers["x-content-type-options"] == "nosniff"
