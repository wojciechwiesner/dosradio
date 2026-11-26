"""The plain home page (no share params) is served through og/share-html, so it is the first thing a
browser tab, a search engine and a link preview see. It must carry the AmbiRadio brand, and canonical
must point at the host that actually serves the page (ambiradio.com is not registered yet)."""
from __future__ import annotations

from pathlib import Path

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.archive import ArchiveRegistry
from app.custom_radios import CustomRadioService
from app.db import Database
from app.og_preview import build_og_router
from app.podcast import PodcastService

INDEX = Path(__file__).resolve().parents[2] / "index.html"


def _client(monkeypatch, tmp_path: Path, base_url: str | None) -> TestClient:
    if base_url:
        monkeypatch.setenv("DOSRADIO_PUBLIC_BASE_URL", base_url)
    else:
        monkeypatch.delenv("DOSRADIO_PUBLIC_BASE_URL", raising=False)
    db = Database(tmp_path / "og.db")
    app = FastAPI()
    app.include_router(build_og_router(
        db=db,
        podcasts=PodcastService(None, tmp_path / "podcasts", ArchiveRegistry(tmp_path / "archive")),  # type: ignore[arg-type]
        custom_radios=CustomRadioService(db),
        station_lookup=lambda sid: {"id": sid, "name": "DOS Groove"},
        html_candidates=[INDEX],
    ))
    return TestClient(app)


def test_home_title_is_the_brand(monkeypatch, tmp_path):
    page = _client(monkeypatch, tmp_path, "https://dosradio.theones.io").get("/radio-api/og/share-html").text
    assert "<title>AmbiRadio — Ambitnie dla Ciebie</title>" in page
    assert "audycja w radiu dosradio.theones.io" not in page


def test_home_canonical_follows_public_base_url(monkeypatch, tmp_path):
    page = _client(monkeypatch, tmp_path, "https://dosradio.theones.io").get("/radio-api/og/share-html").text
    assert '<link rel="canonical" href="https://dosradio.theones.io/" />' in page
    assert 'canonical" href="https://ambiradio.com/' not in page


def test_canonical_defaults_to_ambiradio(monkeypatch, tmp_path):
    page = _client(monkeypatch, tmp_path, None).get("/radio-api/og/share-html").text
    assert '<link rel="canonical" href="https://ambiradio.com/" />' in page


def test_shared_item_keeps_its_own_title(monkeypatch, tmp_path):
    page = _client(monkeypatch, tmp_path, "https://dosradio.theones.io").get("/radio-api/og/share-html?station=dos-groove").text
    assert "<title>Stacja DOS Groove — audycja w radiu AmbiRadio</title>" in page
