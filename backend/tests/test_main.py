from fastapi import FastAPI
from httpx import AsyncClient

from app.core.config import Settings


def test_app_keeps_the_settings_it_was_given(app: FastAPI, settings: Settings) -> None:
    assert app.state.settings is settings


async def test_docs_are_served_under_api(client: AsyncClient) -> None:
    assert (await client.get("/api/docs")).status_code == 200
    assert (await client.get("/api/openapi.json")).status_code == 200
    assert (await client.get("/api/docs/oauth2-redirect")).status_code == 200
    assert (await client.get("/docs")).status_code == 404
