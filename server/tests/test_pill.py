"""YouTube pill tests: url rules, VTT parsing, segment snapping, and the full job flow with fake yt-dlp/ffmpeg/Gemini."""
from __future__ import annotations

import json
from pathlib import Path

import pytest
from test_plus import TINY_WAV, client, plus_client  # noqa: F401  (shared fixtures)

from app.youtube_pill import (
    Cue, PillError, extract_video_id, fetch_metadata, parse_selection, parse_vtt, snap_window, validate_url,
)

VIDEO_ID = "dQw4w9WgXcQ"
WATCH_URL = f"https://www.youtube.com/watch?v={VIDEO_ID}"

AUTO_VTT = """WEBVTT
Kind: captions
Language: pl

00:00:01.000 --> 00:00:03.000 align:start position:0%
Dzisiaj mówimy<00:00:01.500><c> o snie</c>

00:00:03.000 --> 00:00:03.010 align:start position:0%
Dzisiaj mówimy o snie

00:00:03.010 --> 00:00:05.000 align:start position:0%
Dzisiaj mówimy o snie
i produktywności

00:01:05.000 --> 00:01:08.500
Ostatnie zdanie.
"""


def make_cues(seconds: int = 600, step: int = 5) -> list[Cue]:
    return [Cue(float(start), float(start + step), f"zdanie {start}") for start in range(0, seconds, step)]


def cues_vtt(seconds: int = 600, step: int = 5) -> str:
    def stamp(value: int) -> str:
        return f"{value // 3600:02d}:{value % 3600 // 60:02d}:{value % 60:02d}.000"
    blocks = [f"{stamp(int(c.start))} --> {stamp(int(c.end))}\n{c.text}" for c in make_cues(seconds, step)]
    return "WEBVTT\n\n" + "\n\n".join(blocks) + "\n"


# --- pure helpers ---------------------------------------------------------------------------

def test_validate_url_accepts_only_youtube():
    assert validate_url(f" {WATCH_URL} ") == WATCH_URL
    assert validate_url(f"https://youtu.be/{VIDEO_ID}")
    for bad in ("https://evil.example/watch?v=x", "ftp://youtube.com/x", "file:///etc/passwd", "nie url",
                "https://youtube.com.evil.io/watch"):
        with pytest.raises(PillError):
            validate_url(bad)


def test_extract_video_id_handles_direct_links_and_channels():
    assert extract_video_id(WATCH_URL) == VIDEO_ID
    assert extract_video_id(f"https://youtu.be/{VIDEO_ID}?t=3") == VIDEO_ID
    assert extract_video_id(f"https://www.youtube.com/shorts/{VIDEO_ID}") == VIDEO_ID
    assert extract_video_id("https://www.youtube.com/@kanal") is None
    assert extract_video_id("https://www.youtube.com/watch?v=short") is None


def test_parse_vtt_strips_markup_and_rolling_duplicates():
    cues = parse_vtt(AUTO_VTT)
    assert [cue.text for cue in cues] == ["Dzisiaj mówimy o snie", "i produktywności", "Ostatnie zdanie."]
    assert cues[0].start == 1.0 and cues[2].end == 68.5


def test_snap_window_lands_on_cue_boundaries_within_limits():
    cues = make_cues()
    start, end = snap_window(61.0, 400.0, cues, 600.0)  # too long: capped at 120 s
    assert start == 60.0 and end == 180.0
    start, end = snap_window(101.0, 105.0, cues, 600.0)  # too short: stretched to 20 s
    assert start == 100.0 and end == 120.0


def test_parse_selection_orders_drops_overlaps_and_respects_budget():
    cues = make_cues()
    reply = json.dumps({"segments": [
        {"start": 300, "end": 360, "summary": "Drugi."},
        {"start": 60, "end": 130, "summary": "Pierwszy."},
        {"start": 100, "end": 160, "summary": "Nakłada się."},
        {"start": 400, "end": 520, "summary": "Za dużo."},
    ]})
    segments = parse_selection(f"```json\n{reply}\n```", cues, 600.0)
    assert [segment.summary for segment in segments] == ["Pierwszy.", "Drugi."]
    assert segments[0].start == 60.0 and segments[1].start == 300.0
    with pytest.raises(ValueError):
        parse_selection("brak json", cues, 600.0)
    with pytest.raises(ValueError):
        parse_selection('{"segments": []}', cues, 600.0)


