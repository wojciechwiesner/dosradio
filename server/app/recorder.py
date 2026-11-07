"""Background worker that records Lyria RealTime into 30-second Opus segments.

Maintains 1 session at a time (stays safely within Google's 8-10 session quota).
Rotates between configured stations to fill each up to 100 hours.
Encodes raw PCM (48kHz, 16-bit stereo) on the fly via ffmpeg to libopus 96kbps.
"""
from __future__ import annotations

import asyncio
import base64
import json
import logging
import random
import subprocess
from pathlib import Path

import websockets

from .archive import ArchiveRegistry, TARGET_SEGMENT_SECONDS
from .tone_clean import tone_notch_chain

log = logging.getLogger("dosradio.recorder")
LYRIA_URL = "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateMusic?key="
BYTES_PER_SECOND = 48000 * 2 * 2  # 48kHz, 16-bit, stereo = 192,000 bytes/sec
TARGET_CHUNK_BYTES = int(TARGET_SEGMENT_SECONDS * BYTES_PER_SECOND)
SEGMENTS_PER_SESSION = 2  # Lyria drifts into a steady whine after roughly a minute
BASE_TEMPERATURE = 1.0
TEMPERATURE_JITTER = 0.05

# Prompt dictionary matching src/radio/stations.ts (14 stations)
STATION_SPECS: dict[str, dict] = {
    "dos-groove": {
        "prompt": "minimal deep tech groove, soft dub chords, steady four-on-the-floor kick, focused work music, instrumental",
        "bpm": 122, "density": 0.45, "brightness": 0.45,
    },
    "poranna-kawa": {
        "prompt": "bright uplifting deep house, warm chords, crisp hi-hats, sunny morning groove, instrumental",
        "bpm": 120, "density": 0.55, "brightness": 0.65,
    },
    "lofi-nauka": {
        "prompt": "lo-fi hip hop beat, dusty vinyl crackle, mellow jazzy piano chords, soft boom bap drums, study music, instrumental",
        "bpm": 82, "density": 0.40, "brightness": 0.35,
    },
    "minimal-techno": {
        "prompt": "hypnotic minimal techno, rolling sub bass, tight percussion, subtle dub stabs, deep club groove, instrumental",
        "bpm": 126, "density": 0.55, "brightness": 0.40,
    },
    "trip-hop": {
        "prompt": "trip-hop downtempo, dusty vinyl drums, deep sub bass, moody Rhodes, late evening, instrumental",
        "bpm": 92, "density": 0.40, "brightness": 0.30,
    },
    "nocny-dub": {
        "prompt": "ambient dub, sparse soft percussion, deep warm pads, night drive, instrumental",
        "bpm": 84, "density": 0.25, "brightness": 0.20,
    },
    # New requested stations:
    "liquid-dnb": {
        "prompt": "liquid drum and bass, rolling atmospheric breakbeat, warm deep sub bass, lush soulful pads, smooth liquid vibes, instrumental",
        "bpm": 174, "density": 0.60, "brightness": 0.55,
    },
    "deep-ambient": {
        "prompt": "pure deep ambient soundscape, weightless evolving drone, warm tape texture, gentle meditative space, floating modular chords, instrumental",
        "bpm": 60, "density": 0.20, "brightness": 0.25,
    },
    "micro-house": {
        "prompt": "microhouse, intricate Romanian minimal groove, subtle clicking percussion, delicate warm dub chords, hypnotic low-end roll, instrumental",
        "bpm": 124, "density": 0.50, "brightness": 0.40,
    },
    "raw-techno": {
        "prompt": "heavy driving raw techno, dark industrial warehouse groove, thunderous kick, metallic percussion, hypnotic modular rumble, instrumental",
        "bpm": 134, "density": 0.70, "brightness": 0.40,
    },
    "club-dance": {
        "prompt": "energetic club dance, pumping modern tech house groove, tight groovy bassline, crisp snappy claps, euphoric uplifting vibe, instrumental",
        "bpm": 128, "density": 0.65, "brightness": 0.65,
    },
    "warm-jazz": {
        "prompt": "smooth night jazz lounge, soft brushed drums, acoustic upright bass, mellow Fender Rhodes chords, warm gentle trumpet nuances, instrumental",
        "bpm": 86, "density": 0.45, "brightness": 0.40,
    },
    "stoa": {
        "prompt": "calm contemplative neoclassical ambient, slow solo cello and soft felt piano, warm string drones, sparse and dignified, reflective stoic mood, instrumental",
        "bpm": 66, "density": 0.25, "brightness": 0.3,
    },
    "groove-funk": {
        "prompt": "infectious neo funk groove, bouncy slap bassline, tight rhythm guitar chops, warm vintage clavinet, upbeat soulful strut, instrumental",
        "bpm": 112, "density": 0.65, "brightness": 0.60,
    },
}


