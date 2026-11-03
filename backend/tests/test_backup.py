"""Backup and restore against real pg_dump/pg_restore.

The test database can't be used: its data lives in rolled-back transactions that pg_dump never
sees. So these tests use two databases of their own (made by `make db-setup`, and in CI), and
wipe them before each test.
"""

import json
import shutil
import stat
from collections.abc import AsyncIterator, Callable
from datetime import UTC, datetime, timedelta
from pathlib import Path

import anyio
import asyncpg
import pytest
from sqlalchemy import text
from sqlalchemy.engine import make_url
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, create_async_engine

from app import cli
from app.core.config import Settings
from app.core.security import hash_password
from app.db.base import Base
from app.models import AccessEvent, Item, Share, ShareItem, User
from app.services import backup
from app.services.backup import BackupError, create_backup, restore_backup
from app.services.library import add_media
from app.services.storage import Storage
from tests import media
from tests.conftest import TEST_SECRET_KEY

pytestmark = pytest.mark.skipif(
    not (shutil.which("pg_dump") and shutil.which("pg_restore")),
    reason="pg_dump and pg_restore are not installed",
)

TABLES = ["users", "items", "shares", "share_items", "access_events", "alembic_version"]


def sibling_database(test_database_url: str, role: str) -> str:
    """sendy_test -> sendy_backup_test: still ends in _test, so it's never real data."""
    url = make_url(test_database_url)
    base = (url.database or "").removesuffix("_test")
    return url.set(database=f"{base}_{role}_test").render_as_string(hide_password=False)


async def empty_database(url: str) -> AsyncEngine:
    engine = create_async_engine(url)
    try:
        async with engine.begin() as connection:
            # The database owner owns the public schema (PostgreSQL 15+), so it may recreate it.
            await connection.execute(text("DROP SCHEMA public CASCADE"))
            await connection.execute(text("CREATE SCHEMA public"))
    except asyncpg.InvalidCatalogNameError:
        await engine.dispose()
        pytest.skip(f"{make_url(url).database} doesn't exist yet: run `make db-setup` again.")
    return engine


async def create_schema(engine: AsyncEngine) -> None:
    """The tables, as migrations would leave them (including alembic's revision)."""
    head = backup._migrations().get_current_head()
    async with engine.begin() as connection:
        await connection.execute(text("CREATE EXTENSION IF NOT EXISTS pg_trgm"))
        await connection.run_sync(Base.metadata.create_all)
        await connection.execute(
            text("CREATE TABLE alembic_version (version_num varchar(32) PRIMARY KEY)")
        )
        await connection.execute(text("INSERT INTO alembic_version VALUES (:head)"), {"head": head})


class Side:
    """One end of a backup: a database and a DATA_DIR."""

    def __init__(self, url: str, engine: AsyncEngine, data_dir: Path) -> None:
        self.url = url
        self.engine = engine
        self.data_dir = data_dir
        self.storage = Storage(data_dir)

    def session(self) -> AsyncSession:
        return AsyncSession(self.engine, expire_on_commit=False)

    async def rows(self) -> dict[str, list[dict]]:
        async with self.engine.connect() as connection:
            tables = {}
            for table in TABLES:
                result = await connection.execute(text(f"SELECT * FROM {table}"))  # noqa: S608
                tables[table] = sorted((dict(row._mapping) for row in result), key=repr)
            return tables

    def files(self) -> dict[str, bytes]:
        media_dir = self.data_dir / "media"
        return {
            path.relative_to(media_dir).as_posix(): path.read_bytes()
            for path in sorted(media_dir.rglob("*"))
            if path.is_file() and "incoming" not in path.parts
        }


@pytest.fixture
async def source(test_database_url: str, tmp_path: Path) -> AsyncIterator[Side]:
    url = sibling_database(test_database_url, "backup")
    engine = await empty_database(url)
    await create_schema(engine)
    yield Side(url, engine, tmp_path / "source-data")
    await engine.dispose()


@pytest.fixture
async def target(test_database_url: str, tmp_path: Path) -> AsyncIterator[Side]:
    url = sibling_database(test_database_url, "restore")
    engine = await empty_database(url)
    yield Side(url, engine, tmp_path / "target-data")
    await engine.dispose()


async def chunks(data: bytes) -> AsyncIterator[bytes]:
    yield data


