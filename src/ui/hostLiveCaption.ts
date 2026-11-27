/** "<Host> mówi na żywo" caption with five thin voice bars. DOM + CSS only, no emoji. */
import { voiceFromRms } from './ambientLogic';

const BAR_COUNT = 5;
/** Per-bar weighting so the bars do not all move in lockstep. */
const BAR_SHAPE = [0.55, 0.85, 1, 0.8, 0.5];
const MIN_BAR = 0.12;

export interface HostLiveCaption {
  show(hostName: string): void;
  hide(): void;
  setHostName(hostName: string): void;
  /** Called every frame while visible; rms is the raw voice RMS. */
  tick(rms: number): void;
  readonly visible: boolean;
}

export function createHostLiveCaption(root: HTMLElement, voiceRms: () => number): HostLiveCaption {
  root.textContent = '';
  const bars = document.createElement('span');
  bars.className = 'host-live-bars';
  bars.setAttribute('aria-hidden', 'true');
  const barEls: HTMLElement[] = [];
  for (let i = 0; i < BAR_COUNT; i++) {
    const bar = document.createElement('i');
    bars.appendChild(bar);
    barEls.push(bar);
  }
  const text = document.createElement('span');
  text.className = 'host-live-text';
  root.append(bars, text);

  let visible = false;
  let name = 'Prowadzący';
  let raf = 0;

  const render = (): void => {
    text.textContent = `${name} mówi na żywo`;
  };
  const paint = (rms: number): void => {
    const v = voiceFromRms(rms);
    barEls.forEach((bar, i) => bar.style.setProperty('--v', String(Math.max(MIN_BAR, v * BAR_SHAPE[i]).toFixed(3))));
  };
  const loop = (): void => {
    if (!visible) return;
    paint(voiceRms());
    raf = requestAnimationFrame(loop);
  };

  render();
  return {
    show(hostName) {
      name = hostName || name;
      render();
      visible = true;
      root.hidden = false;
      root.classList.add('is-on');
      if (!raf) raf = requestAnimationFrame(loop);
    },
    hide() {
      visible = false;
      cancelAnimationFrame(raf);
      raf = 0;
      root.classList.remove('is-on');
      paint(0);
      root.hidden = true;
    },
    setHostName(hostName) {
      name = hostName || name;
      render();
    },
    tick: paint,
    get visible() { return visible; },
  };
}
