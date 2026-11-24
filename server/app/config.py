"""Runtime settings for the DOS Radio API, read once from the environment.

Supports GEMINI_API_KEYS (comma-separated list of keys from multiple Google accounts)
with round-robin and per-account rate limit rotation, so N accounts provide N x quota.
"""
from __future__ import annotations

import itertools
import logging
import os
import threading
from dataclasses import dataclass, field
from pathlib import Path

log = logging.getLogger("dosradio.config")


class KeyPool:
    """Thread-safe round-robin pool of Gemini API keys across multiple Google accounts."""

    def __init__(self, keys: list[str]) -> None:
        cleaned = [k.strip() for k in keys if k.strip()]
        if not cleaned:
            raise RuntimeError("GEMINI_API_KEY or GEMINI_API_KEYS is required")
        self._keys = cleaned
        self._cycle = itertools.cycle(self._keys)
        self._lock = threading.Lock()
        log.info("KeyPool initialized with %d Google account keys", len(self._keys))

    @property
    def total(self) -> int:
        return len(self._keys)

    def next_key(self) -> str:
        with self._lock:
            return next(self._cycle)

    def all_keys(self) -> list[str]:
        return list(self._keys)


@dataclass(frozen=True)
class Settings:
    key_pool: KeyPool
    secret: str
    data_dir: Path
    trial_seconds: int
    news_model: str
    tts_model: str
    news_refresh_seconds: int
    prewarm: bool
    device_keys: dict[str, str] = field(default_factory=dict)

    @property
    def gemini_api_key(self) -> str:
        return self.key_pool.next_key()

    def next_key(self) -> str:
        return self.key_pool.next_key()


def load_settings() -> Settings:
    raw_keys = os.environ.get("GEMINI_API_KEYS", "").strip()
    single_key = os.environ.get("GEMINI_API_KEY", "").strip()
    keys = [k for k in (raw_keys.split(",") if raw_keys else [single_key]) if k.strip()]
    if not keys:
        raise RuntimeError("GEMINI_API_KEY or GEMINI_API_KEYS must be set")

    secret = os.environ.get("DOSRADIO_SECRET", "").strip()
    if len(secret) < 32:
        raise RuntimeError("DOSRADIO_SECRET must be at least 32 characters")

    data_dir = Path(os.environ.get("DOSRADIO_DATA_DIR", "./data")).resolve()
    data_dir.mkdir(parents=True, exist_ok=True)

    return Settings(
        key_pool=KeyPool(keys),
        secret=secret,
        data_dir=data_dir,
        trial_seconds=int(os.environ.get("DOSRADIO_TRIAL_SECONDS", "3600")),
        news_model=os.environ.get("DOSRADIO_NEWS_MODEL", "gemini-3.8-flash"),
        tts_model=os.environ.get("DOSRADIO_TTS_MODEL", "gemini-3.8-flash-tts"),
        news_refresh_seconds=int(os.environ.get("DOSRADIO_NEWS_REFRESH", "3600")),
        prewarm=os.environ.get("DOSRADIO_PREWARM", "1") == "1",
        device_keys=parse_device_keys(os.environ.get("DOSRADIO_DEVICE_KEYS", "")),
    )


def parse_device_keys(raw: str) -> dict[str, str]:
    """`name:key,name2:key2` -> {key: name}. Keys shorter than 32 chars are rejected."""
    devices: dict[str, str] = {}
    for item in raw.split(","):
        name, _, key = item.strip().partition(":")
        if not name or not key:
            continue
        if len(key) < 32:
            raise RuntimeError(f"DOSRADIO_DEVICE_KEYS: key for '{name}' must be at least 32 characters")
        devices[key] = name
    return devices
