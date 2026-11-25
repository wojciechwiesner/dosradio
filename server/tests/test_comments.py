"""Listener comments on air, live host links with persona + day memory, cost guards. Fake LLM/TTS, no network."""
from __future__ import annotations

import sys
from pathlib import Path
from types import SimpleNamespace

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

FAKE_WAV = b"RIFF" + b"\x00" * 60
STATION = "dos-groove"


class Clock:
    def __init__(self) -> None:
        self.now = 1_790_000_000.0

    def __call__(self) -> float:
        return self.now


def make_env(tmp_path: Path, llm_reply: str | None = "Dzięki, Aniu, to dla mnie ważne. Wracamy do muzyki w AmbiRadio."):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient

    from app.comments import CommentService, build_comments_router
    from app.db import Database

    prompts: list[tuple[str, str]] = []
    spoken: list[str] = []

    async def generate(prompt: str, feature: str) -> str:
        prompts.append((feature, prompt))
        if feature == "moderation":
            return '{"ok": true, "score": 7}'
        if llm_reply is None:
            raise RuntimeError("no llm")
        return llm_reply

    async def speak(text: str, voice: str, style: str = "") -> bytes:
        spoken.append(text)
        return FAKE_WAV

    clock = Clock()
    service = CommentService(Database(tmp_path / "t.db"), generate=generate, headline=lambda: "Nowy teleskop pokazał galaktykę", clock=clock)
    app = FastAPI()
    actor = {"key": "c:listener-1"}
    app.include_router(build_comments_router(
        service=service, speak=speak, audio_dir=tmp_path,
        station_lookup=lambda sid: {"id": sid, "name": sid} if sid in ("dos-groove", "warm-jazz", "deep-tech") else None,
        actor_key=lambda request: actor["key"],
    ))
    return SimpleNamespace(client=TestClient(app), service=service, prompts=prompts, spoken=spoken, clock=clock, actor=actor)


@pytest.fixture()
def env(tmp_path):
    return make_env(tmp_path)


def post(env, text, nick="Ania z Krakowa", station=STATION):
    return env.client.post("/radio-api/comments", json={"station_id": station, "text": text, "nick": nick})


def test_comment_is_moderated_scored_and_read_on_air_with_nick(env):
    res = post(env, "Słucham was w pracy, czy możecie zagrać coś z basem na popołudnie?")
    assert res.status_code == 201
    body = res.json()
    assert body["status"] == "pending" and body["on_air"] is False
    assert body["share_url"] == f"/orbita.html?k={body['id']}"

    brk = env.client.get(f"/radio-api/host-break/{STATION}").json()["break"]
    assert brk["kind"] == "comment"
    assert brk["text"].startswith("Ania z Krakowa pisze: Słucham was w pracy")
    assert "Dzięki, Aniu" in brk["text"]
    assert brk["comment"]["on_air"] is True

    # persona and context reached the LLM
    feature, prompt = next(p for p in env.prompts if p[0] == "host_comment")
    assert "Kuba" in prompt and "Zabłociu" in prompt and "AmbiRadio" in prompt

    # commenter sees the state + shareable clip
    status = env.client.get(f"/radio-api/comments/{body['id']}").json()
    assert status["on_air"] is True and status["clip_url"].endswith("/clip.wav")
    clip = env.client.get(status["clip_url"])
    assert clip.status_code == 200 and clip.content == FAKE_WAV
    audio = env.client.get(brk["url"])
    assert audio.status_code == 200
    assert len(env.spoken) == 1  # voiced once, shared by clip and break

    feed = env.client.get(f"/radio-api/comments?station_id={STATION}").json()["comments"]
    assert feed[0]["id"] == body["id"] and feed[0]["on_air"] is True


def test_abusive_comment_rejected_and_never_stored_or_voiced(env):
    res = post(env, "ty kurwo jebana")
    assert res.status_code == 400
    assert "AmbiRadio" in res.json()["detail"]
    assert env.client.get(f"/radio-api/comments?station_id={STATION}").json()["comments"] == []
    assert env.spoken == []


def test_abusive_nick_rejected(env):
    assert post(env, "Fajna audycja dziś wieczorem", nick="chuj").status_code == 400


def test_text_over_280_rejected(env):
    assert post(env, "a" * 281).status_code == 400


def test_unknown_station_404(env):
    assert post(env, "Fajna audycja", station="nope").status_code == 404


def test_rate_limit_per_actor(env):
    texts = ["Pierwszy komentarz o muzyce dziś", "Drugi zupełnie inny temat rowerowy", "Trzecia myśl o kawie rano"]
    for t in texts:
        assert post(env, t).status_code == 201
    limited = post(env, "Czwarty komentarz za szybko")
    assert limited.status_code == 429
    env.actor["key"] = "c:someone-else"
    assert post(env, "Inny słuchacz też coś pisze").status_code == 201


def test_best_comment_wins_and_break_is_shared_by_listeners(env):
    post(env, "ok")  # too short, stays quiet
    env.actor["key"] = "c:2"
    post(env, "Pozdrawiam")
    env.actor["key"] = "c:3"
    best = post(env, "Jadę właśnie nocnym pociągiem do Gdańska, jaki utwór polecisz na taką drogę?", nick="Marek").json()
    first = env.client.get(f"/radio-api/host-break/{STATION}").json()["break"]
    assert first["comment"]["id"] == best["id"]
    second = env.client.get(f"/radio-api/host-break/{STATION}").json()["break"]
    assert second["id"] == first["id"]  # every listener on the station hears the same moment