async def fill(side: Side) -> None:
    """A small but complete library: an admin, media, a note, two shares, a log entry."""
    async with side.session() as session:
        session.add(
            User(
                email="admin@example.com",
                display_name="Admin",
                password_hash=await hash_password("correct horse battery staple"),
            )
        )
        shot = await add_media(session, side.storage, chunks(media.png(40, 30)), "Home.png", 10**7)
        photo = await add_media(
            session, side.storage, chunks(media.png(30, 20)), "Photo.png", 10**7
        )
        note = Item(kind="note", title="Feedback", body="# Thanks\n\n- Shorter hero")
        session.add(note)
        await session.flush()
        share = Share(
            title="Northwind - round 2",
            message="Hi!",
            expires_at=datetime.now(UTC) + timedelta(days=7),
            password_hash=await hash_password("open sesame"),
            view_count=3,
        )
        other = Share(title="Old link", revoked_at=datetime.now(UTC))
        session.add_all([share, other])
        await session.flush()
        session.add_all(
            [
                ShareItem(share_id=share.id, item_id=note.id, position=0),
                ShareItem(share_id=share.id, item_id=shot.id, position=1),
                ShareItem(share_id=other.id, item_id=photo.id, position=0),
                AccessEvent(
                    kind="share_viewed",
                    share_id=share.id,
                    share_title=share.title,
                    ip="203.0.113.7",
                    user_agent="Mozilla/5.0",
                ),
            ]
        )
        await session.commit()


async def back_up(side: Side, folder: Path) -> backup.BackupSummary:
    async with side.session() as session:
        return await create_backup(session, side.url, side.storage, folder)


async def restore(side: Side, folder: Path) -> backup.RestoreSummary:
    async with side.session() as session:
        return await restore_backup(session, side.url, side.storage, folder)


async def test_a_restore_brings_back_everything(source: Side, target: Side, tmp_path: Path) -> None:
    await fill(source)

    made = await back_up(source, tmp_path / "backups")
    assert made.items == 3
    assert made.shares == 2
    assert made.files == 4  # two originals, two thumbnails; the note has none
    assert made.missing == []

    restored = await restore(target, made.path)
    assert (restored.items, restored.shares, restored.files) == (3, 2, 4)
    assert restored.problems == []
    assert restored.needs_migration is False

    # Every row (hashes, tokens, dates, order in shares, the log) and every byte of every file.
    assert await target.rows() == await source.rows()
    assert target.files() == source.files()


async def test_a_restore_can_replace_tables_left_by_migrations(
    source: Side, target: Side, tmp_path: Path
) -> None:
    # The usual case on a new machine: `make db-migrate` ran before the restore.
    await fill(source)
    await create_schema(target.engine)

    await restore(target, (await back_up(source, tmp_path / "backups")).path)

    assert await target.rows() == await source.rows()


async def test_the_backup_folder_is_private_and_described(source: Side, tmp_path: Path) -> None:
    await fill(source)
    made = await back_up(source, tmp_path / "backups")

    assert made.path.name.startswith("sendy-backup-")
    assert stat.S_IMODE(made.path.stat().st_mode) == 0o700
    manifest = json.loads((made.path / "manifest.json").read_text())
    assert manifest["format"] == 1
    assert manifest["items"] == 3
    assert manifest["database_revision"] == backup._migrations().get_current_head()
    assert sorted(manifest["files"]) == sorted(f"media/{name}" for name in source.files())
    # Nothing half-written is left next to it.
    assert [path.name for path in (tmp_path / "backups").iterdir()] == [made.path.name]


async def test_orphan_and_temporary_files_are_left_out(source: Side, tmp_path: Path) -> None:
    await fill(source)
    (source.data_dir / "media" / "originals" / "not-an-item").write_bytes(b"orphan")
    (source.data_dir / "media" / "incoming" / "upload.part").write_bytes(b"half")

    made = await back_up(source, tmp_path / "backups")

    assert not (made.path / "media" / "originals" / "not-an-item").exists()
    assert not (made.path / "media" / "incoming").exists()


async def test_files_missing_at_backup_time_are_reported(source: Side, tmp_path: Path) -> None:
    await fill(source)
    lost = next((source.data_dir / "media" / "originals").iterdir())
    lost.unlink()

    made = await back_up(source, tmp_path / "backups")

    assert made.missing == [f"media/originals/{lost.name}"]
    assert made.files == 3


