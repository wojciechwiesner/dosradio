"""Pure-NumPy DJ DSP primitives: pitch-preserving WSOLA (+/-12%), 3-band Isolator EQ, DJ Filter Sweep, and Dub Echo."""

from __future__ import annotations

import numpy as np

RATE = 48_000
CHANNELS = 2

LOW_CROSSOVER_HZ = 150.0
HIGH_CROSSOVER_HZ = 3_200.0


def _ensure_2d(audio: np.ndarray) -> tuple[np.ndarray, bool]:
    if audio.ndim == 1:
        return audio[:, None].astype(np.float32, copy=False), True
    return audio.astype(np.float32, copy=False), False


def _restore_shape(audio: np.ndarray, was_1d: bool) -> np.ndarray:
    return audio[:, 0] if was_1d else audio


def wsola_stretch(audio: np.ndarray, target_frames: int) -> np.ndarray:
    """Pitch-preserving Waveform Similarity Overlap-Add (WSOLA) stereo time-stretcher.

    Keeps kick transients crisp and musical key/pitch unchanged across +/-12% tempo shifts.
    Stereo channels share the exact same grain offset so L/R phase never smears.
    """
    if target_frames <= 0 or len(audio) == 0:
        return np.zeros((max(0, target_frames), *audio.shape[1:]), dtype=np.float32)
    if abs(len(audio) - target_frames) <= 2 or len(audio) < 2048:
        if len(audio) == target_frames:
            return audio.astype(np.float32, copy=True)
        grid = np.linspace(0.0, len(audio) - 1, target_frames)
        src = np.arange(len(audio), dtype=np.float64)
        if audio.ndim == 1:
            return np.interp(grid, src, audio).astype(np.float32)
        return np.column_stack([np.interp(grid, src, audio[:, c]) for c in range(audio.shape[1])]).astype(np.float32)

    x, was_1d = _ensure_2d(audio)
    in_len, ch = x.shape
    ratio = in_len / float(target_frames)  # >1 means speeding up (shorter output), <1 slowing down
    rates = np.full(target_frames, ratio, dtype=np.float64)
    out = _wsola_variable_core(x, rates, target_frames, ch)
    return _restore_shape(out, was_1d)


def wsola_tempo_glide(audio: np.ndarray, start_speed: float, end_speed: float = 1.0) -> np.ndarray:
    """Smoothly glide playback speed from `start_speed` to `end_speed` with pitch preserved (CDJ Master Tempo ride).

    `speed > 1.0` plays faster than native; `speed < 1.0` plays slower than native.
    Consumes ALL frames of `audio` and returns the smoothly tempo-ramped output.
    """
    if len(audio) < 4096 or abs(start_speed - end_speed) < 0.004 and abs(start_speed - 1.0) < 0.004:
        return audio.astype(np.float32, copy=True)
    x, was_1d = _ensure_2d(audio)
    in_len, ch = x.shape
    avg_speed = 0.5 * (start_speed + end_speed)
    target_frames = max(2048, int(round(in_len / max(0.5, avg_speed))))
    rates = np.linspace(start_speed, end_speed, target_frames, dtype=np.float64)
    # Normalize rates so integral equals exact input length
    rates *= in_len / max(1.0, float(np.sum(rates)))
    out = _wsola_variable_core(x, rates, target_frames, ch)
    return _restore_shape(out, was_1d)


def _wsola_variable_core(x: np.ndarray, step_rates: np.ndarray, target_frames: int, ch: int) -> np.ndarray:
    in_len = len(x)
    win_len = 1920  # 40 ms @ 48 kHz -> covers 2 full cycles @ 50 Hz sub-bass, sharp kick transients
    hop_s = win_len // 2  # 20 ms synthesis hop (exact COLA with Hann window)
    tol = 480  # +/- 10 ms waveform similarity search tolerance
    corr_len = 480  # 10 ms correlation prefix

    window = np.hanning(win_len).astype(np.float32)[:, None]
    mono = x.mean(axis=1)
    pad_len = target_frames + win_len * 2
    out = np.zeros((pad_len, ch), dtype=np.float32)
    norm = np.zeros(pad_len, dtype=np.float32)
    win_1d = window[:, 0]

    # Precompute cumulative input position at each output sample
    in_positions = np.cumsum(step_rates) - step_rates[0]

    out_pos = 0
    expected_in = 0
    while out_pos < target_frames:
        center_in = int(round(in_positions[min(out_pos, target_frames - 1)]))
        if out_pos == 0:
            best_in = 0
        else:
            lo = max(0, min(in_len - win_len, center_in - tol))
            hi = max(lo, min(in_len - win_len, center_in + tol))
            ref_start = max(0, min(in_len - corr_len, expected_in))
            ref = mono[ref_start : ref_start + corr_len]
            if hi > lo and len(ref) == corr_len and float(np.dot(ref, ref)) > 1e-8:
                # Vectorized strided correlation across candidate offsets (step 4 samples = 0.08 ms resolution)
                candidates = np.arange(lo, hi + 1, 4)
                idx = candidates[:, None] + np.arange(corr_len)[None, :]
                patches = mono[idx]
                scores = patches @ ref
                best_in = int(candidates[int(np.argmax(scores))])
            else:
                best_in = max(0, min(in_len - win_len, center_in))

        best_in = max(0, min(in_len - win_len, best_in))
        grain = x[best_in : best_in + win_len]
        if len(grain) < win_len:
            padded = np.zeros((win_len, ch), dtype=np.float32)
            padded[: len(grain)] = grain
            grain = padded

        out[out_pos : out_pos + win_len] += grain * window
        norm[out_pos : out_pos + win_len] += win_1d
        expected_in = best_in + hop_s
        out_pos += hop_s

    valid = norm[:target_frames] > 1e-6
    result = out[:target_frames].copy()
    result[valid] /= norm[:target_frames][valid, None]
    return result


