"""Backups: the database (pg_dump, custom format) plus the media files, in one folder.

A backup is a folder `sendy-backup-<UTC time>` holding `database.dump`, `media/originals/…`,
`media/thumbs/…` and a `manifest.json` describing it. It's written as `….partial` and renamed
only when complete, so a half-written backup never looks like a real one.
"""

import asyncio
import hashlib
import json
import os
import shutil
import uuid
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path

import anyio
from alembic.config import Config
from alembic.script import ScriptDirectory
from alembic.util import CommandError
from sqlalchemy import func, select, text
from sqlalchemy.engine import make_url
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import REPO_ROOT
from app.models import Item, Share
from app.services.storage import Storage

FORMAT = 1
MANIFEST = "manifest.json"
DUMP = "database.dump"
# Tables that hold your data. If any has rows, a restore would mix two libraries.
DATA_TABLES = ("users", "items", "shares")


class BackupError(Exception):
    """A backup or restore that can't go ahead; the message says why."""


@dataclass(frozen=True)
class BackupSummary:
    path: Path
    items: int
    shares: int
    files: int
    # Files the database knew about but the disk didn't (deleted while the backup ran).
    missing: list[str] = field(default_factory=list)


@dataclass(frozen=True)
class RestoreSummary:
    items: int
    shares: int
    files: int
    # Revision the database is at, and whether migrations still have to run.
    revision: str | None
    needs_migration: bool
    # Media items whose file is missing or doesn't match its recorded SHA-256.
    problems: list[str] = field(default_factory=list)


def _libpq(database_url: str) -> tuple[list[str], dict[str, str], str]:
    """pg_dump/pg_restore arguments for DATABASE_URL. The password goes in the environment,
    never on the command line, where every user on the machine could read it."""
    url = make_url(database_url)
    args = ["--no-password"]
    if url.host:
        args += ["--host", url.host]
    if url.port:
        args += ["--port", str(url.port)]
    if url.username:
        args += ["--username", url.username]
    env = dict(os.environ)
    if url.password:
        env["PGPASSWORD"] = url.password
    return args, env, url.database or ""


