"""Duet podcast generator (DOS Radio Plus): NotebookLM-style two-host Polish conversation.

Gemini (gemini-3.8-flash) writes the dialogue, the existing TTS pipeline voices each
turn with two distinct voices, and music breaks are copied out of the station archive
so cached episodes keep playing after archive rotation. One episode per topic per day
is generated and cached under data/podcasts/<episode_id>/.
"""
from __future__ import annotations

import json
import logging
import random
import re
import shutil
import time
from datetime import date
from pathlib import Path

from .archive import ArchiveRegistry
from .bumpers import Runner, make_voiced_bumper, subprocess_runner
from .news import GeminiClient

log = logging.getLogger("dosradio.podcast")

MAX_EPISODES_KEPT = 30
MIN_TURNS = 4
MUSIC_SEGMENTS_PER_BREAK = (4, 6)  # 30 s each -> 2-3 minute music interludes
MANIFEST_VERSION = 2  # v2 = episodes with radio bumpers; older cached episodes regenerate

# Two distinct Polish-speaking hosts: warm curious lead and calm witty co-host.
PODCAST_HOSTS = (
    {"name": "Ania", "voice": "Kore", "style": "a warm, curious, upbeat Polish podcast host"},
    {"name": "Michał", "voice": "Charon", "style": "a calm, witty, grounded Polish podcast co-host"},
)
DEFAULT_TOPIC = "najciekawsze wydarzenia dnia ze świata technologii i sztucznej inteligencji"
BUMPER_TEXTS = {
    "break-out": "Gramy dalej. Przerwa muzyczna, lecimy.",
    "break-in": "Wracamy do rozmowy.",
    "outro": "To był podcast DOS Radio. Gramy dalej!",
}
_PART_NAME_RE = re.compile(r"^[vmbc]\d{2,4}\.(wav|opus)$")
_EPISODE_ID_RE = re.compile(r"^[a-z0-9-]+$")


