"""Remove steady tones from a station's archived segments, in place.

Originals move to <station>/originals/ and stay there until --purge-originals.
Run from server/: python -m scripts.clean_archive --root <archive root> --station <id> --dry-run
"""
from __future__ import annotations

import argparse
import shutil
import subprocess
from collections import Counter
from pathlib import Path

from app.recorder import encode_pcm_to_opus
from app.tone_clean import SAMPLE_RATE, detect_steady_tones, pcm_to_mono

ORIGINALS_DIR = "originals"
STEREO = 2
TOP_FREQUENCIES = 8


def decode_segment(path: Path) -> bytes:
    return subprocess.run(
        ["ffmpeg", "-v", "error", "-i", str(path), "-f", "s16le",
         "-ar", str(SAMPLE_RATE), "-ac", str(STEREO), "pipe:1"],
        capture_output=True, check=True,
    ).stdout


def find_tones(pcm: bytes) -> list[float]:
    return detect_steady_tones(pcm_to_mono(pcm, STEREO))


def rewrite_segment(path: Path, originals: Path, pcm: bytes) -> None:
    originals.mkdir(parents=True, exist_ok=True)
    backup = originals / path.name
    if not backup.exists():
        shutil.copy2(path, backup)
    tmp = path.with_suffix(".tmp")
    tmp.write_bytes(encode_pcm_to_opus(pcm))
    tmp.replace(path)


def purge_originals(originals: Path) -> None:
    if originals.exists():
        shutil.rmtree(originals)
    print(f"purged {originals}")


def clean_station(station_dir: Path, apply: bool) -> None:
    originals = station_dir / ORIGINALS_DIR
    segments = sorted(station_dir.glob("seg-*.opus"))
    dirty_count = 0
    still_dirty = 0
    frequencies: Counter[int] = Counter()
    for path in segments:
        pcm = decode_segment(path)
        tones = find_tones(pcm)
        if not tones:
            continue
        dirty_count += 1
        frequencies.update(round(freq) for freq in tones)
        if not apply:
            continue
        rewrite_segment(path, originals, pcm)
        if find_tones(decode_segment(path)):
            still_dirty += 1
    mode = "applied" if apply else "dry-run"
    print(f"{station_dir.name} [{mode}]: {dirty_count}/{len(segments)} segments carry a steady tone")
    if apply:
        print(f"  still steady after rewrite: {still_dirty}")
    for freq, count in frequencies.most_common(TOP_FREQUENCIES):
        print(f"  {freq} Hz: {count}")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--root", required=True, type=Path, help="archive root (settings.data_dir / archive)")
    parser.add_argument("--station", required=True)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--dry-run", action="store_true", help="count and report only")
    mode.add_argument("--apply", action="store_true", help="rewrite segments that carry a steady tone")
    mode.add_argument("--purge-originals", action="store_true", help="delete kept originals")
    args = parser.parse_args(argv)
    station_dir = args.root / args.station
    if args.purge_originals:
        purge_originals(station_dir / ORIGINALS_DIR)
        return 0
    clean_station(station_dir, apply=args.apply)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
