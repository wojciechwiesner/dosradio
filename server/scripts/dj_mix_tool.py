#!/usr/bin/env python3
"""CLI DJ Mixing & 4-Band DSP Verification Tool for DOSRadio.

Renders BEFORE (legacy short pitch-shifted 2-band fade) vs AFTER (+/-12% Master-Tempo
WSOLA + Genre-Aware DJ Transition) WAV files and outputs deterministic 4-band spectral
telemetry (Sub <120Hz, Mid 120-2500Hz, Presence 2.5-6kHz, Air >6kHz, Kick-to-Mid ratio).
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import subprocess
import sys
import wave

import numpy as np

SERVER_ROOT = Path(__file__).resolve().parents[1]
if str(SERVER_ROOT) not in sys.path:
    sys.path.insert(0, str(SERVER_ROOT))

from app.dj_dsp import split_3band_isolator  # noqa: E402
from app.mixer import (  # noqa: E402
    CHANNELS,
    RATE,
    MixerConfig,
    _apply_ceiling,
    _crossfade,
    _extract_beat_chain,
    _first_steady_kick,
    _onsets_of,
    _resample_stereo,
    _split_bands,
    float_to_pcm,
    mix_with_report,
    pcm_to_float,
    steady_period,
)


def decode_audio(path: Path) -> np.ndarray:
    cmd = [
        "ffmpeg", "-hide_banner", "-loglevel", "error",
        "-i", str(path), "-f", "s16le", "-ar", str(RATE), "-ac", str(CHANNELS), "pipe:1",
    ]
    proc = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=30, check=True)
    return pcm_to_float(proc.stdout)


def write_wav(path: Path, audio: np.ndarray) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    pcm = float_to_pcm(audio)
    with wave.open(str(path), "wb") as wf:
        wf.setnchannels(CHANNELS)
        wf.setsampwidth(2)
        wf.setframerate(RATE)
        wf.writeframes(pcm)


def measure_bands(audio: np.ndarray) -> dict[str, float]:
    """Measure Sub (<150Hz), Mid (150-2500Hz), Presence (2500-6000Hz), Air (>6000Hz) & Kick/Mid crest."""
    if len(audio) == 0:
        return {"sub_db": -96.0, "mid_db": -96.0, "presence_db": -96.0, "air_db": -96.0, "sub_to_mid_db": 0.0, "peak_dbfs": -96.0}
    sub, mid, top = split_3band_isolator(audio, low_hz=150.0, high_hz=2500.0)
    _, _, air = split_3band_isolator(top, low_hz=2500.0, high_hz=6000.0)
    presence = top - air

    def _rms_db(sig: np.ndarray) -> float:
        rms = float(np.sqrt(np.mean(sig.astype(np.float64) ** 2)))
        return round(20.0 * np.log10(max(rms, 1e-6)), 2)

    sub_db = _rms_db(sub)
    mid_db = _rms_db(mid)
    pres_db = _rms_db(presence)
    air_db = _rms_db(air)
    peak_db = round(20.0 * np.log10(max(float(np.max(np.abs(audio))), 1e-6)), 2)
    return {
        "sub_db": sub_db,
        "mid_db": mid_db,
        "presence_db": pres_db,
        "air_db": air_db,
        "sub_to_mid_db": round(sub_db - mid_db, 2),
        "peak_dbfs": peak_db,
    }


def render_legacy_before(tail: np.ndarray, head: np.ndarray, context_s: float = 10.0) -> tuple[np.ndarray, dict]:
    """Reproduce the legacy pre-upgrade short 4-bar linear-resample 2-band crossfade for A/B comparison."""
    t_onsets = _onsets_of(tail, from_end=True)
    h_onsets = _onsets_of(head, from_end=False)
    t_per = steady_period(t_onsets)
    h_per = steady_period(h_onsets)

    if t_per is not None and h_per is not None and abs(t_per - h_per) <= 0.10 * min(t_per, h_per):
        t_chain = _extract_beat_chain(t_onsets, t_per)
        h_chain = _extract_beat_chain(h_onsets, h_per)
        hk = _first_steady_kick(h_chain, h_per) or 0.0
        fade = min(int(round(12 * t_per * RATE)), len(tail) // 3, len(head) // 3)
        t_cut = max(0, len(tail) - fade)
        h_cut = int(round(hk * RATE))
        h_need = min(len(head) - h_cut, int(round(12 * h_per * RATE)))
        h_warped = _resample_stereo(head[h_cut : h_cut + h_need], fade)
        t_sl = tail[t_cut : t_cut + fade]
        ceil = max(float(np.max(np.abs(t_sl))), float(np.max(np.abs(h_warped))), 1e-6)
        tl, th = _split_bands(t_sl)
        hl, hh = _split_bands(h_warped)
        sw = fade // 2
        lows = np.concatenate([tl[:sw], hl[sw:]], axis=0)
        highs = _crossfade(th, hh, equal_power=True)
        seam = _apply_ceiling(lows + highs, ceil)
        pre = tail[max(0, t_cut - int(context_s * RATE)) : t_cut]
        post = head[h_cut + h_need : h_cut + h_need + int(context_s * RATE)]
        excerpt = np.concatenate([pre, seam, post], axis=0)
        return excerpt, {"mode": "legacy_linear_resample_12beat", "overlap_seconds": round(fade / RATE, 2), **measure_bands(seam)}

    fade = min(int(4.5 * RATE), len(tail) // 3, len(head) // 3)
    seam = _crossfade(tail[-fade:], head[:fade], equal_power=True)
    pre = tail[max(0, len(tail) - fade - int(context_s * RATE)) : len(tail) - fade]
    post = head[fade : fade + int(context_s * RATE)]
    excerpt = np.concatenate([pre, seam, post], axis=0)
    return excerpt, {"mode": "legacy_short_fade", "overlap_seconds": round(fade / RATE, 2), **measure_bands(seam)}


def render_after_excerpt(
    tail: np.ndarray,
    head: np.ndarray,
    station_a: str,
    station_b: str,
    technique: str = "auto",
    beats: int = 48,
    context_s: float = 10.0,
) -> tuple[np.ndarray, dict]:
    cfg = MixerConfig(crossfade_beats=beats, fallback_fade_seconds=14.0, technique=technique)
    joined, rep = mix_with_report(tail, head, config=cfg, station_a=station_a, station_b=station_b)
    overlap_frames = int(round(rep.overlap_seconds * RATE))
    seam_start = max(0, len(tail) - overlap_frames - int(2 * RATE))
    seam_end = min(len(joined), seam_start + overlap_frames)
    seam = joined[seam_start:seam_end] if seam_end > seam_start else joined
    ctx = int(round(context_s * RATE))
    excerpt = joined[max(0, seam_start - ctx) : min(len(joined), seam_end + ctx)]
    return excerpt, {**rep.to_dict(), **measure_bands(seam)}


def main() -> int:
    ap = argparse.ArgumentParser(description="Render BEFORE/AFTER DJ transitions & 4-band DSP report")
    ap.add_argument("--deck-a", required=True, type=Path)
    ap.add_argument("--deck-b", required=True, type=Path)
    ap.add_argument("--station-a", default="berlin-bcco-techno")
    ap.add_argument("--station-b", default="hypnotic-techno")
    ap.add_argument("--technique", default="auto")
    ap.add_argument("--beats", type=int, default=48)
    ap.add_argument("--out-dir", required=True, type=Path)
    ap.add_argument("--prefix", default="mix")
    args = ap.parse_args()

    tail = decode_audio(args.deck_a)
    head = decode_audio(args.deck_b)

    before_wav, before_stats = render_legacy_before(tail, head)
    after_wav, after_stats = render_after_excerpt(
        tail, head, args.station_a, args.station_b, technique=args.technique, beats=args.beats
    )

    p_before = args.out_dir / f"{args.prefix}_before_legacy.wav"
    p_after = args.out_dir / f"{args.prefix}_after_dj_{after_stats.get('technique', 'auto')}.wav"
    write_wav(p_before, before_wav)
    write_wav(p_after, after_wav)

    summary = {
        "deck_a": str(args.deck_a),
        "deck_b": str(args.deck_b),
        "station_a": args.station_a,
        "station_b": args.station_b,
        "before_wav": str(p_before),
        "after_wav": str(p_after),
        "before": before_stats,
        "after": after_stats,
    }
    report_path = args.out_dir / f"{args.prefix}_dsp_report.json"
    report_path.write_text(json.dumps(summary, indent=2), encoding="utf-8")
    print(json.dumps(summary, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