def slugify(text: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")
    return slug[:40].rstrip("-")


def intro_bumper_text(title: str) -> str:
    return f"Rozmowy DOS Radio. {title}."


def build_podcast_prompt(topic: str, today: date) -> str:
    return "\n".join([
        f"Dzisiaj jest {today.isoformat()}. Przygotuj scenariusz podcastu w duecie po polsku (format NotebookLM Audio Overview).",
        f"Temat rozmowy: {topic}.",
        "Prowadzący: Ania (ciekawska, ciepła, zadaje pytania) i Michał (spokojny, konkretny, z lekkim humorem).",
        "Struktura: krótkie przywitanie w stylu „Rozmowy DOS Radio”, rozmowa w trzech częściach "
        "(wprowadzenie, szczegóły, wnioski i jedna praktyczna rzecz do zrobienia), krótkie pożegnanie.",
        "Zasady: 10-14 wypowiedzi na przemian, każda 2-4 zdania, naturalny mówiony język polski, "
        "nie wymyślaj faktów ani liczb, zero markdownu, zero emoji, bez list punktowanych.",
        'Zwróć WYŁĄCZNIE JSON: {"title":"...","turns":[{"speaker":0,"text":"..."},{"speaker":1,"text":"..."}]}',
        "gdzie speaker 0 to Ania, a 1 to Michał. Pomiń komentarze meta o muzyce czy przerwach.",
    ])


def parse_script(reply_text: str) -> tuple[str, list[dict]]:
    """Validate model output into (title, turns); raises ValueError when unusable."""
    start, end = reply_text.find("{"), reply_text.rfind("}")
    if start < 0 or end <= start:
        raise ValueError("podcast reply has no JSON object")
    parsed = json.loads(reply_text[start:end + 1])
    title = str(parsed.get("title") or "").strip()[:120] or "Rozmowy DOS Radio"
    turns: list[dict] = []
    speakers: set[int] = set()
    for item in parsed.get("turns", []):
        if not isinstance(item, dict):
            continue
        speaker, text = item.get("speaker"), str(item.get("text") or "").strip()
        if speaker in (0, 1) and len(text) >= 20:
            speakers.add(int(speaker))
            turns.append({"speaker": int(speaker), "text": text})
    if len(turns) < MIN_TURNS or speakers != {0, 1}:
        raise ValueError(f"podcast script unusable: {len(turns)} turns, speakers {speakers}")
    return title, turns


def split_into_sections(turns: list[dict], sections: int = 3) -> list[list[dict]]:
    """Cut the dialogue into consecutive sections; music breaks go between them."""
    size = max(1, len(turns) // sections)
    chunks = [turns[i:i + size] for i in range(0, len(turns), size)]
    while len(chunks) > sections:  # merge the tail remainder into the last section
        chunks[-2].extend(chunks.pop())
    return [chunk for chunk in chunks if chunk]


class PodcastService:
    def __init__(self, client: GeminiClient, podcasts_dir: Path, archives: ArchiveRegistry,
                 station_id: str = "dos-groove", run: Runner = subprocess_runner) -> None:
        self.client = client
        self.run = run
        self.archives = archives
        self.station_id = station_id
        self.dir = podcasts_dir
        self.dir.mkdir(parents=True, exist_ok=True)

    # --- episode cache -------------------------------------------------------
    def episode_id(self, topic: str | None) -> str:
        slug = slugify(topic) if topic and topic.strip() else slugify(DEFAULT_TOPIC)
        return f"{date.today():%Y-%m-%d}-{slug or 'dzien'}"

    def _dir_for(self, episode_id: str) -> Path:
        if not _EPISODE_ID_RE.match(episode_id):
            raise FileNotFoundError(episode_id)
        return self.dir / episode_id

    def load_manifest(self, episode_id: str) -> dict | None:
        path = self._dir_for(episode_id) / "manifest.json"
        if not path.exists():
            return None
        try:
            manifest = json.loads(path.read_text())
        except Exception as error:
            log.warning("manifest %s unreadable: %s", episode_id, error)
            return None
        if manifest.get("version", 1) < MANIFEST_VERSION:
            return None  # stale format: regenerate with bumpers
        return manifest

    def part_path(self, episode_id: str, file_name: str) -> Path:
        if not _PART_NAME_RE.match(file_name):
            raise FileNotFoundError(file_name)
        path = self._dir_for(episode_id) / file_name
        if not path.exists():
            raise FileNotFoundError(file_name)
        return path

    # --- generation ------------------------------------------------------------
    async def episode(self, topic: str | None, headlines: list[str] | None = None) -> dict:
        """Return a cached episode for (topic, today) or generate a fresh one."""
        episode_id = self.episode_id(topic)
        cached = self.load_manifest(episode_id)
        if cached is not None:
            return cached
        if topic and topic.strip():
            clean_topic = topic.strip()
        elif headlines:
            # No topic given: anchor the chat in today's top global headline.
            clean_topic = f"{DEFAULT_TOPIC}, zaczynając od: {headlines[0]}"
        else:
            clean_topic = DEFAULT_TOPIC
        workdir = self._dir_for(episode_id)
        if workdir.exists():  # leftover from a failed run
            shutil.rmtree(workdir, ignore_errors=True)
        workdir.mkdir(parents=True)
        try:
            manifest = await self._generate(episode_id, clean_topic, workdir)
        except Exception:
            shutil.rmtree(workdir, ignore_errors=True)
            raise
        self._evict_old_episodes()
        return manifest

    async def _generate(self, episode_id: str, topic: str, workdir: Path) -> dict:
        reply = await self.client.chat(build_podcast_prompt(topic, date.today()))
        title, turns = parse_script(reply)

        parts: list[dict] = []
        sections = split_into_sections(turns)
        music_runs = self._pick_music_runs(len(sections) - 1)
        turn_index = 0
        await self._add_bumper(parts, workdir, intro_bumper_text(title))
        for section_index, section in enumerate(sections):
            for turn in section:
                file_name = f"v{turn_index:02d}.wav"
                host = PODCAST_HOSTS[turn["speaker"]]
                try:
                    audio = await self.client.speak(turn["text"], host["voice"], host["style"])
                except Exception as error:
                    log.warning("podcast tts turn %d failed: %s", turn_index, error)
                    continue  # skip the turn; the conversation stays playable
                (workdir / file_name).write_bytes(audio)
                parts.append({"kind": "voice", "file": file_name, "speaker": turn["speaker"]})
                turn_index += 1
            if section_index < len(music_runs) and music_runs[section_index]:
                await self._add_bumper(parts, workdir, BUMPER_TEXTS["break-out"])
                for segment in music_runs[section_index]:
                    file_name = f"m{len(parts):02d}.opus"
                    shutil.copyfile(segment, workdir / file_name)
                    parts.append({"kind": "music", "file": file_name, "station": self.station_id})
                await self._add_bumper(parts, workdir, BUMPER_TEXTS["break-in"])
        await self._add_bumper(parts, workdir, BUMPER_TEXTS["outro"])

        if not any(part["kind"] == "voice" for part in parts):
            raise RuntimeError("podcast generation produced no voice parts")

        manifest = {
            "id": episode_id,
            "version": MANIFEST_VERSION,
            "topic": topic,
            "title": title,
            "station": self.station_id,
            "created_at": time.time(),
            "hosts": [host["name"] for host in PODCAST_HOSTS],
            "parts": [{"kind": part["kind"], "url": f"/radio-api/plus/podcast/{episode_id}/{part['file']}"}
                      for part in parts],
        }
        tmp = workdir / "manifest.json.tmp"
        tmp.write_text(json.dumps(manifest, ensure_ascii=False))
        tmp.replace(workdir / "manifest.json")
        log.info("podcast %s generated: %d parts", episode_id, len(parts))
        return manifest

    async def _add_bumper(self, parts: list[dict], workdir: Path, text: str) -> None:
        """Voice a short host line over a music bed; a failed bumper never breaks the episode."""
        host = PODCAST_HOSTS[0]
        file_name = f"b{len(parts):02d}.opus"

        async def speak(line: str) -> bytes:
            return await self.client.speak(line, host["voice"], host["style"])

        try:
            await make_voiced_bumper(speak, self.run, text, self._random_segment(), workdir / file_name)
        except Exception as error:
            log.warning("podcast bumper %r skipped: %s", text, error)
            return
        parts.append({"kind": "bumper", "file": file_name})

    def _random_segment(self) -> Path | None:
        segments = self.archives.get(self.station_id).list_segments()
        return random.choice(segments) if segments else None

    def _pick_music_runs(self, breaks: int) -> list[list[Path]]:
        """One run of consecutive archive segments per break -> continuous 2-3 min of music."""
        if breaks <= 0:
            return []
        archive = self.archives.get(self.station_id)
        segments = archive.list_segments()
        if not segments:
            return [[] for _ in range(breaks)]
        runs: list[list[Path]] = []
        for _ in range(breaks):
            length = random.randint(*MUSIC_SEGMENTS_PER_BREAK)
            start = random.randint(0, max(0, len(segments) - length))
            runs.append(segments[start:start + length])
        return runs

    def _evict_old_episodes(self) -> None:
        episodes = sorted(self.dir.iterdir(), key=lambda p: p.stat().st_mtime, reverse=True)
        for old in episodes[MAX_EPISODES_KEPT:]:
            shutil.rmtree(old, ignore_errors=True)
