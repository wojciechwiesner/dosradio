"""Circuit breaker for LLM and TTS providers.

After a quota (429) or auth (401/403, invalid key) failure a provider is skipped for
a cooldown, so a dead key stops costing a network round trip on every request.
Quota cooldowns honour the provider's own hint (Gemini `retryDelay`, HTTP
`Retry-After`) when there is one.
"""
from __future__ import annotations

import logging
import re
import time
from email.utils import parsedate_to_datetime
from typing import Callable

log = logging.getLogger("dosradio.breaker")

QUOTA_STATUS = 429
AUTH_STATUSES = (401, 403)
QUOTA_COOLDOWN_S = 600.0
AUTH_COOLDOWN_S = 1800.0
MAX_COOLDOWN_S = 3600.0
MIN_QUOTA_COOLDOWN_S = 60.0
INVALID_KEY_MARKERS = ("api key not valid", "api_key_invalid", "invalid api key")
_SECONDS_RE = re.compile(r"^\s*(\d+(?:\.\d+)?)s\s*$")


class ProviderError(RuntimeError):
    """One failed provider call, with what the breaker needs to decide on a cooldown."""

    def __init__(self, provider: str, model: str, status: int, message: str,
                 retry_after: float | None = None) -> None:
        super().__init__(f"{provider}/{model} HTTP {status}: {message}")
        self.provider = provider
        self.model = model
        self.status = status
        self.message = message
        self.retry_after = retry_after

    @property
    def is_auth(self) -> bool:
        text = self.message.lower()
        return self.status in AUTH_STATUSES or any(marker in text for marker in INVALID_KEY_MARKERS)

    @property
    def is_quota(self) -> bool:
        return self.status == QUOTA_STATUS


class ProviderCoolingDown(RuntimeError):
    """Raised instead of calling a provider whose breaker is open (no network call made)."""

    def __init__(self, name: str, remaining_s: float) -> None:
        super().__init__(f"{name} cooling down for {remaining_s:.0f} s")
        self.name = name
        self.remaining_s = remaining_s


def parse_retry_after(value: str | None, now: float | None = None) -> float | None:
    """HTTP Retry-After: delta seconds or an HTTP date."""
    if not value:
        return None
    value = value.strip()
    if value.replace(".", "", 1).isdigit():
        return float(value)
    try:
        moment = parsedate_to_datetime(value).timestamp()
    except (TypeError, ValueError):
        return None
    return max(0.0, moment - (time.time() if now is None else now))


def gemini_retry_delay(payload: dict) -> float | None:
    """Gemini puts `retryDelay: "37s"` inside error.details (google.rpc.RetryInfo)."""
    details = (payload.get("error") or {}).get("details") or []
    for detail in details:
        if not isinstance(detail, dict):
            continue
        match = _SECONDS_RE.match(str(detail.get("retryDelay") or ""))
        if match:
            return float(match.group(1))
    return None


def cooldown_for(error: ProviderError, strikes: int = 1) -> float | None:
    """Seconds to skip the provider, or None when the failure does not warrant a cooldown.

    A quota hint is a lower bound: each consecutive quota failure doubles the cooldown
    (capped at an hour), so an exhausted daily quota is not retried every few seconds.
    """
    if error.is_auth:
        return AUTH_COOLDOWN_S
    if error.is_quota:
        hint = error.retry_after if error.retry_after is not None else QUOTA_COOLDOWN_S
        base = max(MIN_QUOTA_COOLDOWN_S, hint)
        return min(MAX_COOLDOWN_S, base * 2 ** (max(1, strikes) - 1))
    return None


class CircuitBreaker:
    """Open circuits keyed by provider (auth: whole key dead) or provider/model (quota)."""

    def __init__(self, clock: Callable[[], float] = time.monotonic) -> None:
        self.clock = clock
        self.open_until: dict[str, float] = {}
        self.strikes: dict[str, int] = {}

    @staticmethod
    def model_key(provider: str, model: str) -> str:
        return f"{provider}/{model}"

    def remaining(self, provider: str, model: str) -> float:
        """Longest remaining cooldown covering this provider/model, 0 when it may be called."""
        now = self.clock()
        keys = (provider, self.model_key(provider, model))
        return max(0.0, *(self.open_until.get(key, 0.0) - now for key in keys))

    def guard(self, provider: str, model: str) -> None:
        """Raise ProviderCoolingDown when the circuit is open."""
        remaining = self.remaining(provider, model)
        if remaining > 0:
            raise ProviderCoolingDown(self.model_key(provider, model), remaining)

    def record(self, error: ProviderError) -> float | None:
        """Open the circuit for a quota/auth failure; return the cooldown that was applied."""
        key = error.provider if error.is_auth else self.model_key(error.provider, error.model)
        strikes = self.strikes.get(key, 0) + 1
        seconds = cooldown_for(error, strikes)
        if seconds is None:
            return None
        self.strikes[key] = strikes
        self.open_until[key] = max(self.open_until.get(key, 0.0), self.clock() + seconds)
        log.warning("breaker open: %s for %.0f s after HTTP %s", key, seconds, error.status)
        return seconds

    def success(self, provider: str, model: str) -> None:
        """A served call resets the escalation for this provider/model."""
        self.strikes.pop(provider, None)
        self.strikes.pop(self.model_key(provider, model), None)
