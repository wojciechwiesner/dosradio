"""Measure Lyria RealTime limits from the server: N parallel sessions, audio seconds received per wall second.

Usage: .venv/bin/python -m app.lyria_probe 1 4 8 16  (reads GEMINI_API_KEY from env)
"""
from __future__ import annotations

import asyncio
import base64
import json
import os
import sys
import time

import websockets

URL = "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateMusic?key="
BYTES_PER_SECOND = 48000 * 2 * 2  # 48 kHz, 16-bit, stereo


async def one_session(index: int, seconds: float) -> dict:
    result = {"index": index, "audio_s": 0.0, "error": None, "mime": None, "first_audio_s": None}
    started = time.time()
    try:
        async with websockets.connect(URL + os.environ["GEMINI_API_KEY"], max_size=None, open_timeout=20) as ws:
            await ws.send(json.dumps({"setup": {"model": "models/lyria-realtime-exp"}}))
            await ws.send(json.dumps({"clientContent": {"weightedPrompts": [
                {"text": "minimal deep tech groove, soft dub chords, instrumental", "weight": 1.0}]}}))
            await ws.send(json.dumps({"musicGenerationConfig": {"bpm": 122, "density": 0.45, "brightness": 0.45}}))
            await ws.send(json.dumps({"playbackControl": "PLAY"}))
            while time.time() - started < seconds:
                raw = await asyncio.wait_for(ws.recv(), timeout=30)
                message = json.loads(raw)
                if "filteredPrompt" in message or "warning" in message:
                    result["error"] = json.dumps(message)[:160]
                for chunk in message.get("serverContent", {}).get("audioChunks", []):
                    result["mime"] = chunk.get("mimeType")
                    if result["first_audio_s"] is None:
                        result["first_audio_s"] = round(time.time() - started, 2)
                    result["audio_s"] += len(base64.b64decode(chunk["data"])) / BYTES_PER_SECOND
    except Exception as error:
        result["error"] = f"{type(error).__name__}: {str(error)[:140]}"
    result["wall_s"] = round(time.time() - started, 1)
    result["audio_s"] = round(result["audio_s"], 1)
    return result


async def main(levels: list[int], seconds: float) -> None:
    for level in levels:
        results = await asyncio.gather(*(one_session(i, seconds) for i in range(level)))
        ok = [r for r in results if r["audio_s"] > 1 and not (r["error"] or "").startswith(("Invalid", "Connection"))]
        errors = sorted({r["error"] for r in results if r["error"]})
        speed = [round(r["audio_s"] / r["wall_s"], 2) for r in ok]
        print(json.dumps({"parallel": level, "ok": len(ok), "realtime_factor": speed[:6],
                          "first_audio_s": [r["first_audio_s"] for r in ok][:6], "mime": ok[0]["mime"] if ok else None,
                          "wall_s": [r["wall_s"] for r in results][:6], "audio_s": [r["audio_s"] for r in results][:6],
                          "errors": errors[:3]}), flush=True)
        await asyncio.sleep(3)


if __name__ == "__main__":
    asyncio.run(main([int(x) for x in sys.argv[1:]] or [1, 4], float(os.environ.get("PROBE_SECONDS", "40"))))
