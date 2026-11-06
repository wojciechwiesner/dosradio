"""Job queue and cache for YouTube pills: one pipeline at a time, one cached result per video id."""
from __future__ import annotations

import asyncio
import json
import logging
import random
import re
import secrets
import shutil
import tempfile
from pathlib import Path

from .archive import ArchiveRegistry
from .bumpers import Runner, subprocess_runner
from .news import GeminiClient
from .podcast import PODCAST_HOSTS
from .youtube_pill import (
    NO_SUBTITLES_MESSAGE, PillError, build_parts, download_audio, extract_video_id, fetch_metadata,
    fetch_subtitles, parse_vtt, select_segments, validate_url,
)

log = logging.getLogger("dosradio.pill")

MAX_PILLS_KEPT = 30
MAX_JOBS_REMEMBERED = 50
GENERIC_ERROR = "Nie udało się zrobić pigułki. Spróbuj ponownie za chwilę."
_PART_NAME_RE = re.compile(r"^[vbc]\d{2,4}\.(wav|opus)$")
_VIDEO_DIR_RE = re.compile(r"^[A-Za-z0-9_-]{11}$")


class PillService:
    def __init__(self, client: GeminiClient, pills_dir: Path, archives: ArchiveRegistry,
                 station_id: str = "dos-groove", run: Runner = subprocess_runner) -> None:
        self.client = client
        self.archives = archives
        self.station_id = station_id
        self.run = run
        self.dir = pills_dir
        self.dir.mkdir(parents=True, exist_ok=True)
        self.jobs: dict[str, dict] = {}
        self._lock = asyncio.Lock()  # one pipeline at a time

    # --- cache -------------------------------------------------------------------------
    def load_manifest(self, video_id: str) -> dict | None:
        if not _VIDEO_DIR_RE.match(video_id):
            return None
        path = self.dir / video_id / "manifest.json"
        try:
            return json.loads(path.read_text())
        except (OSError, ValueError):
            return None

    def part_path(self, video_id: str, file_name: str) -> Path:
        if not _VIDEO_DIR_RE.match(video_id) or not _PART_NAME_RE.match(file_name):
            raise FileNotFoundError(file_name)
        path = self.dir / video_id / file_name
        if not path.exists():
            raise FileNotFoundError(file_name)
        return path

    # --- jobs ----------------------------------------------------------------------------
    def submit(self, url: str) -> dict:
        """Register a job; cached direct links are ready at once, the rest needs `process`."""
        clean_url = validate_url(url)
        job = {"id": secrets.token_hex(8), "status": "queued", "url": clean_url, "title": "", "author": "",
               "source_url": clean_url, "parts": [], "error": ""}
        video_id = extract_video_id(clean_url)
        cached = self.load_manifest(video_id) if video_id else None
        if cached:
            job.update(status="ready", **{key: cached[key] for key in ("title", "author", "source_url", "parts")})
        self.jobs[job["id"]] = job
        while len(self.jobs) > MAX_JOBS_REMEMBERED:
            self.jobs.pop(next(iter(self.jobs)))
        return job

    def get(self, job_id: str) -> dict | None:
        """A remembered job, or (after a restart) a cached pill addressed by its video id."""
        job = self.jobs.get(job_id)
        if job is not None:
            return job
        cached = self.load_manifest(job_id)
        if cached is None:
            return None
        return {"id": job_id, "status": "ready", "error": "",
                **{key: cached[key] for key in ("title", "author", "source_url", "parts")}}

    async def process(self, job_id: str) -> None:
        job = self.jobs.get(job_id)
        if job is None or job["status"] != "queued":
            return
        async with self._lock:
            job["status"] = "working"
            try:
                await self._run_pipeline(job)
                job["status"] = "ready"
            except PillError as error:
                job.update(status="error", error=str(error))
            except Exception as error:
                log.warning("pill %s failed: %s: %s", job_id, type(error).__name__, error)
                job.update(status="error", error=GENERIC_ERROR)

    # --- pipeline ------------------------------------------------------------------------
    async def _run_pipeline(self, job: dict) -> None:
        meta = await asyncio.to_thread(fetch_metadata, self.run, job["url"])
        job.update(title=meta["title"], author=meta["author"], source_url=meta["source_url"])
        video_id = meta["video_id"]
        cached = self.load_manifest(video_id)
        if cached:
            job["parts"] = cached["parts"]
            return
        with tempfile.TemporaryDirectory(prefix="pill-") as scratch:
            work = Path(scratch)
            vtt = await asyncio.to_thread(fetch_subtitles, self.run, meta["source_url"], work)
            cues = parse_vtt(vtt) if vtt else []
            if not cues:
                raise PillError(NO_SUBTITLES_MESSAGE)
            segments = await select_segments(self.client.chat, meta["title"], cues, meta["duration"])
            source = await asyncio.to_thread(download_audio, self.run, meta["source_url"], work)
            out_dir = self.dir / video_id
            shutil.rmtree(out_dir, ignore_errors=True)
            out_dir.mkdir(parents=True)
            try:
                parts = await build_parts(self._speak, self.run, out_dir, source, meta, segments, self._random_segment())
            except Exception:
                shutil.rmtree(out_dir, ignore_errors=True)
                raise
        manifest = {
            "id": video_id, "title": meta["title"], "author": meta["author"], "source_url": meta["source_url"],
            "parts": [{"kind": part["kind"], "url": f"/radio-api/plus/pill/{video_id}/{part['file']}"} for part in parts],
        }
        tmp = out_dir / "manifest.json.tmp"
        tmp.write_text(json.dumps(manifest, ensure_ascii=False))
        tmp.replace(out_dir / "manifest.json")
        job["parts"] = manifest["parts"]
        self._evict_old()
        log.info("pill %s ready: %d parts", video_id, len(parts))

    async def _speak(self, text: str) -> bytes:
        host = PODCAST_HOSTS[0]
        return await self.client.speak(text, host["voice"], host["style"])

    def _random_segment(self) -> Path | None:
        segments = self.archives.get(self.station_id).list_segments()
        return random.choice(segments) if segments else None

    def _evict_old(self) -> None:
        pills = sorted(self.dir.iterdir(), key=lambda path: path.stat().st_mtime, reverse=True)
        for old in pills[MAX_PILLS_KEPT:]:
            shutil.rmtree(old, ignore_errors=True)
