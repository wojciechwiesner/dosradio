"""Moderation: abuse list (PL+EN, evasions), contact stripping, length cap, optional cached LLM."""
from __future__ import annotations

import asyncio
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.moderation import LLMModerator, contains_abuse, moderate, moderate_many, moderate_with_llm  # noqa: E402


@pytest.mark.parametrize("text", [
    "ty kurwo", "Kurwa mać", "k u r w a", "ku.rwa", "kuuuurwa", "KURW@", "spierdalaj", "jebać to",
    "chuj ci w oko", "you are a fucking idiot", "sh1t radio", "zabij się", "kill yourself", "ty debilu",
    "co za suka", "pizda",
])
def test_abuse_is_rejected_with_friendly_polish_message(text):
    result = moderate(text)
    assert not result.ok
    assert result.reason == "abuse"
    assert "AmbiRadio" in result.message


@pytest.mark.parametrize("text", [
    "Ania z Krakowa pozdrawia Kubę!",
    "Kupiłam nową sukienkę i słucham was w pracy",
    "Moje bilety na koncert już są, pozdrawiam",
    "Duch ujawnił się w muzyce, piękne",
    "Pedałuję rowerem do pracy przy tej muzyce",
    "Czy możesz zagrać coś spokojniejszego na wieczór?",
    "Shitake z masłem i jazz, idealny wieczór",
])
def test_ordinary_polish_is_not_a_false_positive(text):
    assert moderate(text).ok, text
    assert not contains_abuse(text)


def test_links_emails_phones_and_handles_are_stripped():
    raw = "Wpadnij na www.spam.pl albo https://x.io/a, pisz na jan@kowalski.pl lub +48 600 100 200, @mojkanal i pozdrawiam Olę"
    result = moderate(raw)
    assert result.ok
    for leaked in ("spam.pl", "x.io", "@", "600", "mojkanal"):
        assert leaked not in result.text
    assert "pozdrawiam Olę" in result.text
    assert set(result.removed) >= {"link", "email", "phone"}


def test_only_a_link_is_rejected_as_spam():
    result = moderate("https://kasyno.example.com")
    assert not result.ok and result.reason == "spam"


def test_spam_words_rejected():
    assert moderate("Zarabiaj na krypto od dziś").reason == "spam"


def test_empty_and_whitespace_rejected_unless_allowed():
    assert moderate("   ").reason == "empty"
    assert moderate("  ", allow_empty=True).ok


def test_length_cap_cuts_on_word_boundary_and_strips_emoji_and_markup():
    result = moderate("<b>Hej</b> " + "słowo " * 100 + "\U0001F600", max_len=50)
    assert result.ok
    assert len(result.text) <= 50
    assert "<" not in result.text and "\U0001F600" not in result.text
    assert not result.text.endswith(" ")


def test_moderate_many_returns_first_rejection():
    cleaned, rejected = moderate_many({"to_name": "Ola", "from_name": "Wojtek", "message": "miłego dnia"})
    assert rejected is None and cleaned == {"to_name": "Ola", "from_name": "Wojtek", "message": "miłego dnia"}
    _, rejected = moderate_many({"to_name": "Ola", "from_name": "chuj", "message": ""})
    assert rejected is not None and rejected.reason == "abuse"


def test_llm_second_opinion_is_cached_and_fails_open():
    calls: list[str] = []

    async def gen(prompt: str, feature: str) -> str:
        calls.append(feature)
        return '{"ok": false, "score": 2}' if "Głosujcie" in prompt else '{"ok": true, "score": 8}'

    llm = LLMModerator(gen)
    ok, score = asyncio.run(llm.review("Fajna muzyka dziś"))
    assert ok and score == pytest.approx(0.8)
    asyncio.run(llm.review("Fajna muzyka dziś"))
    assert calls == ["moderation"]  # cached

    result, _ = asyncio.run(moderate_with_llm("Głosujcie na mojego polityka", llm))
    assert not result.ok and result.reason == "llm"

    async def broken(prompt: str, feature: str) -> str:
        raise RuntimeError("quota")

    result, score = asyncio.run(moderate_with_llm("Pozdrawiam ze Szczecina", LLMModerator(broken)))
    assert result.ok and score is None


def test_word_list_runs_before_llm():
    async def gen(prompt: str, feature: str) -> str:
        raise AssertionError("LLM must not see abusive text")

    result, _ = asyncio.run(moderate_with_llm("kurwa", LLMModerator(gen)))
    assert not result.ok


def _client(router):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient

    app = FastAPI()
    app.include_router(router)
    return TestClient(app)


def test_dedications_use_moderation(tmp_path):
    from app.dedications import build_dedications_router

    async def speak(text: str, voice: str, style: str = "") -> bytes:
        return b"RIFF" + b"\x00" * 60

    client = _client(build_dedications_router(speak, tmp_path, tmp_path / "d.db", lambda sid: {"id": sid, "name": "Ambi Groove"}))
    bad = client.post("/radio-api/dedications", json={"station_id": "dos-groove", "to_name": "Ola", "from_name": "Wojtek", "message": "ty kurwo"})
    assert bad.status_code == 400 and "AmbiRadio" in bad.json()["detail"]
    ok = client.post("/radio-api/dedications", json={"station_id": "dos-groove", "to_name": "Ola", "from_name": "Wojtek", "message": "Zadzwoń 600 100 200 miłego dnia"})
    assert ok.status_code == 201
    body = ok.json()
    assert "600" not in body["message"] and "miłego dnia" in body["message"]
    assert "AmbiRadio" in body["script"] and "DOS Radio" not in body["script"]


def test_custom_radio_names_use_moderation(tmp_path):
    from app.custom_radios import CustomRadioService, build_custom_radios_router
    from app.db import Database

    client = _client(build_custom_radios_router(CustomRadioService(Database(tmp_path / "c.db"))))
    bad = client.post("/radio-api/custom-radios", json={"name": "Radio Chuja"})
    assert bad.status_code == 400
    ok = client.post("/radio-api/custom-radios", json={"name": "Moje radio www.spam.pl", "creator_name": "Ola"})
    assert ok.status_code == 200
    assert ok.json()["radio"]["name"] == "Moje radio"
