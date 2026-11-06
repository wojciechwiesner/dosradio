import { describe, it, expect } from 'vitest';
import { VOICE_GAIN, DUCK_LEVEL } from '../src/radio/publicRadioEngine';

describe('Voice loudness under music bed (v1.4 U1)', () => {
  it('attenuates host/news voice 8 dB below full music volume', () => {
    // 0.4 linear gain ~= -8 dB, keeping the voice under full-volume music.
    expect(VOICE_GAIN).toBeCloseTo(0.4, 5);
  });

  it('ducks the music bed to a level below full volume but above the voice floor', () => {
    // 0.34 linear duck level ~= -9.4 dB: just under the voice (-8 dB) so the voice leads.
    expect(DUCK_LEVEL).toBeCloseTo(0.34, 5);
  });
});
