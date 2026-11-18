import { describe, it, expect } from 'vitest';
import { VOICE_GAIN, DUCK_LEVEL } from '../src/radio/publicRadioEngine';

describe('Voice loudness under music bed (v1.4 U1)', () => {
  it('attenuates host/news voice 8 dB below full music volume', () => {
    // 0.4 linear gain ~= -8 dB, keeping the voice under full-volume music.
    expect(VOICE_GAIN).toBeCloseTo(0.4, 5);
  });

  it('ducks the music bed to a level below full volume so the voice sits clearly on top', () => {
    // 0.24 linear duck level (~ -12.4 dB) gives clear separation under 0.40 (-8 dB) voice gain.
    expect(DUCK_LEVEL).toBeCloseTo(0.24, 5);
  });
});
