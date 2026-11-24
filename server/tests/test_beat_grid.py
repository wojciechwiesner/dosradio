"""Beat-grid fit used to anchor DJ tempo lock (Feedby 2026-11-23: transitions drifted off beat)."""
import numpy as np

from app.beat_grid import fit_beat_grid
from app.mixer import RATE, MixerConfig, _grid_swap_anchors


def _kicks(bpm: float, n: int, start: float, jitter_ms: float = 0.0, drop: tuple[int, ...] = (), seed: int = 1):
    rng = np.random.default_rng(seed)
    period = 60.0 / bpm
    t = start + np.arange(n) * period + rng.normal(0, jitter_ms / 1000.0, n)
    return np.delete(t, list(drop)), period


def test_fit_recovers_period_despite_jitter_and_missed_kicks():
    kicks, period = _kicks(140.0, 48, 0.12, jitter_ms=6.0, drop=(5, 17, 30))
    grid = fit_beat_grid(kicks, period * 1.01)
    assert grid is not None
    assert abs(grid.period_s - period) < 0.0005          # < 0.1 % tempo error over 48 beats
    assert abs(grid.origin_s - 0.12) < 0.006


def test_fit_rejects_fill_hits_off_the_grid():
    kicks, period = _kicks(125.0, 40, 0.3)
    fills = kicks[::7][:5] + period * 0.5               # off-beat ghost notes
    grid = fit_beat_grid(np.sort(np.concatenate([kicks, fills])), period)
    assert grid is not None and grid.kicks_used == 40
    assert grid.residual_ms < 1.0


def test_swap_anchors_line_up_beats_even_when_a_head_kick_is_missed():
    # Old code paired the Nth detected kick of each deck: one missed head kick shifted the pair by a beat.
    tail, tp = _kicks(140.0, 48, 0.05, jitter_ms=4.0)
    head, hp = _kicks(139.0, 52, 0.21, jitter_ms=4.0, drop=(3, 9))
    tail_frames = int((tail[-1] + tp) * RATE)
    head_frames = int((head[-1] + hp) * RATE)
    # Silent audio: no measurable pulse, so the anchors must come from the robust kick fit
    tail_audio = np.zeros((tail_frames, 2), np.float32)
    head_audio = np.zeros((head_frames, 2), np.float32)
    res = _grid_swap_anchors(tail_audio, head_audio, tail, head, MixerConfig())
    assert res is not None
    t_swap, h_swap, ratio, _beats, shift = res
    assert abs(ratio - tp / hp) < 0.002
    # The tail swap frame must be on a tail beat and the head swap frame (after trimming `shift`) on a head beat
    t_beat_phase = ((t_swap / RATE - 0.05) / tp) % 1.0
    h_beat_phase = (((h_swap + shift) / RATE - 0.21) / hp) % 1.0
    for phase in (t_beat_phase, h_beat_phase):
        assert min(phase, 1.0 - phase) < 0.03              # within 3 % of a beat (~13 ms)
    # And both swap points are the same beat count after the first aligned beat
    assert abs((t_swap / RATE) / tp - (h_swap / RATE) / hp) < 0.06
