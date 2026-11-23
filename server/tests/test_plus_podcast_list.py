"""'Moje podcasty': GET /radio-api/plus/podcasts merges Plus-panel and website-link podcasts."""
from __future__ import annotations

import shutil

from test_plus import client, fake_ffmpeg, fake_gemini, plus_client  # noqa: F401  (fixtures)

LIST_URL = "/radio-api/plus/podcasts"


def _user_id(email: str) -> int:
    from app.main import db
    return int(db.find_user_by_email(email)["id"])


def _generate(plus_client, topic: str = "Sen i produktywność") -> dict:
    return plus_client.post("/radio-api/plus/podcast", json={"topic": topic}).json()


def test_list_gated_for_anonymous_and_free(client):
    assert client.get(LIST_URL).status_code == 402
    client.post("/radio-api/register", json={"email": "free@example.com", "password": "dlugiehaslo1"})
    from app.main import db
    with db.connect() as conn:
        conn.execute("UPDATE users SET email_verified = 1 WHERE email = 'free@example.com'")
    client.post("/radio-api/login", json={"email": "free@example.com", "password": "dlugiehaslo1"})
    assert client.get(LIST_URL).status_code == 402


def test_generated_podcast_appears_even_from_cache(plus_client, fake_gemini):
    assert plus_client.get(LIST_URL).json() == {"podcasts": []}
    manifest = _generate(plus_client)
    _generate(plus_client)  # served from cache, still one row
    items = plus_client.get(LIST_URL).json()["podcasts"]
    assert [item["id"] for item in items] == [manifest["id"]]
    item = items[0]
    assert item["source"] == "plus" and item["status"] == "ready"
    assert item["title"] == "Testowy odcinek" and item["parts"] == manifest["parts"]


def test_other_user_does_not_see_it(plus_client, fake_gemini):
    _generate(plus_client)
    from app.main import db
    plus_client.post("/radio-api/logout")
    plus_client.post("/radio-api/register", json={"email": "ewa@example.com", "password": "dlugiehaslo1"})
    with db.connect() as conn:
        conn.execute("UPDATE users SET email_verified = 1, plan = 'plus' WHERE email = 'ewa@example.com'")
    plus_client.post("/radio-api/login", json={"email": "ewa@example.com", "password": "dlugiehaslo1"})
    assert plus_client.get(LIST_URL).json() == {"podcasts": []}


def _drop(owner: str, **fields) -> dict:
    from app.main import db
    from app.social import SocialService
    return SocialService(db).create_drop(
        prefix="p", from_key=owner, kind="podcast", site_title="Strona testowa",
        source_url="https://example.com/a", **fields)


def test_link_drops_ready_pending_failed(plus_client, fake_gemini):
    owner = f"u:{_user_id('ola@example.com')}"
    manifest = _generate(plus_client, "Link ready")
    ready = _drop(owner, podcast_id=manifest["id"], podcast_status="ready")
    pending = _drop(owner, podcast_status="generating")
    failed = _drop(owner, podcast_status="failed")
    _drop("u:99999", podcast_id=manifest["id"], podcast_status="ready")  # someone else's
    items = {item["id"]: item for item in plus_client.get(LIST_URL).json()["podcasts"]}
    assert items[manifest["id"]]["source"] == "link"  # duplicate collapsed, link metadata kept
    assert items[manifest["id"]]["share_path"] == f"/orbita.html?p={ready['token']}"
    assert items[manifest["id"]]["site_title"] == "Strona testowa"
    assert items[pending["token"]]["status"] == "generating" and items[pending["token"]]["parts"] == []
    assert items[failed["token"]]["status"] == "failed"
    assert len(items) == 3


def test_evicted_episode_is_not_listed(plus_client, fake_gemini):
    from app.main import podcasts
    owner = f"u:{_user_id('ola@example.com')}"
    plus_manifest = _generate(plus_client, "Plus evicted")
    link_manifest = _generate(plus_client, "Link evicted")
    _drop(owner, podcast_id=link_manifest["id"], podcast_status="ready")
    for manifest in (plus_manifest, link_manifest):
        shutil.rmtree(podcasts.dir / manifest["id"])
    assert plus_client.get(LIST_URL).json() == {"podcasts": []}


def test_newest_first(plus_client, fake_gemini):
    first, second = _generate(plus_client, "Pierwszy"), _generate(plus_client, "Drugi")
    from app.main import db
    with db.connect() as conn:
        conn.execute("UPDATE user_podcasts SET added_at = added_at - 100 WHERE episode_id = ?", (first["id"],))
    ids = [item["id"] for item in plus_client.get(LIST_URL).json()["podcasts"]]
    assert ids == [second["id"], first["id"]]
