"""Proof that a visitor typed a share's password: a signed cookie, so nothing is stored."""

import hashlib
import hmac
import uuid
from datetime import datetime, timedelta

UNLOCK_COOKIE = "sendy_unlock"
UNLOCK_LIFETIME = timedelta(hours=12)


def _signature(secret: str, share_id: uuid.UUID, password_hash: str, expires: int) -> str:
    # The password hash is part of what's signed: setting a new password (even the same one,
    # since every hash gets a fresh salt) makes every earlier unlock invalid. The prefix keeps
    # these signatures from ever being valid for anything else signed with the same key.
    message = f"share-unlock:{share_id}:{expires}:{password_hash}".encode()
    return hmac.new(secret.encode(), message, hashlib.sha256).hexdigest()


def make_unlock(secret: str, share_id: uuid.UUID, password_hash: str, now: datetime) -> str:
    expires = int((now + UNLOCK_LIFETIME).timestamp())
    return f"{expires}.{_signature(secret, share_id, password_hash, expires)}"


def is_unlocked(
    secret: str, share_id: uuid.UUID, password_hash: str, cookie: str | None, now: datetime
) -> bool:
    if not cookie:
        return False
    expires_text, _, signature = cookie.partition(".")
    if not expires_text.isdigit() or int(expires_text) <= now.timestamp():
        return False
    expected = _signature(secret, share_id, password_hash, int(expires_text))
    # Constant-time comparison: how long it takes doesn't reveal how much of a guess was right.
    return hmac.compare_digest(signature, expected)