def test_hourly_cap_limits_readouts(env, monkeypatch):
    monkeypatch.setenv("AMBI_COMMENTS_PER_HOUR", "1")
    post(env, "Pierwsza historia o kawie i porannym bieganiu w parku")
    env.actor["key"] = "c:2"
    post(env, "Druga historia o rowerze, deszczu i drodze do pracy")
    first = env.client.get(f"/radio-api/host-break/{STATION}").json()["break"]
    assert first["kind"] == "comment"
    env.clock.now += 11 * 60  # the shared window is over, but the hour cap is reached
    nxt = env.client.get(f"/radio-api/host-break/{STATION}").json()["break"]
    assert nxt["kind"] == "link"
    env.clock.now += 50 * 60  # an hour later the cap frees up; stale comments (45+ min) are not read
    env.actor["key"] = "c:3"
    post(env, "Trzecia, świeża historia o jesiennym spacerze z psem")
    later = env.client.get(f"/radio-api/host-break/{STATION}").json()["break"]
    assert later["kind"] == "comment"


def test_live_link_uses_persona_memory_and_news_and_is_cached_per_slot(env):
    post(env, "Słucham was przy kodowaniu, dzięki za spokojny groove")
    env.client.get(f"/radio-api/host-break/{STATION}")  # comment read, goes to memory
    env.clock.now += 11 * 60
    link = env.client.get(f"/radio-api/host-break/{STATION}").json()["break"]
    assert link["kind"] == "link"
    _, prompt = [p for p in env.prompts if p[0] == "host_link"][-1]
    assert "Pamięć dnia" in prompt and "kodowaniu" in prompt
    assert "Nowy teleskop" in prompt
    assert "Robisz swoje, ja pilnuję rytmu." in prompt
    calls = len(env.prompts)
    again = env.client.get(f"/radio-api/host-break/{STATION}").json()["break"]
    assert again["id"] == link["id"] and len(env.prompts) == calls  # cached, no new LLM call


def test_no_llm_means_template_answer_and_static_fallback_for_links(tmp_path):
    env = make_env(tmp_path, llm_reply=None)
    post(env, "Czy Kuba naprawdę grał w zespole?")
    brk = env.client.get(f"/radio-api/host-break/{STATION}").json()["break"]
    assert brk["kind"] == "comment"
    assert brk["text"].startswith("Ania z Krakowa pisze: Czy Kuba naprawdę grał w zespole?")
    env.clock.now += 11 * 60
    assert env.client.get(f"/radio-api/host-break/{STATION}").json()["break"] is None


def test_llm_output_with_abuse_falls_back_to_template(tmp_path):
    env = make_env(tmp_path, llm_reply="No i chuj, gramy dalej.")
    post(env, "Pozdrawiam całe studio z Poznania")
    brk = env.client.get(f"/radio-api/host-break/{STATION}").json()["break"]
    assert "chuj" not in brk["text"]


def test_llm_budget_guard(env, monkeypatch):
    monkeypatch.setenv("AMBI_HOST_LLM_PER_HOUR", "0")
    assert env.client.get(f"/radio-api/host-break/{STATION}").json()["break"] is None
    assert not any(p[0] == "host_link" for p in env.prompts)


def test_day_memory_keeps_last_ten_per_host(env):
    for i in range(14):
        env.service.remember("Kuba", "said", f"rzecz {i}")
    mem = env.service.memory("Kuba")
    assert len(mem) == 10 and mem[-1].endswith("rzecz 13") and mem[0].endswith("rzecz 4")
    assert env.service.memory("Ola") == []


def test_borrowed_station_host_shares_persona(env):
    post(env, "Deep tech na wieczór to jest to, dzięki!", station="deep-tech")
    env.client.get("/radio-api/host-break/deep-tech")
    _, prompt = next(p for p in env.prompts if p[0] == "host_comment")
    assert "Kuba" in prompt and "Deep Tech" in prompt


def test_break_audio_404_for_wrong_station_or_bad_id(env):
    assert env.client.get(f"/radio-api/host-break/{STATION}/bXXXX.wav").status_code == 404
    assert env.client.get(f"/radio-api/host-break/{STATION}/../x.wav").status_code == 404
    assert env.client.get("/radio-api/comments/kNOPE").status_code == 404


def test_score_prefers_questions_and_novelty():
    from app.comments import score_comment

    q = score_comment("Jak wam mija dzień w pracy, co polecacie na popołudnie?", [])
    flat = score_comment("Fajne radio", [])
    dup = score_comment("Jak wam mija dzień w pracy, co polecacie na popołudnie?", ["Jak wam mija dzień w pracy, co polecacie na popołudnie?"])
    shout = score_comment("SUPER RADIO NAJLEPSZE NA ŚWIECIE", [])
    assert q > flat and q > dup and flat > shout


def test_every_host_has_a_distinct_polish_persona():
    from app.hosts import HOSTS

    stories = set()
    for sid, host in HOSTS.items():
        p = host.persona
        assert p.backstory and p.worldview and p.humour and p.address and p.day_thread, sid
        assert 3 <= p.backstory.count(".") <= 5, sid
        assert p.catchphrases and p.pet_topics and p.loves and p.hates, sid
        stories.add(p.backstory)
    assert len(stories) == len(HOSTS)
