from fastapi import FastAPI
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession

from app.core.config import Settings


async def test_tests_run_against_the_test_database(db_session: AsyncSession) -> None:
    database = await db_session.scalar(text("select current_database()"))

    assert database is not None
    assert database.endswith("_test")


async def test_commits_inside_a_test_are_rolled_back(
    db_session: AsyncSession, engine: AsyncEngine
) -> None:
    await db_session.execute(text("create table rollback_probe (id int)"))
    await db_session.commit()

    async with engine.connect() as other_connection:
        table = await other_connection.scalar(text("select to_regclass('rollback_probe')"))

    assert table is None


def test_app_engine_uses_the_configured_database(app: FastAPI, settings: Settings) -> None:
    configured = settings.database_url.get_secret_value()

    assert app.state.engine.url.render_as_string(hide_password=False) == configured
