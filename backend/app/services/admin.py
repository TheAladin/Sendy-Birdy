"""Creating and changing the admin account. Used by the command-line tool."""

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import hash_password, normalize_email
from app.models import AuthSession, User

MIN_PASSWORD_LENGTH = 12
MAX_PASSWORD_LENGTH = 1024


class AdminError(Exception):
    """A problem worth showing to the person at the keyboard."""


def clean_email(email: str) -> str:
    email = normalize_email(email)
    local, _, domain = email.partition("@")
    if not local or "." not in domain or " " in email or len(email) > 320:
        raise AdminError(f"'{email}' doesn't look like an email address.")
    return email


def clean_display_name(name: str) -> str:
    name = name.strip()
    if not 1 <= len(name) <= 100:
        raise AdminError("The display name must be between 1 and 100 characters.")
    return name


def check_password(password: str) -> str:
    if len(password) < MIN_PASSWORD_LENGTH:
        raise AdminError(f"The password must be at least {MIN_PASSWORD_LENGTH} characters.")
    if len(password) > MAX_PASSWORD_LENGTH:
        raise AdminError(f"The password must be at most {MAX_PASSWORD_LENGTH} characters.")
    return password


async def _email_taken(session: AsyncSession, email: str) -> bool:
    return await session.scalar(select(User.id).where(User.email == email)) is not None


async def create_admin(
    session: AsyncSession, *, email: str, display_name: str, password: str
) -> User:
    email = clean_email(email)
    if await _email_taken(session, email):
        raise AdminError(f"An account for {email} already exists. Use update-admin to change it.")
    user = User(
        email=email,
        display_name=clean_display_name(display_name),
        password_hash=await hash_password(check_password(password)),
    )
    session.add(user)
    await session.commit()
    return user


async def find_admin(session: AsyncSession, email: str | None) -> User:
    """The account with this email, or the only account when no email is given."""
    if email is not None:
        user = await session.scalar(select(User).where(User.email == normalize_email(email)))
        if user is None:
            raise AdminError(f"There's no account for {normalize_email(email)}.")
        return user
    users = (await session.scalars(select(User).limit(2))).all()
    if not users:
        raise AdminError("There's no account yet. Create one with create-admin.")
    if len(users) > 1:
        raise AdminError("There are several accounts; say which one with --email.")
    return users[0]


async def update_admin(
    session: AsyncSession,
    user: User,
    *,
    new_email: str | None = None,
    display_name: str | None = None,
    password: str | None = None,
) -> User:
    if new_email is not None:
        new_email = clean_email(new_email)
        if new_email != user.email and await _email_taken(session, new_email):
            raise AdminError(f"An account for {new_email} already exists.")
        user.email = new_email
    if display_name is not None:
        user.display_name = clean_display_name(display_name)
    if password is not None:
        user.password_hash = await hash_password(check_password(password))
        # A new password should lock out anyone still holding an old session.
        await session.execute(delete(AuthSession).where(AuthSession.user_id == user.id))
    await session.commit()
    return user
