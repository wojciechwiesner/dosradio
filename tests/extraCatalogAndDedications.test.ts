import { describe, expect, it } from 'vitest';
import { MUSIC_GROUPS, STATIONS } from '../src/radio/stations';
import { DUCK_LEVEL } from '../src/radio/publicRadioEngine';
import { MUSIC_GROUPS as ORBITA_GROUPS, STATIONS as ORBITA_STATIONS, DEFAULT_PREFS } from '../orbita/src/data.js';

describe('Techno & Rave + B2B Space catalog and audio mix constants', () => {
  const expectedTechno = [
    'berlin-bcco-techno',
    'raw-techno',
    'hypnotic-techno',
    'etno-techno',
    'tribal-techno',
    'goa-trance',
    'hard-dance',
    'tekk',
  ];
  const expectedB2B = ['salon-beauty-spa', 'lobby-hotelowe', 'poczekalnia'];

  it('includes all 8 techno/rave stations and 3 B2B space sets in Classic and Orbita', () => {
    const classicIds = new Set(STATIONS.map((s) => s.id));
    const orbitaIds = new Set(ORBITA_STATIONS.map((s) => String(s.id)));
    const groupIds = new Set(MUSIC_GROUPS.map((g) => g.id));
    const orbitaGroupIds = new Set(ORBITA_GROUPS.map((g) => String(g.id)));

    expect(groupIds.has('techno-rave')).toBe(true);
    expect(groupIds.has('przestrzenie-b2b')).toBe(true);
    expect(orbitaGroupIds.has('techno-rave')).toBe(true);
    expect(orbitaGroupIds.has('przestrzenie-b2b')).toBe(true);

    for (const sid of [...expectedTechno, ...expectedB2B]) {
      expect(classicIds.has(sid), `Classic missing ${sid}`).toBe(true);
      expect(orbitaIds.has(sid), `Orbita missing ${sid}`).toBe(true);
    }
  });

  it('uses deeper music ducking (0.24) during voice segments in both Classic and Orbita', () => {
    expect(DUCK_LEVEL).toBe(0.24);
    expect(DEFAULT_PREFS.duckLevel).toBe(0.24);
  });
});
