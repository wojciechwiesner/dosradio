import { describe, it, expect, beforeEach } from 'vitest';
import {
  MUSIC_GROUPS,
  STATIONS,
  stationById,
  groupById,
  stationsForGroup,
  nextStationInGroup,
  applyCatalog,
  computeAutoRamowkaSlot,
} from '../src/radio/stations';
import {
  defaultPrefs,
  parsePrefs,
  resolveInitialView,
  loadViewPref,
  saveViewPref,
  VIEW_KEY,
} from '../src/ui/prefs';

describe('Music Groups & 42 Stations Catalog', () => {
  it('defines 8 hierarchical music groups and assigns every station to a valid group', () => {
    expect(MUSIC_GROUPS.length).toBe(8);
    const groupIds = new Set(MUSIC_GROUPS.map((g) => g.id));
    expect(groupIds.size).toBe(8);
    for (const st of STATIONS) {
      expect(groupIds.has(st.group)).toBe(true);
      expect(groupById(st.group).id).toBe(st.group);
    }
  });

  it('includes the 7 new synth, film, classical, acoustic, and ethno/folk stations', () => {
    const newIds = [
      'stranger-synth',
      'muzyka-filmowa',
      'cyber-noir',
      'muzyka-klasyczna',
      'instrumentalna-akustyczna',
      'etno-world',
      'slowianski-folk',
    ];
    for (const id of newIds) {
      const st = stationById(id);
      expect(st.id).toBe(id);
    }
    expect(stationById('stranger-synth').group).toBe('synth-filmowa');
    expect(stationById('muzyka-klasyczna').group).toBe('klasyka-instrumentalna');
    expect(stationById('slowianski-folk').group).toBe('etno-folk');
  });

  it('rotates through stations in a group via nextStationInGroup', () => {
    const synthStations = stationsForGroup('synth-filmowa');
    expect(synthStations.length).toBeGreaterThanOrEqual(3);
    const first = synthStations[0];
    const second = nextStationInGroup('synth-filmowa', first.id);
    expect(second.id).toBe(synthStations[1].id);
  });

  it('merges dynamic admin catalog and hides disabled stations cleanly', () => {
    applyCatalog({
      stations: [
        { id: 'stranger-synth', enabled: false },
        {
          id: 'custom-admin-wave',
          name: 'Admin Wave',
          tagline: 'Stacja testowa z panelu admina.',
          group: 'synth-filmowa',
          category: 'noc',
          bpm: 112,
          host: 'Kaja',
          enabled: true,
        },
      ],
    });
    const activeSynth = stationsForGroup('synth-filmowa');
    expect(activeSynth.some((s) => s.id === 'stranger-synth')).toBe(false);
    expect(activeSynth.some((s) => s.id === 'custom-admin-wave')).toBe(true);

    // Restore Stranger Synth and remove temporary test station state
    applyCatalog({
      stations: [
        { id: 'stranger-synth', enabled: true },
        { id: 'custom-admin-wave', enabled: false },
      ],
    });
    expect(stationsForGroup('synth-filmowa').some((s) => s.id === 'stranger-synth')).toBe(true);
  });
});

describe('Auto-Ramówka 24/7 & View Switcher Preferences', () => {
  beforeEach(() => {
    try {
      localStorage.removeItem(VIEW_KEY);
    } catch {
      /* ignore */
    }
  });

  it('computes time-of-day Auto-Ramówka 24/7 slots across the 24-hour clock', () => {
    const morning = computeAutoRamowkaSlot(new Date(2026, 10, 18, 7, 15, 0));
    expect(morning.hours).toBe('06:00–09:00');
    expect(morning.groupId).toBe('fokus-puls');

    const focus = computeAutoRamowkaSlot(new Date(2026, 10, 18, 10, 30, 0));
    expect(focus.hours).toBe('09:00–13:00');
    expect(focus.groupId).toBe('fokus-puls');

    const afternoon = computeAutoRamowkaSlot(new Date(2026, 10, 18, 15, 0, 0));
    expect(afternoon.hours).toBe('13:00–17:00');
    expect(afternoon.groupId).toBe('synth-filmowa');

    const drive = computeAutoRamowkaSlot(new Date(2026, 10, 18, 18, 45, 0));
    expect(drive.hours).toBe('17:00–20:00');
    expect(drive.groupId).toBe('etno-folk');

    const evening = computeAutoRamowkaSlot(new Date(2026, 10, 18, 21, 10, 0));
    expect(evening.hours).toBe('20:00–24:00');
    expect(evening.groupId).toBe('klub-energia');

    const night = computeAutoRamowkaSlot(new Date(2026, 10, 18, 2, 0, 0));
    expect(night.hours).toBe('00:00–06:00');
    expect(night.groupId).toBe('chill-noc');
  });

  it('parses group playback and autoRamowka preferences safely', () => {
    const prefs = parsePrefs({
      ...defaultPrefs(),
      playGroup: 'synth-filmowa',
      activeGroup: 'synth-filmowa',
      autoRamowka: true,
    });
    expect(prefs.playGroup).toBe('synth-filmowa');
    expect(prefs.activeGroup).toBe('synth-filmowa');
    expect(prefs.autoRamowka).toBe(true);
  });

  it('resolves view preference from URL query param and localStorage', () => {
    expect(resolveInitialView('?view=orbita')).toBe('orbita');
    expect(resolveInitialView('?view=classic')).toBe('classic');
    saveViewPref('orbita');
    expect(loadViewPref()).toBe('orbita');
  });
});
