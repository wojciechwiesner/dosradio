"""AmbiRadio public base URL: env-configurable, defaults to ambiradio.com, legacy env still honoured."""
from app.config import BRAND_TAGLINE, PUBLIC_HOSTS, public_base_url, public_domain


def test_default_is_ambiradio(monkeypatch):
    monkeypatch.delenv("DOSRADIO_PUBLIC_BASE_URL", raising=False)
    monkeypatch.delenv("DOSRADIO_PUBLIC_URL", raising=False)
    assert public_base_url() == "https://ambiradio.com"
    assert public_domain() == "ambiradio.com"


def test_env_override_wins_and_is_trimmed(monkeypatch):
    monkeypatch.setenv("DOSRADIO_PUBLIC_URL", "https://legacy.example")
    monkeypatch.setenv("DOSRADIO_PUBLIC_BASE_URL", "https://dosradio.theones.io/")
    assert public_base_url() == "https://dosradio.theones.io"
    assert public_domain() == "dosradio.theones.io"


def test_legacy_env_still_works(monkeypatch):
    monkeypatch.delenv("DOSRADIO_PUBLIC_BASE_URL", raising=False)
    monkeypatch.setenv("DOSRADIO_PUBLIC_URL", "https://legacy.example")
    assert public_base_url() == "https://legacy.example"


def test_both_hosts_listed_and_tagline():
    assert "ambiradio.com" in PUBLIC_HOSTS and "dosradio.theones.io" in PUBLIC_HOSTS
    assert BRAND_TAGLINE == "AmbiRadio — Ambitnie dla Ciebie"
