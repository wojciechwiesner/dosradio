"""Regression: long podcast topics must not collide in the episode cache; stale manifests regenerate."""
from __future__ import annotations

import json
from datetime import date
from pathlib import Path

from app import podcast
from app.archive import ArchiveRegistry
from app.podcast import PodcastService, slugify

LONG_PREFIX = "jak-dziala-sztuczna-inteligencja-w-codziennym-zyciu-"  # > 40 chars on its own


def _service(tmp_path: Path) -> PodcastService:
    return PodcastService(object(), tmp_path / "podcasts", ArchiveRegistry(tmp_path / "archive"))


def test_long_topics_sharing_a_prefix_get_distinct_episode_ids(tmp_path: Path) -> None:
    svc = _service(tmp_path)
    a = svc.episode_id(LONG_PREFIX.replace("-", " ") + "czesc pierwsza")
    b = svc.episode_id(LONG_PREFIX.replace("-", " ") + "czesc druga")
    assert a != b
    assert svc.episode_id("Krotki temat") == svc.episode_id("krotki temat")  # still stable for same topic


def test_disambiguated_episode_id_stays_a_valid_cache_dir_name(tmp_path: Path) -> None:
    svc = _service(tmp_path)
    episode_id = svc.episode_id(LONG_PREFIX.replace("-", " ") + "czesc pierwsza")
    assert svc._dir_for(episode_id).parent == svc.dir  # passes the episode-id charset check
    assert episode_id.startswith(f"{date.today():%Y-%m-%d}-")


def test_slugify_is_stable_and_short_topics_unchanged() -> None:
    assert slugify("Hello World") == "hello-world"
    long_topic = "x" * 80
    assert slugify(long_topic) == slugify(long_topic)


def _write_manifest(svc: PodcastService, episode_id: str, version: int) -> None:
    d = svc.dir / episode_id
    d.mkdir(parents=True)
    (d / "manifest.json").write_text(json.dumps({"version": version, "parts": []}))


def test_manifest_older_than_current_is_not_loaded_but_current_is(tmp_path: Path) -> None:
    svc = _service(tmp_path)
    current = podcast.MANIFEST_VERSION
    assert current >= 4  # v4 = 5-act segmented parts; v3 episodes must regenerate
    _write_manifest(svc, "2026-01-01-old", 3)
    _write_manifest(svc, "2026-01-01-new", current)
    assert svc.load_manifest("2026-01-01-old") is None
    assert svc.load_manifest("2026-01-01-new") is not None
