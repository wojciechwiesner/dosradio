"""Mix engine: join two recordings so the kick keeps its beat across phrase-long DJ transitions."""
import numpy as np

from app.mixer import (
    CROSSFADE_BEATS,
    FALLBACK_FADE_SECONDS,
    MixerConfig,
    RATE,
    float_to_pcm,
    join_intra_session,
    join_recordings,
    kick_onsets,
    mix_with_report,
    pcm_to_float,
    steady_period,
)


def kick_train(
    bpm: float, seconds: float, first_kick: float, freq: float = 55.0, level: float = 0.5, jitter: float = 0.0, seed: int = 0
) -> np.ndarray:
    """Mono audio with a decaying sine kick on every beat; the first kick starts at `first_kick` s."""
    period = 60.0 / bpm
    rng = np.random.default_rng(seed)
    out = np.zeros(int(seconds * RATE), dtype=np.float32)
    burst_t = np.arange(int(0.15 * RATE)) / RATE
    burst = (level * np.sin(2 * np.pi * freq * burst_t) * np.exp(-burst_t * 25)).astype(np.float32)
    t = first_kick
    while t < seconds - 0.2:
        start = max(0, int((t + rng.uniform(-jitter, jitter)) * RATE))
        out[start:start + len(burst)] += burst
        t += period
    return out


def syncopated_techno_train(bpm: float, seconds: float, first_kick: float = 0.12) -> np.ndarray:
    """Kick on every beat plus syncopated off-beat sub-bass hits (like rolling minimal techno)."""
    base = kick_train(bpm, seconds, first_kick=first_kick, freq=55.0, level=0.6)
    period = 60.0 / bpm
    sub_t = np.arange(int(0.11 * RATE)) / RATE
    sub_hit = (0.42 * np.sin(2 * np.pi * 68.0 * sub_t) * np.exp(-sub_t * 28)).astype(np.float32)
    t = first_kick
    bar_step = 0
    while t + 0.75 * period < seconds - 0.2:
        if bar_step % 4 in (0, 1):
            idx = int((t + 0.75 * period) * RATE)
            base[idx:idx + len(sub_hit)] += sub_hit
        t += period
        bar_step += 1
    return np.clip(base, -0.95, 0.95)


def stereo(mono: np.ndarray) -> np.ndarray:
    return np.stack([mono, mono], axis=1)


def kick_intervals(mono: np.ndarray) -> np.ndarray:
    return np.diff(kick_onsets(mono))


def test_kick_onsets_land_on_the_true_kick_times():
    audio = kick_train(126, 10, first_kick=0.31)
    onsets = kick_onsets(audio)
    truth = 0.31 + np.arange(len(onsets)) * 60.0 / 126
    assert len(onsets) >= 15
    assert np.max(np.abs(onsets - truth)) < 0.015


def test_steady_period_recovers_the_beat():
    period = steady_period(kick_onsets(kick_train(126, 10, first_kick=0.1)))
    assert period is not None
    assert abs(period - 60.0 / 126) < 0.002


def test_steady_period_recovers_beat_despite_syncopated_sub_bass():
    period = steady_period(kick_onsets(syncopated_techno_train(126, 20)))
    assert period is not None
    assert abs(period - 60.0 / 126) < 0.015


def test_steady_period_survives_a_kick_that_wanders_by_tens_of_milliseconds():
    period = steady_period(kick_onsets(kick_train(126, 20, first_kick=0.1, jitter=0.025)))
    assert period is not None
    assert abs(period - 60.0 / 126) < 0.01


def test_steady_period_refuses_audio_without_a_steady_kick():
    assert steady_period(kick_onsets(np.zeros(RATE * 5, dtype=np.float32))) is None


def test_wandering_kicks_still_join_without_a_flam():
    """Real Lyria audio: kicks are +-25 ms off the grid. The 16-beat seam must not add an extra beat or flam."""
    period = 60.0 / 126
    for seed in range(5):
        tail = stereo(kick_train(126, 24, first_kick=0.10, jitter=0.025, seed=seed))
        head = stereo(kick_train(126, 24, first_kick=0.31, jitter=0.025, seed=seed + 100))
        intervals = kick_intervals(join_recordings(tail, head).mean(axis=1))
        assert len(intervals) > 35
        assert np.max(np.abs(intervals - period)) < 0.07, (seed, intervals.round(3))