def session_temperature() -> float:
    """Slightly different temperature per Lyria session, so consecutive sessions do not sound cloned."""
    jitter = round(random.uniform(-TEMPERATURE_JITTER, TEMPERATURE_JITTER), 3)
    jitter = max(-TEMPERATURE_JITTER, min(TEMPERATURE_JITTER, jitter))  # rounding must not leave the band
    return BASE_TEMPERATURE + jitter


def encode_pcm_to_opus(pcm_bytes: bytes, rate: int = 48000, channels: int = 2, bitrate: str = "96k") -> bytes:
    """Encode raw interleaved PCM (s16le) to OGG/Opus using ffmpeg, notching steady tones first."""
    notches = tone_notch_chain(pcm_bytes, channels, rate)
    cmd = [
        "ffmpeg", "-hide_banner", "-loglevel", "error",
        "-f", "s16le", "-ar", str(rate), "-ac", str(channels),
        "-i", "pipe:0",
    ]
    if notches:
        cmd += ["-af", notches]
    cmd += [
        "-c:a", "libopus", "-b:a", bitrate, "-vbr", "on",
        "-f", "ogg", "pipe:1",
    ]
    proc = subprocess.Popen(cmd, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    stdout, stderr = proc.communicate(pcm_bytes)
    if proc.returncode != 0 or not stdout:
        raise RuntimeError(f"ffmpeg failed (exit {proc.returncode}): {stderr.decode()[:200]}")
    return stdout


class StationRecorder:
    def __init__(self, api_key: str, archives: ArchiveRegistry) -> None:
        self.api_key = api_key
        self.archives = archives
        self.running = False
        self.current_station: str | None = None
        self.total_recorded_segments = 0

    def pick_station_to_record(self) -> str:
        """Prioritise stations with the fewest recorded segments."""
        stats = []
        for sid in STATION_SPECS:
            arch = self.archives.get(sid)
            stats.append((len(arch.list_segments()), sid))
        stats.sort()
        return stats[0][1]

    async def record_loop(self) -> None:
        self.running = True
        log.info("Starting DOS Radio recorder loop with %d stations", len(STATION_SPECS))
        while self.running:
            station_id = self.pick_station_to_record()
            self.current_station = station_id
            spec = STATION_SPECS[station_id]
            log.info("Recording station %s (prompt: %s...)", station_id, spec["prompt"][:40])
            try:
                await self.record_session(station_id, spec)
            except Exception as error:
                log.warning("Recorder session for %s failed: %s; backing off 10s", station_id, error)
                await asyncio.sleep(10)
            await asyncio.sleep(2)

    async def record_session(self, station_id: str, spec: dict, num_segments: int = SEGMENTS_PER_SESSION) -> None:
        arch = self.archives.get(station_id)
        url = LYRIA_URL + self.api_key
        async with websockets.connect(url, max_size=None, open_timeout=20) as ws:
            await ws.send(json.dumps({"setup": {"model": "models/lyria-realtime-exp"}}))
            await ws.send(json.dumps({"clientContent": {"weightedPrompts": [
                {"text": spec["prompt"], "weight": 1.3},
                {"text": "vocals, singing, harsh noise, distortion", "weight": 0.25},
            ]}}))
            await ws.send(json.dumps({"musicGenerationConfig": {
                "bpm": spec["bpm"],
                "density": spec["density"],
                "brightness": spec["brightness"],
                "guidance": 4.0,
                "temperature": session_temperature(),
            }}))
            await ws.send(json.dumps({"playbackControl": "PLAY"}))

            pcm_buffer = bytearray()
            segments_saved = 0
            while segments_saved < num_segments and self.running:
                try:
                    raw = await asyncio.wait_for(ws.recv(), timeout=25)
                except asyncio.TimeoutError:
                    log.warning("Timeout waiting for Lyria chunk")
                    break
                msg = json.loads(raw)
                for chunk in msg.get("serverContent", {}).get("audioChunks", []):
                    pcm_buffer.extend(base64.b64decode(chunk["data"]))
                    if len(pcm_buffer) >= TARGET_CHUNK_BYTES:
                        slice_bytes = bytes(pcm_buffer[:TARGET_CHUNK_BYTES])
                        del pcm_buffer[:TARGET_CHUNK_BYTES]
                        # Encode to Opus off the event loop
                        opus_data = await asyncio.to_thread(encode_pcm_to_opus, slice_bytes)
                        arch.add_segment(opus_data, is_live=True)
                        segments_saved += 1
                        self.total_recorded_segments += 1
                        log.info("[%s] Saved segment #%d (total %s: %.2f h)",
                                 station_id, segments_saved, station_id, arch.total_hours())
