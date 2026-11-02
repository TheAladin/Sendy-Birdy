import hashlib
import secrets

from pwdlib import PasswordHash
from starlette.concurrency import run_in_threadpool

password_hash = PasswordHash.recommended()

# Checked against when an email doesn't exist, so that login takes the same time either way
# and response times don't reveal which emails have accounts.
_DUMMY_HASH = password_hash.hash(secrets.token_urlsafe(16))


def normalize_email(email: str) -> str:
    return email.strip().lower()


async def hash_password(password: str) -> str:
    # Argon2 is slow on purpose; run it off the event loop so other requests aren't blocked.
    return await run_in_threadpool(password_hash.hash, password)


async def verify_password(password: str, hashed: str | None) -> tuple[bool, str | None]:
    """Return (is_valid, new_hash). new_hash is set when the stored hash should be upgraded."""
    if hashed is None:
        await run_in_threadpool(password_hash.verify, password, _DUMMY_HASH)
        return False, None
    return await run_in_threadpool(password_hash.verify_and_update, password, hashed)


def new_session_token() -> str:
    return secrets.token_urlsafe(32)


def hash_token(token: str) -> str:
    # Tokens are long and random, so a fast hash is enough. Storing only the hash means a
    # leaked database doesn't contain usable session cookies.
    return hashlib.sha256(token.encode()).hexdigest()
