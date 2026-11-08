/**
 * Receiver face of the player: a glass tuning dial in the style of 1960s-70s Polish table radios.
 * Bands (rows) are station categories, labels are station buttons, a red needle marks the tuned
 * station, a "magic eye" shows the signal level and two knobs set volume and tuning.
 * Pure view: it never talks to the engine, the caller wires callbacks.
 */
import './receiver.css';
import { STATIONS, type Station } from '../radio/stations';

type Band = NonNullable<Station['category']>;

const BANDS: { id: Band; label: string }[] = [
  { id: 'fokus', label: 'Fokus' },
  { id: 'energia', label: 'Energia' },
  { id: 'chill', label: 'Chill' },
  { id: 'noc', label: 'Noc' },
];
const SCALE_NUMBERS = ['88', '90', '92', '94', '96', '98', '100', '102', '104', '106', '108']; // printed UKF megahertz
const KNOB_SWEEP_DEG = 270; // a real pot turns about three quarters of a circle
const KNOB_START_DEG = -135;

export interface ReceiverView {
  /** Tune the dial to a preset; null = custom (mood) station, the needle parks off the scale. */
  setStation(id: string | null): void;
  /** Scale lamp: lit while the radio is playing or connecting. */
  setPower(on: boolean): void;
  /** Signal level 0..1 for the magic eye. */
  setLevel(level: number): void;
  /** Volume 0..1, turns the volume knob cap. */
  setVolume(volume: number): void;
}

interface ReceiverOptions {
  root: HTMLElement;
  onTune: (station: Station) => void;
}

/** Horizontal position (0..1) of every preset on its band: evenly spread, like printed scale marks. */
export function dialPositions(stations: Station[] = STATIONS): Map<string, { band: Band; x: number }> {
  const positions = new Map<string, { band: Band; x: number }>();
  for (const band of BANDS) {
    const onBand = stations.filter((station) => (station.category ?? 'fokus') === band.id);
    onBand.forEach((station, index) => positions.set(station.id, { band: band.id, x: (index + 0.5) / onBand.length }));
  }
  return positions;
}

export function knobAngle(fraction: number): number {
  const clamped = Math.min(1, Math.max(0, fraction));
  return KNOB_START_DEG + clamped * KNOB_SWEEP_DEG;
}

export function initReceiver({ root, onTune }: ReceiverOptions): ReceiverView {
  const find = <T extends HTMLElement>(selector: string): T => {
    const element = root.querySelector<T>(selector);
    if (!element) throw new Error(`receiver: missing ${selector}`); // autocheck spot: markup and view must match
    return element;
  };
  const bandsBox = find('.dial-bands');
  find('.dial-numbers').replaceChildren(...SCALE_NUMBERS.map((number, index) => {
    const mark = document.createElement('span');
    mark.textContent = number;
    mark.style.setProperty('--x', String(index / (SCALE_NUMBERS.length - 1)));
    return mark;
  }));
  const needle = find('.needle');
  const eye = find('.eye');
  const tune = find<HTMLInputElement>('#tune');
  const volumeCap = find('.knob-volume .knob-cap');
  const tuneCap = find('.knob-tune .knob-cap');
  const positions = dialPositions();

  const labels = new Map<string, HTMLButtonElement>();
  bandsBox.replaceChildren(...BANDS.map((band) => {
    const row = document.createElement('div');
    row.className = 'band';
    const name = document.createElement('span');
    name.className = 'band-name';
    name.textContent = band.label;
    const track = document.createElement('div');
    track.className = 'band-track';
    for (const station of STATIONS.filter((s) => positions.get(s.id)?.band === band.id)) {
      const label = document.createElement('button');
      label.type = 'button';
      label.className = 'dial-station';
      label.textContent = station.name;
      label.style.setProperty('--x', String(positions.get(station.id)!.x));
      label.addEventListener('click', () => onTune(station));
      labels.set(station.id, label);
      track.append(label);
    }
    row.append(name, track);
    return row;
  }));

  tune.max = String(STATIONS.length - 1);
  tune.addEventListener('change', () => onTune(STATIONS[Number(tune.value)]));

  return {
    setStation(id) {
      const position = id ? positions.get(id) : undefined;
      labels.forEach((label, stationId) => {
        const active = stationId === id;
        label.classList.toggle('active', active);
        label.setAttribute('aria-pressed', String(active));
      });
      needle.classList.toggle('parked', !position);
      if (position) needle.style.setProperty('--x', String(position.x));
      const index = STATIONS.findIndex((station) => station.id === id);
      if (index >= 0) tune.value = String(index);
      tuneCap.style.setProperty('--turn', `${knobAngle(index >= 0 ? index / (STATIONS.length - 1) : 0)}deg`);
    },
    setPower(on) {
      root.classList.toggle('on', on);
    },
    setLevel(level) {
      eye.style.setProperty('--level', Math.min(1, Math.max(0, level)).toFixed(3));
    },
    setVolume(volume) {
      volumeCap.style.setProperty('--turn', `${knobAngle(volume)}deg`);
    },
  };
}
