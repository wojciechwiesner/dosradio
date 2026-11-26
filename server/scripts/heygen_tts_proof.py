"""Runtime proof: real client, invalid Gemini key, real OpenRouter HeyGen call.

Usage (key comes from the environment, never printed):
    OPENROUTER_API_KEY=... python scripts/heygen_tts_proof.py OUT_DIR
Saves one Ania (Kore) and one Michal (Charon) WAV plus proof.log with the "tts served by" lines.
"""
from __future__ import annotations

import asyncio
import logging
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.gemini_client import build_gemini_client  # noqa: E402

LINES = {
    "ania-Kore": ("Kore", "Cześć, tu Ania. Witajcie w dzisiejszym odcinku, mamy dla was kilka ciekawych nowinek."),
    "michal-Charon": ("Charon", "A ja jestem Michał. Zaczynamy od najważniejszej wiadomości dnia, uważnie słuchajcie."),
}


async def main(out_dir: Path) -> None:
    out_dir.mkdir(parents=True, exist_ok=True)
    handler = logging.FileHandler(out_dir / "proof.log", mode="w", encoding="utf-8")
    handler.setFormatter(logging.Formatter("%(asctime)s %(name)s %(levelname)s %(message)s"))
    logging.basicConfig(level=logging.INFO, handlers=[handler, logging.StreamHandler()])
    client = build_gemini_client("INVALID-KEY-FOR-PROOF", "gemini-news", "gemini-tts")
    for name, (voice, text) in LINES.items():
        wav = await client.speak(text, voice)
        (out_dir / f"{name}.wav").write_bytes(wav)
        print(f"{name}: {len(wav)} bytes, served by {client.last_tts_model}")
    await client.http.aclose()


if __name__ == "__main__":
    asyncio.run(main(Path(sys.argv[1])))
