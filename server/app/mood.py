"""A listener's mood, recorded live and served 30 seconds behind the recording.

One Lyria session runs until the listener leaves. Audio is cut into parts of PART_SECONDS so a single
file never grows without a bound, and a part is playable only after BUFFER_SECONDS of it exist, which
is the delay the listener hears.
"""
from __future__ import annotations

import asyncio
import base64
import json
import time
import uuid

import websockets

from .recorder import BYTES_PER_SECOND, LYRIA_URL, encode_pcm_to_opus

PART_SECONDS = 600
BUFFER_SECONDS = 30
BUFFER_BYTES = BUFFER_SECONDS * BYTES_PER_SECOND
PART_BYTES = PART_SECONDS * BYTES_PER_SECOND


class MoodSession:
    def __init__(self, prompt: str) -> None:
        self.prompt = prompt
        self.parts: list[bytearray] = [bytearray()]
        self.started_at = time.time()
        self.task: asyncio.Task | None = None

    def feed(self, pcm: bytes) -> None:
        pending = pcm
        while pending:
            current = self.parts[-1]
            room = PART_BYTES - len(current)
            current.extend(pending[:room])
            pending = pending[room:]
            if pending:
                self.parts.append(bytearray())

    def seconds_recorded(self) -> float:
        return sum(len(part) for part in self.parts) / BYTES_PER_SECOND

    def part_ogg(self, number: int) -> bytes | None:
        """1-based part number. None until the 30-second buffer of that part has been recorded."""
        if number < 1 or number > len(self.parts):
            return None
        part = self.parts[number - 1]
        if len(part) < BUFFER_BYTES:
            return None
        return encode_pcm_to_opus(bytes(part))


class MoodRecorder:
    def __init__(self, api_key: str) -> None:
        self.api_key = api_key
        self.sessions: dict[str, MoodSession] = {}

    def start(self, prompt: str) -> str:
        mood_id = f"mood-{uuid.uuid4().hex[:12]}"
        self.sessions[mood_id] = MoodSession(prompt)
        return mood_id

    def session(self, mood_id: str) -> MoodSession | None:
        return self.sessions.get(mood_id)

    async def record(self, mood_id: str) -> None:
        session = self.sessions[mood_id]
        url = LYRIA_URL + self.api_key
        async with websockets.connect(url, max_size=None, open_timeout=20) as ws:
            await ws.send(json.dumps({"setup": {"model": "models/lyria-realtime-exp"}}))
            await ws.send(json.dumps({"clientContent": {"weightedPrompts": [
                {"text": session.prompt, "weight": 1.3},
            ]}}))
            await ws.send(json.dumps({"playbackControl": "PLAY"}))
            while True:
                try:
                    raw = await ws.recv()
                except websockets.ConnectionClosed:
                    return
                message = json.loads(raw)
                for chunk in message.get("serverContent", {}).get("audioChunks", []):
                    session.feed(base64.b64decode(chunk["data"]))
