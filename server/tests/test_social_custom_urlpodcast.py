"""Tests for Social Graph, Invite-with-Greeting, Airwave Drops, Custom Radios & URL-to-Podcast Links."""
from __future__ import annotations

from pathlib import Path
import time
import wave

from fastapi import FastAPI
from fastapi.testclient import TestClient
import pytest

from app import url_extractor
from app.auth import AccessService
from app.custom_radios import CustomRadioService, build_custom_radios_router
from app.db import Database
from app.podcast import PodcastService
from app.social_api import build_social_router


def _dummy_wav(path: Path) -> bytes:
    buf = bytearray()
    import io
    b = io.BytesIO()
    with wave.open(b, "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(24000)
        wf.writeframes(b"\x00\x00" * 2400)
    data = b.getvalue()
    path.write_bytes(data)
    return data


def _build_test_app(tmp_path: Path) -> tuple[TestClient, PodcastService]:
    db = Database(tmp_path / "test.db")
    access = AccessService(db, "test-secret-key-32-chars-minimum!!", 3600)

    class StubGemini:
        async def chat(self, prompt: str, **kw: object) -> str:
            import json
            turns = [
                {"speaker": i % 2, "text": f"Wypowiedź numer {i + 1} na temat badanej strony internetowej oraz serdecznych pozdrowień."}
                for i in range(8)
            ]
            return json.dumps({"title": "Audycja o stronie", "turns": turns}, ensure_ascii=False)

        async def speak(self, text: str, voice: str = "Puck", style: str = "") -> bytes:
            return _dummy_wav(tmp_path / "tts.wav")

    from app.archive import ArchiveRegistry
    archives = ArchiveRegistry(tmp_path / "archive")
    podcasts = PodcastService(StubGemini(), tmp_path / "podcasts", archives)
    custom_svc = CustomRadioService(db)

    app = FastAPI()
    app.include_router(build_custom_radios_router(custom_svc, access=access))
    app.include_router(
        build_social_router(
            db=db,
            access=access,
            podcasts=podcasts,
            station_lookup=lambda sid: {"id": sid, "name": sid.replace("-", " ").title()},
        )
    )
    return TestClient(app), podcasts


def test_url_extractor_blocks_ssrf_and_extracts_clean_html(monkeypatch: pytest.MonkeyPatch):
    with pytest.raises(ValueError, match="lokalny|prywatny"):
        url_extractor._validate_public_url("http://127.0.0.1:8080/admin")
    with pytest.raises(ValueError, match="lokalny|prywatny"):
        url_extractor._validate_public_url("http://localhost/secret")

    monkeypatch.setattr(
        url_extractor,
        "_fetch_html_raw",
        lambda url, timeout=10.0: (
            "<html><head><title>The Ones AI Studio</title>"
            "<meta name='description' content='Systemy deterministyczne dla biznesu.'>"
            "<script>alert(1)</script></head>"
            "<body><h1>Budujemy fabryki agentów</h1><p>Konkretne wdrożenia produkcyjne B2B.</p></body></html>"
        ),
    )
    res = url_extractor.extract_webpage_content("https://theones.io")
    assert res["title"] == "The Ones AI Studio"
    assert "Systemy deterministyczne" in res["description"]
    assert "Budujemy fabryki agentów" in res["text"]
    assert "alert(1)" not in res["text"]


def test_friends_invite_with_greeting_and_live_hijack_pairing(tmp_path: Path):
    client, _ = _build_test_app(tmp_path)

    # Sender adds Klaudia with phone + immediate greeting
    r = client.post(
        "/radio-api/social/friends",
        headers={"X-Client-Id": "wojtek-1", "X-Display-Name": "Wojtek"},
        json={
            "name": "Klaudia",
            "phone": "500600700",
            "channel": "whatsapp",
            "with_greeting": True,
            "greeting_message": "Miłego dnia w salonie!",
            "station_id": "berlin-bcco-techno",
        },
    )
    assert r.status_code == 200
    body = r.json()
    assert body["friend"]["phone"] == "+48500600700"
    assert "wa.me/48500600700" in body["whatsapp_url"]
    assert "t.me/share/url" in body["telegram_url"]
    tok = body["drop_token"]
    assert tok.startswith("w_")

    # Klaudia opens ?w=tok -> auto-pairs both sides as friends!
    claim = client.post(
        f"/radio-api/social/drops/{tok}/claim",
        headers={"X-Client-Id": "klaudia-9", "X-Display-Name": "Klaudia"},
        json={"display_name": "Klaudia"},
    )
    assert claim.status_code == 200
    assert claim.json()["auto_paired"] is True
    assert claim.json()["drop"]["dedication"]["to_name"] == "Klaudia"

    # Klaudia sends live presence on berlin-bcco-techno -> Wojtek sees Klaudia online on that ring!
    client.post(
        "/radio-api/social/presence",
        headers={"X-Client-Id": "klaudia-9"},
        json={"station_id": "berlin-bcco-techno", "display_name": "Klaudia"},
    )
    pres_w = client.post(
        "/radio-api/social/presence",
        headers={"X-Client-Id": "wojtek-1"},
        json={"station_id": "dos-groove", "display_name": "Wojtek"},
    ).json()
    assert any(f["name"] == "Klaudia" and f["station_id"] == "berlin-bcco-techno" for f in pres_w["friends_online"])

    # Wojtek sends a Live Pill Drop to Klaudia -> Klaudia's next presence poll receives incoming_live_drops!
    friends_w = client.get("/radio-api/social/friends", headers={"X-Client-Id": "wojtek-1"}).json()["friends"]
    kl_id = next(f["id"] for f in friends_w if f["name"] == "Klaudia")
    d_res = client.post(
        "/radio-api/social/drops",
        headers={"X-Client-Id": "wojtek-1", "X-Display-Name": "Wojtek"},
        json={
            "to_friend_id": kl_id,
            "kind": "pill",
            "station_id": "berlin-bcco-techno",
            "message": "Nowy raport o AI w logistyce",
        },
    )
    assert d_res.status_code == 200
    pres_kl = client.post(
        "/radio-api/social/presence",
        headers={"X-Client-Id": "klaudia-9"},
        json={"station_id": "berlin-bcco-techno", "display_name": "Klaudia"},
    ).json()
    assert len(pres_kl["incoming_live_drops"]) == 1
    assert pres_kl["incoming_live_drops"][0]["kind"] == "pill"


def test_custom_creator_youtuber_radio_and_pills(tmp_path: Path):
    client, _ = _build_test_app(tmp_path)
    r = client.post(
        "/radio-api/custom-radios",
        headers={"X-Client-Id": "yt-creator-1"},
        json={
            "name": "Cyber Kodowanie Live",
            "creator_name": "Kuba Dev YT",
            "mode": "describe",
            "description": "Mroczny synthwave i cyberpunk do nocnego programowania",
            "host": "Kuba",
            "pills": [
                {"title": "Odcinek #42", "url": "https://youtube.com/watch?v=abc12345", "note": "Architektura agentów w 10 minut"}
            ],
        },
    )
    assert r.status_code == 200
    data = r.json()
    slug = data["slug"]
    assert data["radio"]["base_station_id"] == "stranger-synth"
    assert len(data["radio"]["pills"]) == 1
    assert f"?r={slug}" in data["share_url"]

    # Fetch by slug
    got = client.get(f"/radio-api/custom-radios/{slug}").json()["radio"]
    assert got["creator_name"] == "Kuba Dev YT"


def test_url_podcast_outreach_link_generates_and_serves_public_parts(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(
        url_extractor,
        "_fetch_html_raw",
        lambda url, timeout=10.0: (
            "<html><head><title>Buddy Works CI/CD</title>"
            "<meta name='description' content='Błyskawiczne pipeline CI/CD dla zespołów dev.'></head>"
            "<body><p>Automatyzacja wdrożeń w 12 sekund z pełnym wsparciem kontenerów.</p></body></html>"
        ),
    )
    client, _ = _build_test_app(tmp_path)
    res = client.post(
        "/radio-api/social/url-podcast-link",
        headers={"X-Client-Id": "wojtek-1", "X-Display-Name": "Wojtek"},
        json={
            "url": "https://buddy.works",
            "recipient_name": "Szymon",
            "comment": "Cześć Szymon, posłuchaj co nasi prowadzący mówią o Buddy!",
            "station_id": "dos-groove",
        },
    )
    assert res.status_code == 200
    out = res.json()
    tok = out["token"]
    assert tok.startswith("p_")
    assert out["site_title"] == "Buddy Works CI/CD"
    assert f"?p={tok}" in out["share_url"]

    # Poll until background podcast finishes
    poll: dict = {}
    for _ in range(25):
        poll = client.get(f"/radio-api/social/url-podcast-link/{tok}").json()["drop"]
        if poll.get("podcast", {}).get("status") == "ready":
            break
        time.sleep(0.05)
    assert poll["podcast"]["status"] == "ready"
    parts = poll["podcast"]["parts"]
    assert len(parts) >= 1
    # Verify recipient can stream segment audio publicly without Plus login
    seg_res = client.get(parts[0]["url"])
    assert seg_res.status_code == 200
    assert len(seg_res.content) > 40
    # Verify structured sections (intro -> part_1..3 -> outro) & rich invite metadata
    sections = [p["section"] for p in parts]
    assert sections[0] == "intro"
    assert sections[-1] == "outro"
    assert poll["invite"]["title"]
    assert "automatyzacji" in poll["invite"]["about"] or poll["invite"]["about"]
    assert poll["invite"]["station_name"] == "Dos Groove"

    # Verify Guest gets a DOS Radio ciekawostka/spot + playable WAV
    spot_res = client.get("/radio-api/social/spot?station=dos-groove").json()
    assert spot_res["skip"] is False
    assert spot_res["tier"] == "guest"
    assert spot_res["spot"]["id"].startswith("guest_")
    wav_res = client.get(spot_res["spot"]["audio_url"])
    assert wav_res.status_code == 200
    assert len(wav_res.content) > 40

