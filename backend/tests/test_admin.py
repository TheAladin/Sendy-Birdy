import io

import pytest
from httpx import AsyncClient
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app import cli
from app.models import AuthSession, User
from app.services.admin import AdminError, create_admin, find_admin, update_admin
from tests.conftest import ADMIN_EMAIL, ADMIN_PASSWORD

NEW_PASSWORD = "an even longer new password"


async def test_created_admin_can_log_in(client: AsyncClient, db_session: AsyncSession) -> None:
    await create_admin(
        db_session, email=" Owner@Example.com ", display_name=" Owner ", password=ADMIN_PASSWORD
    )

    response = await client.post(
        "/api/auth/login", json={"email": "owner@example.com", "password": ADMIN_PASSWORD}
    )

    assert response.status_code == 200
    assert response.json()["display_name"] == "Owner"


@pytest.mark.parametrize(
    ("email", "name", "password", "message"),
    [
        ("not-an-email", "Owner", ADMIN_PASSWORD, "doesn't look like an email"),
        ("owner@localhost", "Owner", ADMIN_PASSWORD, "doesn't look like an email"),
        ("owner@example.com", "   ", ADMIN_PASSWORD, "between 1 and 100"),
        ("owner@example.com", "Owner", "too short", "at least 12"),
    ],
)
async def test_create_admin_rejects_bad_input(
    db_session: AsyncSession, email: str, name: str, password: str, message: str
) -> None:
    with pytest.raises(AdminError, match=message):
        await create_admin(db_session, email=email, display_name=name, password=password)


async def test_create_admin_refuses_a_duplicate_email(
    db_session: AsyncSession, admin: User
) -> None:
    with pytest.raises(AdminError, match="already exists"):
        await create_admin(
            db_session, email=ADMIN_EMAIL.upper(), display_name="Twin", password=ADMIN_PASSWORD
        )


async def test_find_admin_picks_the_only_account(db_session: AsyncSession, admin: User) -> None:
    assert await find_admin(db_session, None) is admin


async def test_find_admin_needs_an_email_when_there_are_several(
    db_session: AsyncSession, admin: User
) -> None:
    await create_admin(
        db_session, email="second@example.com", display_name="Second", password=ADMIN_PASSWORD
    )

    with pytest.raises(AdminError, match="several accounts"):
        await find_admin(db_session, None)
    assert (await find_admin(db_session, "SECOND@example.com")).display_name == "Second"


async def test_find_admin_explains_when_there_is_no_account(db_session: AsyncSession) -> None:
    with pytest.raises(AdminError, match="no account yet"):
        await find_admin(db_session, None)


async def test_changing_the_password_signs_out_every_session(
    client: AsyncClient, db_session: AsyncSession, admin: User
) -> None:
    await client.post("/api/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD})
    assert (await client.get("/api/auth/me")).status_code == 200

    await update_admin(db_session, admin, password=NEW_PASSWORD)

    assert (await client.get("/api/auth/me")).status_code == 401
    assert await db_session.scalar(select(func.count()).select_from(AuthSession)) == 0
    old = await client.post(
        "/api/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}
    )
    new = await client.post(
        "/api/auth/login", json={"email": ADMIN_EMAIL, "password": NEW_PASSWORD}
    )
    assert (old.status_code, new.status_code) == (401, 200)


async def test_update_admin_changes_email_and_name(db_session: AsyncSession, admin: User) -> None:
    await update_admin(db_session, admin, new_email="New@Example.com", display_name="Renamed")

    assert (admin.email, admin.display_name) == ("new@example.com", "Renamed")


async def test_update_admin_refuses_an_email_that_is_taken(
    db_session: AsyncSession, admin: User
) -> None:
    await create_admin(
        db_session, email="other@example.com", display_name="Other", password=ADMIN_PASSWORD
    )

    with pytest.raises(AdminError, match="already exists"):
        await update_admin(db_session, admin, new_email="other@example.com")


# The command-line layer: argument parsing and prompts, without a database.


@pytest.fixture
def piped_stdin(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("sys.stdin", io.StringIO(ADMIN_PASSWORD + "\n"))


def test_piped_password_is_read_from_stdin(piped_stdin: None) -> None:
    assert cli.ask_password() == ADMIN_PASSWORD


def test_interactive_password_must_be_long_enough_and_repeated(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    monkeypatch.setattr("sys.stdin.isatty", lambda: True)
    answers = iter(["short", ADMIN_PASSWORD, "typo in the repeat", ADMIN_PASSWORD, ADMIN_PASSWORD])
    monkeypatch.setattr("getpass.getpass", lambda _prompt: next(answers))

    assert cli.ask_password() == ADMIN_PASSWORD
    errors = capsys.readouterr().err
    assert "at least 12" in errors
    assert "don't match" in errors


def test_prompts_repeat_until_the_answer_is_valid(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    answers = iter(["nope", "owner@example.com"])
    monkeypatch.setattr("builtins.input", lambda _prompt: next(answers))

    assert cli.ask("Email: ", cli.clean_email) == "owner@example.com"
    assert "doesn't look like an email" in capsys.readouterr().err


def test_update_admin_with_nothing_to_change_fails_cleanly(
    capsys: pytest.CaptureFixture[str],
) -> None:
    assert cli.main(["update-admin"]) == 1
    assert "Nothing to change" in capsys.readouterr().err


def test_there_is_no_password_flag_on_create_admin(capsys: pytest.CaptureFixture[str]) -> None:
    with pytest.raises(SystemExit):
        cli.main(["create-admin", "--password", "visible-in-shell-history"])
    assert "unrecognized arguments" in capsys.readouterr().err
