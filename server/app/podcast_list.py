"""'Moje podcasty': a listener's podcasts merged from the Plus panel and website-link drops."""
from __future__ import annotations

import sqlite3
from typing import Any

from .db import Database
from .podcast import MAX_EPISODES_KEPT, PodcastService

SHARE_PATH_PREFIX = "/orbita.html?p="
STATUS_READY = "ready"
STATUS_GENERATING = "generating"
STATUS_FAILED = "failed"
SOURCE_PLUS = "plus"
SOURCE_LINK = "link"


def _link_drops(db: Database, user_id: int, limit: int) -> list[dict[str, Any]]:
    """Podcast drops created by this signed-in listener (from_key `u:<id>`), newest first."""
    try:
        with db.connect() as conn:
            rows = conn.execute(
                "SELECT token, podcast_id, podcast_status, site_title, source_url, created_at "
                "FROM social_drops WHERE kind = 'podcast' AND from_key = ? "
                "ORDER BY created_at DESC LIMIT ?",
                (f"u:{user_id}", limit),
            ).fetchall()
    except sqlite3.OperationalError:  # social tables not created yet
        return []
    return [dict(row) for row in rows]


def _plus_item(manifest: dict, added_at: float) -> dict[str, Any]:
    return {"id": manifest["id"], "title": manifest.get("title", ""), "summary": manifest.get("summary", ""),
            "created_at": added_at, "parts": manifest.get("parts", []), "source": SOURCE_PLUS,
            "status": STATUS_READY}


def _link_item(drop: dict[str, Any], manifest: dict | None) -> dict[str, Any] | None:
    status = drop["podcast_status"] or STATUS_GENERATING
    item = {"id": drop["podcast_id"] or drop["token"], "title": drop["site_title"], "summary": "",
            "created_at": float(drop["created_at"]), "parts": [], "source": SOURCE_LINK,
            "site_title": drop["site_title"], "source_url": drop["source_url"],
            "share_path": f"{SHARE_PATH_PREFIX}{drop['token']}", "status": status}
    if status == STATUS_READY:
        if manifest is None:
            return None  # episode evicted from disk
        item.update(title=manifest.get("title") or drop["site_title"],
                    summary=manifest.get("summary", ""), parts=manifest.get("parts", []))
    return item


def list_user_podcasts(db: Database, podcasts: PodcastService, user_id: int) -> list[dict[str, Any]]:
    """Newest first, deduplicated by episode id, ready ones only if the manifest still loads."""
    items: dict[str, dict[str, Any]] = {}
    for drop in _link_drops(db, user_id, MAX_EPISODES_KEPT):
        manifest = podcasts.load_manifest(drop["podcast_id"]) if drop["podcast_id"] else None
        item = _link_item(drop, manifest)
        if item is not None:
            items.setdefault(item["id"], item)
    for episode_id, added_at in db.user_podcasts(user_id, MAX_EPISODES_KEPT):
        manifest = podcasts.load_manifest(episode_id)
        if manifest is None:
            continue
        existing = items.get(episode_id)
        if existing is None:
            items[episode_id] = _plus_item(manifest, added_at)
        elif existing["source"] == SOURCE_LINK:  # keep link metadata, but the newer date wins
            existing["created_at"] = max(existing["created_at"], added_at)
    return sorted(items.values(), key=lambda item: item["created_at"], reverse=True)
