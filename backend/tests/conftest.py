import os
from collections.abc import AsyncIterator
from pathlib import Path

import pytest
from dotenv import dotenv_values
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from sqlalchemy import text
from sqlalchemy.engine import make_url
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, create_async_engine

from app import models  # noqa: F401  (registers every table on Base.metadata)
from app.core.config import REPO_ROOT, Settings
from app.core.security import hash_password
from app.db.base import Base
from app.db.session import get_session
from app.main import create_app
from app.models import User

TEST_SECRET_KEY = "test-secret-key-that-is-at-least-32-chars"
ADMIN_EMAIL = "admin@example.com"
ADMIN_PASSWORD = "correct horse battery staple"


def _test_database_url() -> str:
    # The only value tests take from .env: where the test database lives (set by `make db-setup`).
    url = os.environ.get("TEST_DATABASE_URL") or dotenv_values(REPO_ROOT / ".env").get(
        "TEST_DATABASE_URL"
    )
    if not url:
        pytest.exit("TEST_DATABASE_URL is not set. Run `make db-setup` first.", returncode=1)
    database = make_url(url).database or ""
    if not database.endswith("_test"):
        # Tests drop and recreate every table; never let that happen to real data.
        pytest.exit(f"Refusing to run tests against '{database}': name must end in _test.", 1)
    return url


@pytest.fixture(scope="session")
def test_database_url() -> str:
    return _test_database_url()


@pytest.fixture(scope="session")
async def engine(test_database_url: str) -> AsyncIterator[AsyncEngine]:
    engine = create_async_engine(test_database_url)
    async with engine.begin() as connection:
        # Migrations normally create this; tests build tables straight from the models.
        await connection.execute(text("CREATE EXTENSION IF NOT EXISTS pg_trgm"))
        await connection.run_sync(Base.metadata.drop_all)
        await connection.run_sync(Base.metadata.create_all)
    yield engine
    await engine.dispose()


@pytest.fixture
async def db_session(engine: AsyncEngine) -> AsyncIterator[AsyncSession]:
    """A session whose work, even commits, is rolled back when the test ends."""
    async with engine.connect() as connection:
        transaction = await connection.begin()
        session = AsyncSession(
            bind=connection, join_transaction_mode="create_savepoint", expire_on_commit=False
        )
        try:
            yield session
        finally:
            await session.close()
            await transaction.rollback()


@pytest.fixture
def settings(tmp_path: Path, test_database_url: str) -> Settings:
    # _env_file=None: tests must never depend on the developer's .env.
    return Settings(
        _env_file=None,
        secret_key=TEST_SECRET_KEY,
        database_url=test_database_url,
        data_dir=tmp_path / "data",
    )


@pytest.fixture
def app(settings: Settings, db_session: AsyncSession) -> FastAPI:
    app = create_app(settings)
    app.dependency_overrides[get_session] = lambda: db_session
    return app


@pytest.fixture
async def client(app: FastAPI) -> AsyncIterator[AsyncClient]:
    # Sends the CSRF header on every request, like the real frontend does.
    async with AsyncClient(
        transport=ASGITransport(app=app),
        # https, because the session cookie is Secure and is never sent over plain http.
        base_url="https://test",
        headers={"X-Requested-With": "fetch"},
    ) as client:
        yield client


@pytest.fixture
async def admin(db_session: AsyncSession) -> User:
    user = User(
        email=ADMIN_EMAIL,
        display_name="Test Admin",
        password_hash=await hash_password(ADMIN_PASSWORD),
    )
    db_session.add(user)
    await db_session.flush()
    return user


@pytest.fixture
async def signed_in(client: AsyncClient, admin: User) -> AsyncClient:
    """The test client, signed in as the admin."""
    response = await client.post(
        "/api/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}
    )
    assert response.status_code == 200
    return client
