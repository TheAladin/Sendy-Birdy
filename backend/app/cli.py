"""Command-line tools. Run `uv run python -m app.cli --help` from backend/."""

import argparse
import asyncio
import getpass
import sys
from collections.abc import Awaitable, Callable

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.db.session import create_engine, create_sessionmaker
from app.services.admin import (
    AdminError,
    check_password,
    clean_display_name,
    clean_email,
    create_admin,
    find_admin,
    update_admin,
)


def ask(prompt: str, clean: Callable[[str], str]) -> str:
    while True:
        try:
            return clean(input(prompt))
        except AdminError as error:
            print(error, file=sys.stderr)


def ask_password() -> str:
    """Prompt twice without echoing. When input is piped in (scripts, tests), read one line."""
    if not sys.stdin.isatty():
        return check_password(sys.stdin.readline().rstrip("\n"))
    while True:
        password = getpass.getpass("Password (at least 12 characters): ")
        try:
            check_password(password)
        except AdminError as error:
            print(error, file=sys.stderr)
            continue
        if getpass.getpass("Repeat password: ") == password:
            return password
        print("The passwords don't match; try again.", file=sys.stderr)


async def with_session(work: Callable[[AsyncSession], Awaitable[str]]) -> str:
    engine = create_engine(get_settings().database_url.get_secret_value())
    try:
        async with create_sessionmaker(engine)() as session:
            return await work(session)
    finally:
        await engine.dispose()


def run_create_admin(args: argparse.Namespace) -> str:
    email = clean_email(args.email) if args.email else ask("Email: ", clean_email)
    name = clean_display_name(args.name) if args.name else ask("Display name: ", clean_display_name)
    password = ask_password()

    async def work(session: AsyncSession) -> str:
        user = await create_admin(session, email=email, display_name=name, password=password)
        return f"Created the admin account for {user.email}."

    return asyncio.run(with_session(work))


def run_update_admin(args: argparse.Namespace) -> str:
    if not (args.new_email or args.name or args.password):
        raise AdminError("Nothing to change: pass --new-email, --name and/or --password.")
    new_email = clean_email(args.new_email) if args.new_email else None
    name = clean_display_name(args.name) if args.name else None
    password = ask_password() if args.password else None

    async def work(session: AsyncSession) -> str:
        user = await find_admin(session, args.email)
        await update_admin(session, user, new_email=new_email, display_name=name, password=password)
        note = " All existing sessions were signed out." if password else ""
        return f"Updated the account for {user.email}.{note}"

    return asyncio.run(with_session(work))


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="python -m app.cli", description="Sendy Birdy admin tools"
    )
    commands = parser.add_subparsers(dest="command", required=True)

    create = commands.add_parser("create-admin", help="create the admin account")
    create.add_argument("--email", help="skip the email prompt")
    create.add_argument("--name", help="skip the display name prompt")
    create.set_defaults(run=run_create_admin)

    update = commands.add_parser("update-admin", help="change the admin's email, name or password")
    update.add_argument("--email", help="which account (only needed if there are several)")
    update.add_argument("--new-email", help="new email address")
    update.add_argument("--name", help="new display name")
    update.add_argument("--password", action="store_true", help="set a new password (prompted)")
    update.set_defaults(run=run_update_admin)
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        print(args.run(args))
    except AdminError as error:
        print(error, file=sys.stderr)
        return 1
    except (KeyboardInterrupt, EOFError):
        print("\nCancelled.", file=sys.stderr)
        return 130
    return 0


if __name__ == "__main__":
    sys.exit(main())