def test_fetch_metadata_direct_channel_and_limits():
    calls: list[list[str]] = []

    def run(args, timeout):
        calls.append(args)
        if "--flat-playlist" in args:
            return json.dumps({"entries": [{"id": VIDEO_ID}]})
        return json.dumps({"id": VIDEO_ID, "title": "Tytuł", "channel": "Kanał", "duration": 900,
                           "webpage_url": WATCH_URL})

    direct = fetch_metadata(run, WATCH_URL)
    assert direct["video_id"] == VIDEO_ID and direct["author"] == "Kanał" and len(calls) == 1

    calls.clear()
    channel = fetch_metadata(run, "https://www.youtube.com/@kanal")
    assert channel["video_id"] == VIDEO_ID and len(calls) == 2
    assert calls[0][-1] == "https://www.youtube.com/@kanal/videos"  # latest upload tab

    def too_long(args, timeout):
        return json.dumps({"id": VIDEO_ID, "title": "x", "duration": 3 * 3600 + 1})

    with pytest.raises(PillError):
        fetch_metadata(too_long, WATCH_URL)


# --- full flow ---------------------------------------------------------------------------------

class FakeTools:
    """Stands in for yt-dlp and ffmpeg; records every call, writes the files the real tools would."""

    def __init__(self, vtt: str | None = None, duration: int = 600) -> None:
        self.vtt, self.duration = vtt, duration
        self.calls: list[list[str]] = []

    def __call__(self, args: list[str], timeout: int) -> str:
        self.calls.append(args)
        assert timeout > 0
        if args[0] == "ffmpeg":
            Path(args[-1]).write_bytes(b"OPUS")
        elif "--dump-single-json" in args:
            return json.dumps({"id": VIDEO_ID, "title": "Sen i produktywność", "channel": "Kanał Testowy",
                               "duration": self.duration, "webpage_url": WATCH_URL})
        elif "--write-subs" in args:
            if self.vtt is not None:
                (Path(args[args.index("-o") + 1]).parent / "subs.pl.vtt").write_text(self.vtt)
        elif "bestaudio" in args:
            (Path(args[args.index("-o") + 1]).parent / "source.webm").write_bytes(b"AUDIO")
        return ""

    def count(self, program: str) -> int:
        return sum(1 for args in self.calls if args[0] == program)


@pytest.fixture()
def pill_env(plus_client, monkeypatch):
    from app.main import gemini, podcasts
    spoken: list[str] = []

    async def fake_chat(prompt: str) -> str:
        return json.dumps({"segments": [
            {"start": 60, "end": 130, "summary": "Najpierw o rytmie dobowym."},
            {"start": 300, "end": 360, "summary": "Potem o kofeinie."},
        ]})

    async def fake_speak(text: str, voice: str, style: str = "") -> bytes:
        spoken.append(text)
        return TINY_WAV

    monkeypatch.setattr(gemini, "chat", fake_chat)
    monkeypatch.setattr(gemini, "speak", fake_speak)
    tools = FakeTools(vtt=cues_vtt())
    monkeypatch.setattr(podcasts, "run", tools)
    return plus_client, tools, spoken


