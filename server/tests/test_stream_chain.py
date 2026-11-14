"""Verify chaining multiple segments with join_recordings in the streaming loop pattern."""
import numpy as np
import sys
sys.path.insert(0, ".")
from app.mixer import RATE, join_recordings, kick_onsets, steady_period
from tests.test_mixer import kick_train, stereo

def test_chaining_five_segments_maintains_consistent_tempo_and_no_clipping():
    period = 60.0 / 126
    # 5 segments with random kick start offsets (simulating 5 different recorded sessions)
    offsets = [0.12, 0.35, 0.05, 0.41, 0.22]
    segments = [stereo(kick_train(126, 30, first_kick=off, jitter=0.015, seed=i)) for i, off in enumerate(offsets)]
    
    # Emulate the streamer loop:
    buffer = segments[0]
    total_fed_frames = 0
    reserve_frames = int(15 * RATE)
    
    all_fed_audio = []
    
    for next_seg in segments[1:]:
        # Feed until reserve
        feed_frames = len(buffer) - reserve_frames
        assert feed_frames > 0
        all_fed_audio.append(buffer[:feed_frames])
        tail = buffer[feed_frames:]
        # Mix next segment into tail
        buffer = join_recordings(tail, next_seg)
    all_fed_audio.append(buffer)
    
    full_audio = np.concatenate(all_fed_audio)
    mono = full_audio.mean(axis=1)
    onsets = kick_onsets(mono)
    intervals = np.diff(onsets)
    
    # Check that across the ENTIRE 2+ minute chained stream, no kick interval breaks the tempo
    bad_intervals = np.where(np.abs(intervals - period) > 0.07)[0]
    print("Total onsets:", len(onsets), "Bad intervals:", len(bad_intervals))
    if len(bad_intervals):
        print("Bad interval times:", onsets[bad_intervals], "values:", intervals[bad_intervals])
    assert len(bad_intervals) == 0
    assert np.max(np.abs(full_audio)) <= 1.0
