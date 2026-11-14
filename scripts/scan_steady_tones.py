"""Scan a station archive for steady tones; prints per-session-position stats."""
import glob, os, subprocess, sys
import numpy as np
from numpy.lib.stride_tricks import sliding_window_view

def pcm(path, seconds=12):
    raw = subprocess.run(["ffmpeg", "-v", "error", "-i", path, "-t", str(seconds), "-ac", "1", "-ar", "48000", "-f", "s16le", "-"],
                         capture_output=True, check=True).stdout
    return np.frombuffer(raw, np.int16).astype(np.float32) / 32768

def worst_tone(x, rate=48000, n=8192, hop=4096):
    win = np.hanning(n)
    mag = 20 * np.log10(np.array([np.abs(np.fft.rfft(x[i:i+n] * win)) for i in range(0, len(x) - n, hop)]) + 1e-9)
    k = 52
    floor = np.median(sliding_window_view(np.pad(mag, ((0, 0), (k // 2, k // 2)), mode="edge"), k + 1, axis=1), axis=2)
    hits = ((mag - floor) > 18).mean(axis=0)
    freqs = np.fft.rfftfreq(n, 1 / rate)
    band = (freqs > 300) & (freqs < 16000)
    i = np.argmax(np.where(band, hits, 0))
    return float(hits[i]), float(freqs[i])

files = sorted(glob.glob(sys.argv[1] + "/seg-*.opus"))[-int(sys.argv[2]):]
stamps = [int(os.path.basename(f)[4:-5]) for f in files]
bad = 0; rows = []
for f, s, prev in zip(files, stamps, [None] + stamps[:-1]):
    hit, freq = worst_tone(pcm(f))
    new_session = prev is None or (s - prev) / 1e9 > 45   # recorder opens a new Lyria session
    rows.append((new_session, hit >= 0.6, freq))
    bad += hit >= 0.6
pos = 0; by_pos = {}
for new, is_bad, _ in rows:
    pos = 0 if new else pos + 1
    by_pos.setdefault(pos, []).append(is_bad)
print(f"{sys.argv[1].split('/')[-1]}: {bad}/{len(rows)} segments with a steady tone")
print("  by position in Lyria session (0 = first 30 s):", {p: f"{sum(v)}/{len(v)}" for p, v in sorted(by_pos.items())})
