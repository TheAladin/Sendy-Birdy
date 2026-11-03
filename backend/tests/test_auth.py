from datetime import UTC, datetime, timedelta

import pytest
from httpx import AsyncClient
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import security
from app.core.deps import SESSION_COOKIE
from app.core.security import hash_token
from app.models import AuthSession, User
from tests.conftest import ADMIN_EMAIL, ADMIN_PASSWORD


async def log_in(client: AsyncClient, email: str = ADMIN_EMAIL, password: str = ADMIN_PASSWORD):
    return await client.post("/api/auth/login", json={"email": email, "password": password})


async def test_login_returns_the_user_and_sets_a_safe_cookie(
    client: AsyncClient, admin: User
) -> None:
    response = await log_in(client)

    assert response.status_code == 200
    assert response.json() == {
        "id": str(admin.id),
        "email": ADMIN_EMAIL,
        "display_name": "Test Admin",
    }
    cookie = response.headers["set-cookie"].lower()
    assert cookie.startswith(f"{SESSION_COOKIE}=")
    for attribute in ("httponly", "secure", "samesite=strict", "path=/api", "max-age=604800"):
        assert attribute in cookie


async def test_login_ignores_email_case_and_surrounding_spaces(
    client: AsyncClient, admin: User
) -> None:
    response = await log_in(client, email="  Admin@Example.COM ")

    assert response.status_code == 200


async def test_only_a_hash_of_the_session_token_is_stored(
    client: AsyncClient, admin: User, db_session: AsyncSession
) -> None:
    response = await log_in(client)
    token = response.cookies[SESSION_COOKIE]

    stored = await db_session.scalar(select(AuthSession.token_hash))

    assert stored == hash_token(token)
    assert stored != token


@pytest.mark.parametrize(
    ("email", "password"),
    [(ADMIN_EMAIL, "wrong password"), ("nobody@example.com", ADMIN_PASSWORD)],
    ids=["wrong-password", "unknown-email"],
)
async def test_bad_credentials_get_the_same_answer(
    client: AsyncClient, admin: User, email: str, password: str
) -> None:
    response = await log_in(client, email, password)

    assert response.status_code == 401
    assert response.json() == {"detail": "Wrong email or password"}
    assert SESSION_COOKIE not in response.cookies


async def test_unknown_email_still_spends_time_checking_a_password(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    checked: list[str] = []
    real_verify = security.password_hash.verify

    def spy(password: str, hashed: str) -> bool:
        checked.append(hashed)
        return real_verify(password, hashed)

    monkeypatch.setattr(security.password_hash, "verify", spy)

    assert await security.verify_password("anything", None) == (False, None)
    assert checked == [security._DUMMY_HASH]


async def test_me_requires_a_session(client: AsyncClient) -> None:
    response = await client.get("/api/auth/me")

    assert response.status_code == 401


async def test_me_returns_the_signed_in_user(client: AsyncClient, admin: User) -> None:
    await log_in(client)

    response = await client.get("/api/auth/me")

    assert response.status_code == 200
    assert response.json()["email"] == ADMIN_EMAIL


async def test_logout_deletes_the_session_on_the_server(
    client: AsyncClient, admin: User, db_session: AsyncSession
) -> None:
    token = (await log_in(client)).cookies[SESSION_COOKIE]

    response = await client.post("/api/auth/logout")

    assert response.status_code == 204
    assert await db_session.scalar(select(func.count()).select_from(AuthSession)) == 0
    # Even a copy of the old cookie no longer works.
    client.cookies.set(SESSION_COOKIE, token)
    assert (await client.get("/api/auth/me")).status_code == 401


async def test_logout_without_a_session_is_harmless(client: AsyncClient) -> None:
    response = await client.post("/api/auth/logout")

    assert response.status_code == 204


async def test_expired_sessions_are_rejected(
    client: AsyncClient, admin: User, db_session: AsyncSession
) -> None:
    await log_in(client)
    await db_session.execute(
        update(AuthSession).values(expires_at=datetime.now(UTC) - timedelta(seconds=1))
    )

    response = await client.get("/api/auth/me")

    assert response.status_code == 401


async def test_changing_requests_without_the_csrf_header_are_refused(
    client: AsyncClient, admin: User
) -> None:
    del client.headers["X-Requested-With"]

    response = await log_in(client)

    assert response.status_code == 403
    assert response.json() == {"detail": "Missing X-Requested-With header"}


async def test_reading_requests_do_not_need_the_csrf_header(client: AsyncClient) -> None:
    del client.headers["X-Requested-With"]

    assert (await client.get("/api/health")).status_code == 200


async def test_there_is_no_way_to_register(client: AsyncClient) -> None:
    paths = (await client.get("/api/openapi.json")).json()["paths"]

    assert sorted(paths) == [
        "/api/auth/login",
        "/api/auth/logout",
        "/api/auth/me",
        "/api/health",
        "/api/items",
        "/api/items/bulk-delete",
        "/api/items/notes",
        "/api/items/{item_id}",
        "/api/items/{item_id}/file",
        "/api/items/{item_id}/thumbnail",
    ]
