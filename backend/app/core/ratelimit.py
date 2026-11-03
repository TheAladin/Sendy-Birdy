"""Slowing down password guessing: a sliding window of recent failures per key."""

import math
import time
from collections import deque
from collections.abc import Callable
from dataclasses import dataclass, field

from fastapi import HTTPException, status


@dataclass
class SlidingWindow:
    """At most `limit` failures per key within any `window` seconds.

    Kept in memory: limits reset when the app restarts, and each process counts on its own.
    That suits one self-hosted process; a cluster would need a shared store such as Redis.
    """

    limit: int
    window: float
    clock: Callable[[], float] = time.monotonic
    # Keys are visitor addresses, so their number is bounded only by the attacker's patience.
    max_keys: int = 10_000
    _failures: dict[str, deque[float]] = field(default_factory=dict)

    def _recent(self, key: str, now: float) -> deque[float]:
        failures = self._failures.get(key, deque())
        while failures and failures[0] <= now - self.window:
            failures.popleft()
        return failures

    def retry_after(self, key: str) -> int | None:
        """Seconds until another attempt is allowed, or None if it's allowed now."""
        now = self.clock()
        failures = self._recent(key, now)
        if not failures:
            self._failures.pop(key, None)
            return None
        if len(failures) < self.limit:
            return None
        # The window slides: an attempt frees up when the oldest counted failure ages out.
        return max(1, math.ceil(failures[0] + self.window - now))

    def record_failure(self, key: str) -> None:
        now = self.clock()
        if key not in self._failures and len(self._failures) >= self.max_keys:
            self._forget_stale(now)
        failures = self._recent(key, now)
        failures.append(now)
        self._failures[key] = failures

    def reset(self, key: str) -> None:
        self._failures.pop(key, None)

    def _forget_stale(self, now: float) -> None:
        for key in [k for k, v in self._failures.items() if not v or v[-1] <= now - self.window]:
            del self._failures[key]
        # Still full of recent keys: drop the oldest ones rather than grow without bound.
        while len(self._failures) >= self.max_keys:
            del self._failures[next(iter(self._failures))]


@dataclass
class RateLimits:
    """The app's limiters, kept on app.state so each app (and each test) has its own."""

    login: SlidingWindow = field(default_factory=lambda: SlidingWindow(limit=10, window=15 * 60))
    unlock_per_visitor: SlidingWindow = field(
        default_factory=lambda: SlidingWindow(limit=10, window=15 * 60)
    )
    # Across all visitors: stops guessing spread over many addresses. The price is that
    # someone could lock a link for up to an hour by failing on purpose; revoking and
    # re-sharing is the way out.
    unlock_per_share: SlidingWindow = field(
        default_factory=lambda: SlidingWindow(limit=50, window=60 * 60)
    )


def too_many_attempts(seconds: int) -> HTTPException:
    wait = f"{math.ceil(seconds / 60)} minutes" if seconds >= 90 else f"{seconds} seconds"
    return HTTPException(
        status.HTTP_429_TOO_MANY_REQUESTS,
        f"Too many attempts. Try again in {wait}.",
        headers={"Retry-After": str(seconds)},
    )
