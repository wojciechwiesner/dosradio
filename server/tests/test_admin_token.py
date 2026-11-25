"""Admin token resolution: a dedicated env token wins; the fallback is derived, never a raw secret prefix."""
from __future__ import annotations

import sys
from pathlib import Path
from types import SimpleNamespace
from typing import cast

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.admin_api import _expected_admin_token
from app.auth import AccessService

APP_SECRET = "0123456789abcdef" * 3
ACCESS_SECRET = "fedcba9876543210" * 3


@pytest.fixture()
def clean_env(monkeypatch: pytest.MonkeyPatch) -> pytest.MonkeyPatch:
    monkeypatch.delenv("DOSRADIO_ADMIN_TOKEN", raising=False)
    monkeypatch.delenv("DOSRADIO_SECRET", raising=False)
    return monkeypatch


def test_dedicated_admin_token_wins_over_app_secret(clean_env: pytest.MonkeyPatch) -> None:
    clean_env.setenv("DOSRADIO_ADMIN_TOKEN", "dedicated-admin-token")
    clean_env.setenv("DOSRADIO_SECRET", APP_SECRET)
    assert _expected_admin_token() == "dedicated-admin-token"


def test_fallback_token_is_derived_and_never_exposes_the_secret(clean_env: pytest.MonkeyPatch) -> None:
    clean_env.setenv("DOSRADIO_SECRET", APP_SECRET)
    token = _expected_admin_token()
    assert token == _expected_admin_token()
    assert len(token) >= 32
    assert token != APP_SECRET[:32]
    assert APP_SECRET[:16] not in token


def test_fallback_uses_access_secret_when_env_secret_missing(clean_env: pytest.MonkeyPatch) -> None:
    access = cast(AccessService, SimpleNamespace(secret=ACCESS_SECRET))
    token = _expected_admin_token(access)
    assert len(token) >= 32
    assert ACCESS_SECRET[:16] not in token


def test_token_auth_is_disabled_when_nothing_is_configured(clean_env: pytest.MonkeyPatch) -> None:
    assert _expected_admin_token() == ""
    assert _expected_admin_token(cast(AccessService, SimpleNamespace(secret=""))) == ""