async def _run(command: list[str], env: dict[str, str]) -> None:
    try:
        process = await asyncio.create_subprocess_exec(
            *command,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            env=env,
        )
    except FileNotFoundError:
        raise BackupError(
            f"{command[0]} isn't installed. Install the PostgreSQL client tools "
            "(same major version as the server or newer)."
        ) from None
    _, stderr = await process.communicate()
    if process.returncode != 0:
        raise BackupError(f"{command[0]} failed: {stderr.decode(errors='replace').strip()}")


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as file:
        while chunk := file.read(1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


def _media_files(storage: Storage, rows: list[tuple[uuid.UUID, str, bool]]) -> list[str]:
    """Paths (relative to DATA_DIR) of every file the items need. Orphans aren't included."""
    data_dir = storage.originals.parent.parent
    files = []
    for item_id, kind, has_thumbnail in rows:
        if kind != "note":
            files.append(storage.original_path(item_id).relative_to(data_dir).as_posix())
        if has_thumbnail:
            files.append(storage.thumbnail_path(item_id).relative_to(data_dir).as_posix())
    return files


def _copy_files(files: list[str], source: Path, target: Path) -> list[str]:
    missing = []
    for relative in files:
        origin = source / relative
        if not origin.is_file():
            missing.append(relative)
            continue
        destination = target / relative
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(origin, destination)
    return missing


async def create_backup(
    session: AsyncSession, database_url: str, storage: Storage, destination: Path
) -> BackupSummary:
    """Back up the database and media into a new folder inside `destination`.

    Safe while the app runs: pg_dump reads one consistent snapshot, and the file list comes from
    that same snapshot, so the files always match the dump.
    """
    stamp = datetime.now(UTC).strftime("%Y%m%d-%H%M%S")
    final = destination / f"sendy-backup-{stamp}"
    partial = destination / f"{final.name}.partial"
    if await anyio.Path(final).exists() or await anyio.Path(partial).exists():
        raise BackupError(f"{final} already exists; try again in a second.")
    await anyio.Path(destination).mkdir(parents=True, exist_ok=True)
    # The backup holds everything, password hashes included: only you may read it.
    await anyio.Path(partial).mkdir(mode=0o700)
    data_dir = storage.originals.parent.parent
    try:
        # REPEATABLE READ keeps one snapshot for the whole transaction; pg_dump joins it, so the
        # counts, the file list and the dump all describe the same moment.
        await session.connection(execution_options={"isolation_level": "REPEATABLE READ"})
        snapshot = await session.scalar(text("SELECT pg_export_snapshot()"))
        revision = await _revision(session)
        rows = [
            tuple(row)
            for row in await session.execute(select(Item.id, Item.kind, Item.has_thumbnail))
        ]
        shares = await session.scalar(select(func.count()).select_from(Share)) or 0

        args, env, database = _libpq(database_url)
        dump = partial / DUMP
        command = ["pg_dump", *args, "--format=custom", f"--snapshot={snapshot}"]
        await _run([*command, f"--file={dump}", database], env)
        # The snapshot only has to live until pg_dump has started reading; it has now finished.
        await session.rollback()

        files = _media_files(storage, rows)
        missing = await anyio.to_thread.run_sync(_copy_files, files, data_dir, partial)
        manifest = {
            "format": FORMAT,
            "created_at": datetime.now(UTC).isoformat(),
            "database_revision": revision,
            "database_sha256": await anyio.to_thread.run_sync(_sha256, dump),
            "items": len(rows),
            "shares": shares,
            "files": [path for path in files if path not in missing],
        }
        await anyio.Path(partial / MANIFEST).write_text(json.dumps(manifest, indent=2) + "\n")
        await anyio.Path(partial).rename(final)
    except BaseException:
        await anyio.to_thread.run_sync(lambda: shutil.rmtree(partial, ignore_errors=True))
        raise
    return BackupSummary(
        path=final,
        items=len(rows),
        shares=shares,
        files=len(manifest["files"]),
        missing=missing,
    )


async def _revision(session: AsyncSession) -> str | None:
    if await session.scalar(text("SELECT to_regclass('public.alembic_version')")) is None:
        return None
    return await session.scalar(text("SELECT version_num FROM alembic_version"))


def _migrations() -> ScriptDirectory:
    return ScriptDirectory.from_config(Config(REPO_ROOT / "backend" / "alembic.ini"))


def _read_manifest(source: Path) -> dict:
    try:
        manifest = json.loads((source / MANIFEST).read_text())
    except FileNotFoundError:
        raise BackupError(f"{source} isn't a backup: there's no {MANIFEST} in it.") from None
    except json.JSONDecodeError:
        raise BackupError(f"{source / MANIFEST} is damaged.") from None
    if manifest.get("format") != FORMAT:
        raise BackupError("This backup was made by a different version of Sendy Birdy.")
    return manifest


def _has_media(storage: Storage) -> bool:
    return any(
        folder.is_dir() and any(folder.iterdir()) for folder in (storage.originals, storage.thumbs)
    )


async def _library_is_empty(session: AsyncSession, storage: Storage) -> bool:
    for table in DATA_TABLES:
        if await session.scalar(text(f"SELECT to_regclass('public.{table}')")) is None:
            continue
        # Table names come from DATA_TABLES above, never from input.
        if await session.scalar(text(f"SELECT EXISTS (SELECT FROM {table})")):  # noqa: S608
            return False
    return not await anyio.to_thread.run_sync(_has_media, storage)


def _check_files(
    storage: Storage, rows: list[tuple[uuid.UUID, str, bool, str | None]]
) -> list[str]:
    problems = []
    for item_id, title, has_thumbnail, sha256 in rows:
        original = storage.original_path(item_id)
        if not original.is_file():
            problems.append(f"{title}: the file is missing")
        elif sha256 and _sha256(original) != sha256:
            problems.append(f"{title}: the file is damaged (its SHA-256 doesn't match)")
        if has_thumbnail and not storage.thumbnail_path(item_id).is_file():
            problems.append(f"{title}: the thumbnail is missing")
    return problems


async def restore_backup(
    session: AsyncSession, database_url: str, storage: Storage, source: Path
) -> RestoreSummary:
    """Restore a backup folder into an empty database and an empty DATA_DIR.

    "Empty" means no users, items or shares and no media files; tables created by migrations
    alone are fine, the dump replaces them.
    """
    manifest = await anyio.to_thread.run_sync(_read_manifest, source)
    dump = source / DUMP
    if not await anyio.Path(dump).is_file():
        raise BackupError(f"{dump} is missing.")
    # Check before touching anything, so an incomplete backup leaves the target untouched.
    absent = [path for path in manifest["files"] if not await anyio.Path(source / path).is_file()]
    if absent:
        raise BackupError(f"The backup is incomplete: {len(absent)} of its files are missing.")
    if await anyio.to_thread.run_sync(_sha256, dump) != manifest["database_sha256"]:
        raise BackupError(f"{dump} is damaged (its SHA-256 doesn't match the manifest).")

    revision = manifest.get("database_revision")
    migrations = _migrations()
    if revision:
        try:
            migrations.get_revision(revision)
        except CommandError:
            raise BackupError(
                "This backup comes from a newer version of Sendy Birdy (its database revision "
                f"{revision} is unknown here). Update the app first."
            ) from None

    if not await _library_is_empty(session, storage):
        raise BackupError(
            "The database or DATA_DIR already holds a library. Restore only goes into an empty "
            "one, so nothing is ever overwritten."
        )
    # End our transaction: pg_restore drops and recreates tables we'd otherwise hold locks on.
    await session.rollback()

    args, env, database = _libpq(database_url)
    # --clean --if-exists replaces tables left by migrations; --no-owner and --no-privileges let
    # a different role (another machine, another name) own the restored tables.
    await _run(
        [
            "pg_restore",
            *args,
            "--clean",
            "--if-exists",
            "--no-owner",
            "--no-privileges",
            "--single-transaction",
            "--exit-on-error",
            f"--dbname={database}",
            str(dump),
        ],
        env,
    )

    data_dir = storage.originals.parent.parent
    await anyio.to_thread.run_sync(_copy_files, manifest["files"], source, data_dir)

    rows = [
        tuple(row)
        for row in await session.execute(
            select(Item.id, Item.title, Item.has_thumbnail, Item.sha256).where(Item.kind != "note")
        )
    ]
    problems = await anyio.to_thread.run_sync(_check_files, storage, rows)
    items = await session.scalar(select(func.count()).select_from(Item)) or 0
    shares = await session.scalar(select(func.count()).select_from(Share)) or 0
    return RestoreSummary(
        items=items,
        shares=shares,
        files=len(manifest["files"]),
        revision=revision,
        needs_migration=revision != migrations.get_current_head(),
        problems=problems,
    )
