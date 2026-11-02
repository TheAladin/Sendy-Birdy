import os
from collections.abc import AsyncIterator
from pathlib import Path

import pytest
from dotenv import dotenv_values
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from sqlalchemy.engine import make_url
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, create_async_engine

from app import models  # noqa: F401  (registers every table on Base.metadata)
from app.core.config import REPO_ROOT, Settings
from app.db.base import Base
from app.db.session import get_session
from app.main import create_app

TEST_SECRET_KEY = "test-secret-key-that-is-at-least-32-chars"


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
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        yield client