def split_3band_isolator(
    audio: np.ndarray,
    low_hz: float = LOW_CROSSOVER_HZ,
    high_hz: float = HIGH_CROSSOVER_HZ,
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Zero-phase 3-band DJ Isolator crossover (LOW <150 Hz, MID 150-3200 Hz, HIGH >3200 Hz).

    Exact complementary magnitude response: `low + mid + high == audio` to float32 precision.
    """
    n = len(audio)
    if n < 8:
        zeros = np.zeros_like(audio, dtype=np.float32)
        return zeros, audio.astype(np.float32, copy=True), zeros.copy()
    x, was_1d = _ensure_2d(audio)
    size = 1 << int(np.ceil(np.log2(max(n, 2))))
    spec = np.fft.rfft(x, size, axis=0)
    freqs = np.fft.rfftfreq(size, 1.0 / RATE)[:, None]

    lp_low = 1.0 / (1.0 + (freqs / low_hz) ** 8)
    lp_high = 1.0 / (1.0 + (freqs / high_hz) ** 8)

    low = np.fft.irfft(spec * lp_low, size, axis=0)[:n].astype(np.float32)
    high = np.fft.irfft(spec * (1.0 - lp_high), size, axis=0)[:n].astype(np.float32)
    mid = x[:n] - low - high
    return _restore_shape(low, was_1d), _restore_shape(mid, was_1d), _restore_shape(high, was_1d)


def dj_filter_sweep(
    audio: np.ndarray,
    kind: str,
    start_hz: float,
    end_hz: float,
    resonance: float = 0.18,
) -> np.ndarray:
    """Time-varying logarithmic DJ High-Pass ('hpf') or Low-Pass ('lpf') sweep via overlap-add STFT."""
    n = len(audio)
    if n < 512:
        return audio.astype(np.float32, copy=True)
    x, was_1d = _ensure_2d(audio)
    ch = x.shape[1]
    win_len = 2048
    hop = 512
    win = np.hanning(win_len).astype(np.float32)[:, None]
    win_sq = (win[:, 0] ** 2)
    freqs = np.fft.rfftfreq(win_len, 1.0 / RATE)

    pad = win_len
    xp = np.pad(x, ((pad, pad), (0, 0)), mode="reflect")
    total = len(xp)
    out = np.zeros_like(xp, dtype=np.float32)
    norm = np.zeros(total, dtype=np.float32)

    n_frames = max(1, (total - win_len) // hop + 1)
    log_start = np.log(max(20.0, start_hz))
    log_end = np.log(max(20.0, end_hz))

    for i in range(n_frames):
        pos = i * hop
        prog = np.clip((pos - pad + win_len * 0.5) / max(1.0, float(n)), 0.0, 1.0)
        fc = float(np.exp(log_start + (log_end - log_start) * prog))
        ratio = freqs / max(20.0, fc)
        if kind == "hpf":
            mag = (ratio**4) / (1.0 + ratio**4)
        else:
            mag = 1.0 / (1.0 + ratio**4)
        # Subtle analog cutoff warmth around fc without harsh whistling
        bell = 1.0 + resonance * np.exp(-0.5 * ((np.log2(np.maximum(ratio, 1e-4))) / 0.35) ** 2)
        gain = (mag * bell).astype(np.float32)[:, None]

        frame = xp[pos : pos + win_len] * win
        filtered = np.fft.irfft(np.fft.rfft(frame, axis=0) * gain, n=win_len, axis=0).astype(np.float32)
        out[pos : pos + win_len] += filtered * win
        norm[pos : pos + win_len] += win_sq

    valid = norm > 1e-6
    out[valid] /= norm[valid, None]
    res = out[pad : pad + n]
    return _restore_shape(res, was_1d)


def dub_echo_tail(
    audio: np.ndarray,
    beat_period_s: float,
    tail_frames: int,
    feedback: float = 0.50,
    wet_mix: float = 0.62,
) -> np.ndarray:
    """Generate a band-passed (280-4200 Hz) 3/4-beat tempo-synced stereo dub delay tail."""
    x, was_1d = _ensure_2d(audio)
    ch = x.shape[1]
    delay_s = float(np.clip(beat_period_s * 0.75, 0.18, 0.65))
    delay_frames = max(256, int(round(delay_s * RATE)))

    # Band-pass the source feeding the delay so kicks never boom and highs decay warmly
    _, mid, _ = split_3band_isolator(x, low_hz=280.0, high_hz=4200.0)
    src_len = min(len(mid), delay_frames * 4)
    seed = mid[-src_len:]

    wet = np.zeros((len(x) + tail_frames, ch), dtype=np.float32)
    base_offset = len(x) - src_len
    for tap in range(1, 9):
        amp = wet_mix * (feedback ** (tap - 1))
        if amp < 0.02:
            break
        start = base_offset + tap * delay_frames
        end = min(len(wet), start + src_len)
        if start >= len(wet) or end <= start:
            continue
        seg = seed[: end - start]
        # Subtle stereo ping-pong alternation
        if ch == 2 and tap % 2 == 1:
            seg = seg[:, ::-1] * np.array([[0.85, 1.0]], dtype=np.float32)
        wet[start:end] += seg * amp

    return _restore_shape(wet, was_1d)


def tempogram_beat_grid(
    audio: np.ndarray,
    from_end: bool,
    analysis_seconds: float = 28.0,
) -> tuple[float | None, np.ndarray]:
    """Multi-band spectral-flux autocorrelation beat tracker for rolling-bassline club music.

    Handles BCCO/rumble techno, syncopated Detroit basslines, trance, and house where
    continuous sub-bass lowers raw amplitude crest below simple peak-threshold detectors.
    """
    span = int(analysis_seconds * RATE)
    if from_end and len(audio) > span:
        offset_s = (len(audio) - span) / RATE
        clip = audio[-span:]
    else:
        offset_s = 0.0
        clip = audio[:span]
    if len(clip) < RATE * 6:
        return None, np.array([])

    mono = clip.mean(axis=1) if clip.ndim == 2 else clip
    low, _, _ = split_3band_isolator(clip[:, :1] if clip.ndim == 2 else clip[:, None], low_hz=118.0, high_hz=2500.0)
    low_m = low[:, 0].astype(np.float64)
    low_rms = float(np.sqrt(np.mean(low_m**2)))
    if low_rms < 0.012:  # Rejects wideband noise & beatless quiet pads
        return None, np.array([])

    hop = 240  # 5 ms (200 Hz frame rate)
    w = 960    # 20 ms energy window
    m64 = mono.astype(np.float64)
    pad_l = np.pad(low_m**2, (w // 2, w // 2))
    e_low = np.sqrt(np.maximum(0.0, (np.cumsum(pad_l[w:]) - np.cumsum(pad_l[:-w])) / w))[::hop]
    pad_m = np.pad(m64**2, (w // 2, w // 2))
    e_full = np.sqrt(np.maximum(0.0, (np.cumsum(pad_m[w:]) - np.cumsum(pad_m[:-w])) / w))[::hop]

    f_low = np.maximum(0.0, np.diff(np.log1p(100.0 * e_low), prepend=e_low[0]))
    f_hi = np.maximum(0.0, np.diff(np.log1p(100.0 * np.maximum(0.0, e_full - e_low)), prepend=0.0))
    flux = 0.74 * (f_low / (np.std(f_low) + 1e-8)) + 0.26 * (f_hi / (np.std(f_hi) + 1e-8))
    flux0 = flux - np.mean(flux)
    ac = np.correlate(flux0, flux0, mode="full")[len(flux0) - 1 :] / (float(np.dot(flux0, flux0)) + 1e-9)

    lags = np.arange(67, 161)  # 75..179 BPM
    scores = [
        float(np.mean([np.max(ac[max(1, k * L - 1) : min(len(ac), k * L + 2)]) for k in (1, 2, 3, 4) if k * L < len(ac)]))
        * (1.15 if 0.39 <= (L * hop / RATE) <= 0.62 else 1.0)
        for L in lags
    ]
    best_idx = int(np.argmax(scores))
    if scores[best_idx] < 0.068:
        return None, np.array([])

    best_lag = float(lags[best_idx])
    li = int(best_lag)
    if 1 < li < len(ac) - 1:
        denom = ac[li - 1] - 2.0 * ac[li] + ac[li + 1]
        if abs(denom) > 1e-9:
            best_lag += float(np.clip(0.5 * (ac[li - 1] - ac[li + 1]) / denom, -0.45, 0.45))

    period = best_lag * hop / RATE
    lag_i = max(1, int(round(best_lag)))
    phases = [float(np.mean(f_low[p::lag_i])) for p in range(lag_i)]
    best_phase = int(np.argmax(phases))

    beats: list[float] = []
    win = max(1, int(round(0.04 * best_lag)))
    pos = float(best_phase)
    while int(round(pos)) < len(f_low):
        c = int(round(pos))
        lo_i, hi_i = max(0, c - win), min(len(f_low), c + win + 1)
        pk = lo_i + int(np.argmax(f_low[lo_i:hi_i]))
        beats.append(offset_s + (pk * hop) / RATE)
        pos += best_lag
    return period, np.array(beats, dtype=np.float64)
