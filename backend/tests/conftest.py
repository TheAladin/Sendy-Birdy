from collections.abc import AsyncIterator
from pathlib import Path

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from app.core.config import Settings
from app.main import create_app

TEST_SECRET_KEY = "test-secret-key-that-is-at-least-32-chars"


@pytest.fixture
def settings(tmp_path: Path) -> Settings:
    # _env_file=None: tests must never depend on the developer's .env.
    return Settings(_env_file=None, secret_key=TEST_SECRET_KEY, data_dir=tmp_path / "data")


@pytest.fixture
def app(settings: Settings) -> FastAPI:
    return create_app(settings)


@pytest.fixture
async def client(app: FastAPI) -> AsyncIterator[AsyncClient]:
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        yield client
