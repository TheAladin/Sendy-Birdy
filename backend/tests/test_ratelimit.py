import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.ratelimit import SlidingWindow
from app.models import AccessEvent, User
from tests import media
from tests.conftest import ADMIN_EMAIL, ADMIN_PASSWORD


class FakeClock:
    def __init__(self) -> None:
        self.now = 1000.0

    def __call__(self) -> float:
        return self.now

    def advance(self, seconds: float) -> None:
        self.now += seconds


@pytest.fixture
def clock(app: FastAPI) -> FakeClock:
    """Every limiter in the app reads this clock, so tests can skip ahead in time."""
    fake = FakeClock()
    limits = app.state.rate_limits
    for limiter in (limits.login, limits.unlock_per_visitor, limits.unlock_per_share):
        limiter.clock = fake
    return fake


# The window itself.


def test_failures_are_allowed_up_to_the_limit_then_blocked() -> None:
    clock = FakeClock()
    window = SlidingWindow(limit=3, window=60, clock=clock)

    for _ in range(3):
        assert window.retry_after("a") is None
        window.record_failure("a")
        clock.advance(10)

    # Failures at 0, 10 and 20 s; now is 30 s: the first frees up at 60 s.
    assert window.retry_after("a") == 30


def test_the_window_slides_one_failure_at_a_time() -> None:
    clock = FakeClock()
    window = SlidingWindow(limit=3, window=60, clock=clock)
    for _ in range(3):
        window.record_failure("a")
        clock.advance(10)

    clock.advance(30)  # 60 s after the first failure: only that one has aged out.
    assert window.retry_after("a") is None
    window.record_failure("a")
    assert window.retry_after("a") == 10


def test_keys_are_counted_separately_and_can_be_reset() -> None:
    window = SlidingWindow(limit=1, window=60, clock=FakeClock())
    window.record_failure("a")

    assert window.retry_after("a") == 60
    assert window.retry_after("b") is None
    window.reset("a")
    assert window.retry_after("a") is None


def test_memory_stays_bounded_however_many_addresses_try() -> None:
    clock = FakeClock()
    window = SlidingWindow(limit=5, window=60, clock=clock, max_keys=100)

    for number in range(1000):
        window.record_failure(f"198.51.100.{number}")
        clock.advance(0.5)

    assert len(window._failures) <= 100


# Sign-in.


def visitor_from(app: FastAPI, address: str) -> AsyncClient:
    """A browser at `address`, arriving through the local tunnel."""
    return AsyncClient(
        transport=ASGITransport(app=app, client=("127.0.0.1", 50000)),
        base_url="https://test",
        headers={"X-Forwarded-For": address, "X-Requested-With": "fetch"},
    )


async def login(client: AsyncClient, password: str) -> int:
    response = await client.post(
        "/api/auth/login", json={"email": ADMIN_EMAIL, "password": password}
    )
    return response.status_code


async def test_sign_in_is_blocked_after_ten_failures_and_reopens_later(
    app: FastAPI, admin: User, clock: FakeClock, db_session: AsyncSession
) -> None:
    async with visitor_from(app, "203.0.113.7") as attacker:
        assert [await login(attacker, f"guess {n}") for n in range(10)] == [401] * 10

        blocked = await attacker.post(
            "/api/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}
        )
        # Even the right password: while blocked, nothing is checked.
        assert blocked.status_code == 429
        assert blocked.headers["retry-after"] == "900"
        assert blocked.json()["detail"] == "Too many attempts. Try again in 15 minutes."

        clock.advance(15 * 60)
        assert await login(attacker, ADMIN_PASSWORD) == 200

    # Failed attempts are logged; blocked ones aren't (an attack would flood the log).
    failed = select(func.count()).where(AccessEvent.kind == "login_failed")
    assert await db_session.scalar(failed) == 10


async def test_each_address_has_its_own_limit(app: FastAPI, admin: User, clock: FakeClock) -> None:
    async with visitor_from(app, "203.0.113.7") as attacker:
        for n in range(10):
            await login(attacker, f"guess {n}")
        assert await login(attacker, "guess") == 429

    async with visitor_from(app, "198.51.100.20") as owner:
        assert await login(owner, ADMIN_PASSWORD) == 200


async def test_signing_in_clears_earlier_failures(
    app: FastAPI, admin: User, clock: FakeClock
) -> None:
    async with visitor_from(app, "203.0.113.7") as owner:
        for n in range(9):
            await login(owner, f"typo {n}")
        assert await login(owner, ADMIN_PASSWORD) == 200

        # A fresh start: nine more typos are still allowed.
        assert [await login(owner, f"typo {n}") for n in range(9)] == [401] * 9


# Share passwords.


@pytest.fixture
async def unlock_path(signed_in: AsyncClient) -> str:
    upload = await signed_in.post(
        "/api/items", params={"filename": "Hero.png"}, content=media.png()
    )
    share = await signed_in.post(
        "/api/shares",
        json={"title": "Private", "item_ids": [upload.json()["id"]], "password": "blue heron"},
    )
    token = share.json()["url"].rsplit("/", 1)[1]
    return f"/api/public/shares/{token}/unlock"


async def unlock(app: FastAPI, path: str, address: str, password: str) -> int:
    async with visitor_from(app, address) as client:
        return (await client.post(path, json={"password": password})).status_code


async def test_a_visitor_guessing_a_share_password_is_blocked_then_let_back(
    app: FastAPI, unlock_path: str, clock: FakeClock
) -> None:
    results = [await unlock(app, unlock_path, "203.0.113.7", f"guess {n}") for n in range(10)]
    assert results == [401] * 10

    assert await unlock(app, unlock_path, "203.0.113.7", "blue heron") == 429
    # Someone else (the real client) isn't affected by that visitor's guessing.
    assert await unlock(app, unlock_path, "198.51.100.20", "blue heron") == 204

    clock.advance(15 * 60)
    assert await unlock(app, unlock_path, "203.0.113.7", "blue heron") == 204


async def test_guessing_spread_over_many_addresses_hits_the_per_share_limit(
    app: FastAPI, unlock_path: str, clock: FakeClock
) -> None:
    # The real limit is 50 an hour; a smaller one keeps the test fast (each guess is an
    # Argon2 check). The behaviour is the same.
    app.state.rate_limits.unlock_per_share = SlidingWindow(limit=5, window=3600, clock=clock)

    for number in range(5):
        assert await unlock(app, unlock_path, f"198.51.100.{number}", "guess") == 401

    response_code = await unlock(app, unlock_path, "192.0.2.99", "blue heron")
    assert response_code == 429

    clock.advance(3600)
    assert await unlock(app, unlock_path, "192.0.2.99", "blue heron") == 204


async def test_a_blocked_unlock_says_how_long_to_wait(
    app: FastAPI, unlock_path: str, clock: FakeClock
) -> None:
    for n in range(10):
        await unlock(app, unlock_path, "203.0.113.7", f"guess {n}")
        clock.advance(30)

    async with visitor_from(app, "203.0.113.7") as client:
        response = await client.post(unlock_path, json={"password": "guess"})

    # The first guess was 300 s ago; it ages out of the 900 s window in 600 s.
    assert response.status_code == 429
    assert response.headers["retry-after"] == "600"
    assert response.json()["detail"] == "Too many attempts. Try again in 10 minutes."