async def test_a_failed_dump_leaves_nothing_behind(source: Side, tmp_path: Path) -> None:
    wrong = make_url(source.url).set(database="no_such_database_test")
    async with source.session() as session:
        with pytest.raises(BackupError, match="pg_dump failed"):
            await create_backup(
                session, wrong.render_as_string(hide_password=False), source.storage, tmp_path / "b"
            )
    assert list((tmp_path / "b").iterdir()) == []


async def test_restore_refuses_a_library_that_isnt_empty(
    source: Side, target: Side, tmp_path: Path
) -> None:
    await fill(source)
    made = await back_up(source, tmp_path / "backups")
    await restore(target, made.path)

    with pytest.raises(BackupError, match="already holds a library"):
        await restore(target, made.path)


async def test_restore_refuses_media_already_in_data_dir(
    source: Side, target: Side, tmp_path: Path
) -> None:
    await fill(source)
    made = await back_up(source, tmp_path / "backups")
    (target.data_dir / "media" / "thumbs").mkdir(parents=True)
    (target.data_dir / "media" / "thumbs" / "x.webp").write_bytes(b"x")

    with pytest.raises(BackupError, match="already holds a library"):
        await restore(target, made.path)


Damage = Callable[[Path], None]


def _edit_manifest(folder: Path, **changes: object) -> None:
    manifest = json.loads((folder / "manifest.json").read_text())
    (folder / "manifest.json").write_text(json.dumps({**manifest, **changes}))


@pytest.mark.parametrize(
    ("damage", "message"),
    [
        (lambda folder: (folder / "manifest.json").unlink(), "isn't a backup"),
        (lambda folder: (folder / "database.dump").write_bytes(b"junk"), "is damaged"),
        (lambda folder: shutil.rmtree(folder / "media" / "thumbs"), "incomplete"),
        (lambda folder: _edit_manifest(folder, format=99), "different version"),
        (lambda folder: _edit_manifest(folder, database_revision="ffffffffffff"), "newer version"),
    ],
)
async def test_a_bad_backup_is_refused_before_anything_changes(
    source: Side, target: Side, tmp_path: Path, damage: Damage, message: str
) -> None:
    await fill(source)
    made = await back_up(source, tmp_path / "backups")
    damage(made.path)

    with pytest.raises(BackupError, match=message):
        await restore(target, made.path)

    # The target is still empty, so a good backup can still go in.
    async with target.engine.connect() as connection:
        tables = await connection.scalar(
            text("SELECT count(*) FROM pg_tables WHERE schemaname = 'public'")
        )
    assert tables == 0
    assert not target.data_dir.exists()


async def test_damaged_media_is_reported_after_restoring(
    source: Side, target: Side, tmp_path: Path
) -> None:
    await fill(source)
    made = await back_up(source, tmp_path / "backups")
    original = next((made.path / "media" / "originals").iterdir())
    original.write_bytes(b"not the same picture")

    restored = await restore(target, made.path)

    assert len(restored.problems) == 1
    assert "damaged" in restored.problems[0]


async def test_the_commands(
    source: Side,
    target: Side,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    await fill(source)

    def settings_for(side: Side) -> Settings:
        return Settings(
            _env_file=None,
            secret_key=TEST_SECRET_KEY,
            database_url=side.url,
            data_dir=side.data_dir,
        )

    # main() runs its own event loop, so it goes in a thread, away from the test's loop.
    monkeypatch.setattr(cli, "get_settings", lambda: settings_for(source))
    assert await anyio.to_thread.run_sync(cli.main, ["backup", str(tmp_path / "b")]) == 0
    assert "Backed up 3 items, 2 shares and 4 files" in capsys.readouterr().out

    folder = next((tmp_path / "b").iterdir())
    monkeypatch.setattr(cli, "get_settings", lambda: settings_for(target))
    assert await anyio.to_thread.run_sync(cli.main, ["restore", str(folder)]) == 0
    assert "Restored 3 items, 2 shares and 4 files." in capsys.readouterr().out

    # A second restore is refused, with a non-zero exit code.
    assert await anyio.to_thread.run_sync(cli.main, ["restore", str(folder)]) == 1
    assert "already holds a library" in capsys.readouterr().err