def test_pill_flow_builds_parts_serves_them_and_caches(pill_env):
    client, tools, spoken = pill_env
    created = client.post("/radio-api/plus/pill", json={"url": WATCH_URL})
    assert created.status_code == 200 and created.json()["status"] in ("queued", "ready", "working")
    pill_id = created.json()["id"]

    pill = client.get(f"/radio-api/plus/pill/{pill_id}").json()
    assert pill["status"] == "ready", pill
    assert pill["title"] == "Sen i produktywność" and pill["author"] == "Kanał Testowy"
    assert pill["source_url"] == WATCH_URL and pill["error"] == ""
    assert [part["kind"] for part in pill["parts"]] == ["bumper", "voice", "clip", "voice", "clip", "bumper"]
    assert spoken[1:3] == ["Najpierw o rytmie dobowym.", "Potem o kofeinie."]
    assert "Sen i produktywność" in spoken[0]

    # Clips are cut at the exact (cue-snapped) boundaries chosen for the segments.
    cuts = [args for args in tools.calls if args[0] == "ffmpeg" and "-ss" in args]
    assert [(args[args.index("-ss") + 1], args[args.index("-t") + 1]) for args in cuts] == [
        ("60.00", "70.00"), ("300.00", "60.00")]

    for part in pill["parts"]:
        served = client.get(part["url"])
        assert served.status_code == 200 and served.content
    assert client.get(f"/radio-api/plus/pill/{VIDEO_ID}/../../etc/passwd").status_code in (400, 404)
    assert client.get(f"/radio-api/plus/pill/{VIDEO_ID}/x00.opus").status_code == 404

    # Same video again: served from the per-video cache, no external process, no new TTS.
    external_calls, spoken_before = len(tools.calls), len(spoken)
    again = client.post("/radio-api/plus/pill", json={"url": f"https://youtu.be/{VIDEO_ID}"}).json()
    assert again["status"] == "ready"
    assert len(tools.calls) == external_calls and len(spoken) == spoken_before
    assert client.get(f"/radio-api/plus/pill/{again['id']}").json()["parts"] == pill["parts"]
    # After a restart the pill is still addressable by its video id.
    assert client.get(f"/radio-api/plus/pill/{VIDEO_ID}").json()["status"] == "ready"


def test_pill_without_subtitles_reports_polish_error(pill_env):
    client, tools, _ = pill_env
    tools.vtt = None
    pill_id = client.post("/radio-api/plus/pill", json={"url": WATCH_URL}).json()["id"]
    pill = client.get(f"/radio-api/plus/pill/{pill_id}").json()
    assert pill["status"] == "error"
    assert pill["error"] == "Ten odcinek nie ma napisów, spróbuj innego."
    assert tools.count("ffmpeg") == 0  # nothing is downloaded or cut without a transcript


def test_pill_rejects_non_youtube_and_unknown_ids(pill_env):
    client, _, _ = pill_env
    assert client.post("/radio-api/plus/pill", json={"url": "https://evil.example/x"}).status_code == 422
    assert client.get("/radio-api/plus/pill/doesnotexist").status_code == 404


def test_pill_survives_failed_bumpers(pill_env, monkeypatch):
    client, tools, _ = pill_env
    original = tools.__call__

    def flaky(args, timeout):
        if args[0] == "ffmpeg" and "-filter_complex" in args or (args[0] == "ffmpeg" and "-af" in args and "-ss" not in args):
            raise RuntimeError("bumper mix failed")
        return original(args, timeout)

    from app.main import podcasts
    monkeypatch.setattr(podcasts, "run", flaky)
    pill_id = client.post("/radio-api/plus/pill", json={"url": WATCH_URL}).json()["id"]
    pill = client.get(f"/radio-api/plus/pill/{pill_id}").json()
    assert pill["status"] == "ready"
    assert [part["kind"] for part in pill["parts"]] == ["voice", "clip", "voice", "clip"]


def test_finished_pill_is_saved_on_the_account(pill_env):
    client, _, _ = pill_env
    assert client.get("/radio-api/plus/pills").json() == {"pills": []}
    pill_id = client.post("/radio-api/plus/pill", json={"url": WATCH_URL}).json()["id"]
    assert client.get(f"/radio-api/plus/pill/{pill_id}").json()["status"] == "ready"
    saved = client.get("/radio-api/plus/pills").json()["pills"]
    assert [p["id"] for p in saved] == [VIDEO_ID]
    assert saved[0]["title"] == "Sen i produktywność" and saved[0]["parts"]


def test_my_pills_is_plus_only(client):
    assert client.get("/radio-api/plus/pills").status_code in (401, 402)
