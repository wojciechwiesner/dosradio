/** Programme settings in the side card: hourly bulletin toggle and the weather place (city or geolocation). */
import type { Prefs } from './prefs';

const GEO_TIMEOUT_MS = 10_000;

export interface RamowkaHooks {
  prefs: () => Prefs;
  /** Persist prefs and push the new programme options to the engine. */
  changed: () => void;
}

const byId = <T extends HTMLElement>(id: string): T => {
  const element = document.getElementById(id);
  if (!element) throw new Error(`missing #${id}`); // autocheck spot: page and script must match
  return element as T;
};

export function placeInfoText(prefs: Prefs): string {
  if (prefs.weatherCity) return `Pogoda dla: ${prefs.weatherCity}`;
  if (prefs.weatherLat !== null) return 'Pogoda z twojej lokalizacji.';
  return 'Bez miasta nie podamy pogody.';
}

export function initRamowkaSettings(hooks: RamowkaHooks): void {
  const hourly = byId<HTMLInputElement>('hourlyBulletin');
  const city = byId<HTMLInputElement>('weatherCity');
  const info = byId('placeInfo');
  const locate = byId<HTMLButtonElement>('useLocation');

  const render = () => {
    const prefs = hooks.prefs();
    hourly.checked = prefs.hourlyBulletin;
    city.value = prefs.weatherCity;
    info.textContent = placeInfoText(prefs);
  };

  hourly.addEventListener('change', () => { hooks.prefs().hourlyBulletin = hourly.checked; hooks.changed(); });

  city.addEventListener('change', () => {
    const prefs = hooks.prefs();
    prefs.weatherCity = city.value.trim();
    if (prefs.weatherCity) { prefs.weatherLat = null; prefs.weatherLon = null; } // a typed city wins over old coordinates
    hooks.changed();
    render();
  });

  locate.addEventListener('click', () => {
    if (!('geolocation' in navigator)) { info.textContent = 'Ta przeglądarka nie udostępnia lokalizacji. Wpisz miasto.'; return; }
    info.textContent = 'Pytam o zgodę na lokalizację...';
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const prefs = hooks.prefs();
        prefs.weatherLat = position.coords.latitude;
        prefs.weatherLon = position.coords.longitude;
        prefs.weatherCity = '';
        hooks.changed();
        render();
      },
      () => { info.textContent = 'Nie mamy zgody na lokalizację. Wpisz miasto.'; },
      { timeout: GEO_TIMEOUT_MS, maximumAge: 10 * 60_000 },
    );
  });

  render();
}