def test_misaligned_recordings_keep_one_beat_across_the_seam():
    period = 60.0 / 126
    tail = stereo(kick_train(126, 24, first_kick=0.10))
    head = stereo(kick_train(126, 24, first_kick=0.31))  # kick grid offset by 210 ms
    joined, report = mix_with_report(tail, head)
    intervals = kick_intervals(joined.mean(axis=1))
    assert report.mode == "beatmatched_bass_swap"
    assert report.beats_mixed == CROSSFADE_BEATS == 16
    assert report.overlap_seconds > 7.0
    assert len(intervals) > 35
    assert np.max(np.abs(intervals - period)) < 0.015, intervals.round(3)


def test_every_offset_between_the_two_grids_is_repaired():
    period = 60.0 / 128
    tail = stereo(kick_train(128, 20, first_kick=0.05))
    for offset in (0.0, 0.07, 0.19, 0.33, 0.44):
        head = stereo(kick_train(128, 20, first_kick=offset))
        intervals = kick_intervals(join_recordings(tail, head).mean(axis=1))
        assert np.max(np.abs(intervals - period)) < 0.015, (offset, intervals.round(3))


def test_the_seam_is_one_phrase_crossfade_long():
    tail = stereo(kick_train(126, 24, first_kick=0.10))
    head = stereo(kick_train(126, 24, first_kick=0.31))
    joined = join_recordings(tail, head)
    overlap = CROSSFADE_BEATS * 60.0 / 126
    lost = (len(tail) + len(head) - len(joined)) / RATE
    assert overlap <= lost <= overlap + 2.5 * 60.0 / 126


def test_the_mix_never_gets_louder_than_its_inputs():
    tail = stereo(kick_train(126, 24, first_kick=0.10, level=0.9))
    head = stereo(kick_train(126, 24, first_kick=0.31, level=0.9))
    assert np.max(np.abs(join_recordings(tail, head))) <= 0.9 + 1e-3


def test_audio_without_a_kick_gets_a_lush_multi_second_equal_power_crossfade():
    rng = np.random.default_rng(1)
    tail = stereo((rng.standard_normal(RATE * 20) * 0.05).astype(np.float32))
    head = stereo((rng.standard_normal(RATE * 20) * 0.05).astype(np.float32))
    joined, report = mix_with_report(tail, head)
    shared_s = (len(tail) + len(head) - len(joined)) / RATE
    assert report.mode == "equal_power_fallback"
    assert abs(shared_s - FALLBACK_FADE_SECONDS) < 0.1
    assert not np.any(np.isnan(joined))


def test_intra_session_splice_preserves_beats_with_micro_declick():
    tail = stereo(kick_train(122, 10, first_kick=0.10))
    head = stereo(kick_train(122, 10, first_kick=0.10))
    spliced = join_intra_session(tail, head, declick_ms=15.0)
    lost_ms = ((len(tail) + len(head) - len(spliced)) / RATE) * 1000.0
    assert 14.0 <= lost_ms <= 16.0


def test_custom_mixer_config_changes_overlap_duration():
    tail = stereo(kick_train(124, 28, first_kick=0.10))
    head = stereo(kick_train(124, 28, first_kick=0.25))
    _, rep8 = mix_with_report(tail, head, MixerConfig(crossfade_beats=8))
    _, rep24 = mix_with_report(tail, head, MixerConfig(crossfade_beats=24))
    assert rep8.beats_mixed == 8
    assert rep24.beats_mixed == 24
    assert rep24.overlap_seconds > rep8.overlap_seconds * 2.5


def test_pcm_round_trip_is_lossless_for_16_bit_audio():
    raw = (np.arange(-1000, 1000, dtype=np.int16)).tobytes() * 2
    assert float_to_pcm(pcm_to_float(raw)) == raw
