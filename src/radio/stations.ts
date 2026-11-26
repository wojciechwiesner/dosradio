/**
 * AmbiRadio music stations across moods and time-of-day host voices.
 * "DOS Groove" is the original prompt, preserved verbatim.
 */

import { EXTRA_MUSIC_GROUPS, EXTRA_STATIONS } from './extraStations';

export type MusicGroupId =
  | 'fokus-puls'
  | 'klub-energia'
  | 'synth-filmowa'
  | 'klasyka-instrumentalna'
  | 'etno-folk'
  | 'chill-noc'
  | 'techno-rave'
  | 'przestrzenie-b2b';

export interface MusicGroup {
  id: MusicGroupId;
  name: string;
  tagline: string;
  color: string;
  stations: string[];
}

export interface Station {
  id: string;
  name: string;
  tagline: string;
  prompt: string;
  bpm: number;
  density: number;
  brightness: number;
  category?: 'fokus' | 'energia' | 'chill' | 'noc';
  group?: MusicGroupId;
  /** Host name; voice and manner live on the server (dosradio-api/app/hosts.py). */
  host?: string;
  enabled?: boolean;
}

export const MUSIC_GROUPS: MusicGroup[] = [
  {
    id: 'fokus-puls',
    name: 'Fokus i Puls',
    tagline: 'Równy rytm do pracy i skupienia',
    color: '#2be38b',
    stations: ['dos-groove', 'lofi-nauka', 'micro-house', 'deep-tech', 'dub-techno', 'minimal-techno'],
  },
  {
    id: 'klub-energia',
    name: 'Klub i Energia',
    tagline: 'Parkiet, bas i wysokie tempo',
    color: '#ff9d2b',
    stations: ['tech-house', 'club-dance', 'detroit-techno', 'melodic-house', 'progressive-house', 'trance', 'drum-and-bass', 'liquid-dnb'],
  },
  {
    id: 'synth-filmowa',
    name: 'Synth i Filmowa',
    tagline: 'Analogowe arpeggia, Stranger Synth i kino',
    color: '#ff4d6d',
    stations: ['stranger-synth', 'muzyka-filmowa', 'cyber-noir'],
  },
  {
    id: 'klasyka-instrumentalna',
    name: 'Klasyka i Instrumentalna',
    tagline: 'Smyczki, fortepian i żywe instrumenty',
    color: '#c9a227',
    stations: ['muzyka-klasyczna', 'instrumentalna-akustyczna', 'stoa'],
  },
  {
    id: 'etno-folk',
    name: 'Etno i Folk',
    tagline: 'Rytmy świata, słowiańska dusza i perkusjonalia',
    color: '#e07a5f',
    stations: ['etno-world', 'slowianski-folk', 'afro-house', 'organic-house'],
  },
  {
    id: 'chill-noc',
    name: 'Chill i Noc',
    tagline: 'Ciepły wieczór, jazz, ambient i dub',
    color: '#7aa2f7',
    stations: ['deep-house', 'poranna-kawa', 'groove-funk', 'deep-ambient', 'warm-jazz', 'trip-hop', 'nocny-dub'],
  },
  ...EXTRA_MUSIC_GROUPS,
];

export const NEGATIVE_PROMPT = 'vocals, singing, harsh noise, screeching leads, distortion';

export const STATIONS: Station[] = [
  // --- Klasyki AmbiRadio ---
  {
    id: 'dos-groove',
    host: 'Kuba',
    name: 'DOS Groove',
    tagline: 'Minimal deep tech do pracy',
    prompt: 'minimal deep tech groove, soft dub chords, steady four-on-the-floor kick, focused work music, instrumental',
    bpm: 122,
    density: 0.45,
    brightness: 0.45,
    category: 'fokus',
    group: 'fokus-puls',
  },
  {
    id: 'lofi-nauka',
    host: 'Ola',
    name: 'Lo-fi Nauka',
    tagline: 'Ciepłe bity z winyla i miękkie pianino',
    prompt: 'lo-fi hip hop beat, dusty vinyl crackle, mellow jazzy piano chords, soft boom bap drums, study music, instrumental',
    bpm: 82,
    density: 0.4,
    brightness: 0.35,
    category: 'fokus',
    group: 'fokus-puls',
  },
  {
    id: 'micro-house',
    host: 'Rafał',
    name: 'Microhouse',
    tagline: 'Organiczny rumuński minimal i detal',
    prompt: 'microhouse, intricate Romanian minimal groove, subtle clicking percussion, delicate warm dub chords, hypnotic low-end roll, instrumental',
    bpm: 124,
    density: 0.5,
    brightness: 0.4,
    category: 'fokus',
    group: 'fokus-puls',
  },
  {
    id: 'deep-tech',
    host: 'Kuba',
    name: 'Deep Tech',
    tagline: 'Głęboki, równy tech bez ozdobników',
    prompt: 'deep tech house, rolling deep bassline, steady four-on-the-floor kick, restrained percussion, dark warm groove, instrumental',
    bpm: 124,
    density: 0.5,
    brightness: 0.35,
    category: 'fokus',
    group: 'fokus-puls',
  },
  {
    id: 'dub-techno',
    host: 'Rafał',
    name: 'Dub Techno',
    tagline: 'Akordy, które wracają echem',
    prompt: 'dub techno, deep echoing chords, washed out delay, soft kick, spacious hypnotic low end, instrumental',
    bpm: 122,
    density: 0.4,
    brightness: 0.3,
    category: 'fokus',
    group: 'fokus-puls',
  },
  {
    id: 'detroit-techno',
    host: 'Igor',
    name: 'Detroit Techno',
    tagline: 'Strunowe akordy i maszynowy puls',
    prompt: 'detroit techno, machine drum groove, string synth stabs, soulful minor chords, futurist club pulse, instrumental',
    bpm: 128,
    density: 0.55,
    brightness: 0.5,
    category: 'energia',
    group: 'klub-energia',
  },
  {
    id: 'deep-house',
    host: 'Zosia',
    name: 'Deep House',
    tagline: 'Ciepły bas i miękkie akordy',
    prompt: 'deep house, warm rounded bass, soft soulful chords, gentle swing hats, late night groove, instrumental',
    bpm: 122,
    density: 0.5,
    brightness: 0.45,
    category: 'chill',
    group: 'chill-noc',
  },
  {
    id: 'organic-house',
    host: 'Rafał',
    name: 'Organic House',
    tagline: 'Drewno, oddech i ciepły perkusjon',
    prompt: 'organic house, hand percussion, warm wooden texture, soft tribal groove, earthy deep bass, instrumental',
    bpm: 120,
    density: 0.5,
    brightness: 0.45,
    category: 'chill',
    group: 'etno-folk',
  },
  {
    id: 'tech-house',
    host: 'Max',
    name: 'Tech House',
    tagline: 'Równy parkiet, najszerzej trafia',
    prompt: 'tech house, driving groovy bassline, crisp claps, steady kick, club floor energy, instrumental',
    bpm: 126,
    density: 0.6,
    brightness: 0.55,
    category: 'energia',
    group: 'klub-energia',
  },
  {
    id: 'melodic-house',
    host: 'Lena',
    name: 'Melodic House',
    tagline: 'Długa melodia nad głębokim basem',
    prompt: 'melodic house, long evolving melody, deep warm bass, wide atmospheric pads, uplifting but restrained, instrumental',
    bpm: 122,
    density: 0.55,
    brightness: 0.6,
    category: 'energia',
    group: 'klub-energia',
  },
  {
    id: 'progressive-house',
    host: 'Max',
    name: 'Progressive House',
    tagline: 'Buduje się powoli i niesie',
    prompt: 'progressive house, gradual build, layered synths, rolling bass, wide euphoric peak, instrumental',
    bpm: 126,
    density: 0.6,
    brightness: 0.65,
    category: 'energia',
    group: 'klub-energia',
  },
  {
    id: 'drum-and-bass',
    host: 'Lena',
    name: 'Drum and Bass',
    tagline: 'Szybki łamany bit i głęboki bas',
    prompt: 'drum and bass, fast breakbeat, deep rolling sub bass, tight snare, dark energy, instrumental',
    bpm: 174,
    density: 0.7,
    brightness: 0.5,
    category: 'energia',
    group: 'klub-energia',
  },
  {
    id: 'trance',
    host: 'Zosia',
    name: 'Trance',
    tagline: 'Jasna melodia i równy galop',
    prompt: 'trance, bright rolling bassline, supersaw melody, steady kick, euphoric lift, instrumental',
    bpm: 138,
    density: 0.65,
    brightness: 0.75,
    category: 'energia',
    group: 'klub-energia',
  },
  {
    id: 'afro-house',
    host: 'Tadek',
    name: 'Afro House',
    tagline: 'Perkusja, ciepło i taneczny oddech',
    prompt: 'afro house, syncopated percussion, warm marimba, deep groovy bass, sunny dancefloor, instrumental',
    bpm: 122,
    density: 0.6,
    brightness: 0.6,
    category: 'energia',
    group: 'etno-folk',
  },
  {
    id: 'deep-ambient',
    host: 'Ida',
    name: 'Głęboki Ambient',
    tagline: 'Bez perkusji, medytacyjna przestrzeń',
    prompt: 'pure deep ambient soundscape, weightless evolving drone, warm tape texture, gentle meditative space, floating modular chords, instrumental',
    bpm: 60,
    density: 0.2,
    brightness: 0.25,
    category: 'chill',
    group: 'chill-noc',
  },
  {
    id: 'poranna-kawa',
    host: 'Zosia',
    name: 'Poranna Kawa',
    tagline: 'Słoneczny, ciepły deep house',
    prompt: 'bright uplifting deep house, warm chords, crisp hi-hats, sunny morning groove, instrumental',
    bpm: 120,
    density: 0.55,
    brightness: 0.65,
    category: 'energia',
    group: 'chill-noc',
  },
  {
    id: 'liquid-dnb',
    host: 'Lena',
    name: 'Liquid DnB',
    tagline: 'Płynne, ciepłe połamane bity i głęboki bas',
    prompt: 'liquid drum and bass, rolling atmospheric breakbeat, warm deep sub bass, lush soulful pads, smooth liquid vibes, instrumental',
    bpm: 174,
    density: 0.6,
    brightness: 0.55,
    category: 'energia',
    group: 'klub-energia',
  },
  {
    id: 'groove-funk',
    host: 'Tadek',
    name: 'Neo Funk',
    tagline: 'Bujający bas, vintage gitara i groove',
    prompt: 'infectious neo funk groove, bouncy slap bassline, tight rhythm guitar chops, warm vintage clavinet, upbeat soulful strut, instrumental',
    bpm: 112,
    density: 0.65,
    brightness: 0.6,
    category: 'energia',
    group: 'chill-noc',
  },
  {
    id: 'club-dance',
    host: 'Max',
    name: 'Klubowy Dance',
    tagline: 'Sprężysty tech-house i parkietowa energia',
    prompt: 'energetic club dance, pumping modern tech house groove, tight groovy bassline, crisp snappy claps, euphoric uplifting vibe, instrumental',
    bpm: 128,
    density: 0.65,
    brightness: 0.65,
    category: 'energia',
    group: 'klub-energia',
  },
  {
    id: 'minimal-techno',
    host: 'Igor',
    name: 'Minimal Techno',
    tagline: 'Hipnotyczny, precyzyjny klubowy puls',
    prompt: 'hypnotic minimal techno, rolling sub bass, tight percussion, subtle dub stabs, deep club groove, instrumental',
    bpm: 126,
    density: 0.55,
    brightness: 0.4,
    category: 'energia',
    group: 'fokus-puls',
  },
  {
    id: 'raw-techno',
    host: 'Wiktor',
    name: 'Raw Techno',
    tagline: 'Surowa przesterowana stopa 909 i ciemny warehouse groove',
    prompt: 'Raw warehouse techno, 138 BPM, overdriven analog 909 kickdrum, dark industrial rumble sub-bass, metallic percussive loops, sidechained vinyl stabs, hypnotic relentless groove, no melodic synth leads, instrumental',
    bpm: 138,
    density: 0.8,
    brightness: 0.35,
    category: 'energia',
    group: 'techno-rave',
  },
  {
    id: 'stoa',
    host: 'Marek',
    name: 'Stoa',
    tagline: 'Wiolonczela, fortepian i spokój stoików',
    prompt: 'calm contemplative neoclassical ambient, slow solo cello and soft felt piano, warm string drones, sparse and dignified, reflective stoic mood, instrumental',
    bpm: 66,
    density: 0.25,
    brightness: 0.3,
    category: 'chill',
    group: 'klasyka-instrumentalna',
  },
  {
    id: 'warm-jazz',
    host: 'Helena',
    name: 'Nocny Jazz',
    tagline: 'Miotełki, ciepły kontrabas i Rhodes',
    prompt: 'smooth night jazz lounge, soft brushed drums, acoustic upright bass, mellow Fender Rhodes chords, warm gentle trumpet nuances, instrumental',
    bpm: 86,
    density: 0.45,
    brightness: 0.4,
    category: 'noc',
    group: 'chill-noc',
  },
  {
    id: 'trip-hop',
    host: 'Marta',
    name: 'Trip-hop Wieczór',
    tagline: 'Leniwy winylowy dół w stylu Bristolu',
    prompt: 'trip-hop downtempo, dusty vinyl drums, deep sub bass, moody Rhodes, late evening, instrumental',
    bpm: 92,
    density: 0.4,
    brightness: 0.3,
    category: 'noc',
    group: 'chill-noc',
  },
  {
    id: 'nocny-dub',
    host: 'Szymon',
    name: 'Nocny Dub',
    tagline: 'Przestrzenne akordy i głęboki oddech',
    prompt: 'ambient dub, sparse soft percussion, deep warm pads, night drive, instrumental',
    bpm: 84,
    density: 0.25,
    brightness: 0.2,
    category: 'noc',
    group: 'chill-noc',
  },
  // --- Nowe stacje: Synth, Klasyka, Etno ---
  {
    id: 'stranger-synth',
    host: 'Igor',
    name: 'Stranger Synth',
    tagline: 'Analogowe arpeggia lat 80. i mroczny puls',
    prompt: '1980s dark analog synthwave, pulsing Roland Juno arpeggio, deep Moog bass drone, retro gated reverb snare, mysterious sci-fi tension inspired by Stranger Things soundtrack, instrumental',
    bpm: 108,
    density: 0.55,
    brightness: 0.45,
    category: 'noc',
    group: 'synth-filmowa',
  },
  {
    id: 'muzyka-filmowa',
    host: 'Marek',
    name: 'Muzyka Filmowa',
    tagline: 'Szerokie orkiestrowe pejzaże i napięcie kina',
    prompt: 'cinematic film score, sweeping string orchestra, deep brass swells, subtle modern hybrid synth pulse, emotional widescreen soundtrack, instrumental',
    bpm: 88,
    density: 0.5,
    brightness: 0.45,
    category: 'chill',
    group: 'synth-filmowa',
  },
  {
    id: 'cyber-noir',
    host: 'Wiktor',
    name: 'Cyber Noir',
    tagline: 'Deszczowy neon, Vangelisowe pady i wolny bas',
    prompt: 'cyberpunk noir soundtrack, rain-soaked analog brass pads, slow heavy synth bass, atmospheric reverb, blade runner style nocturnal synth, instrumental',
    bpm: 94,
    density: 0.4,
    brightness: 0.35,
    category: 'noc',
    group: 'synth-filmowa',
  },
  {
    id: 'muzyka-klasyczna',
    host: 'Helena',
    name: 'Muzyka Klasyczna',
    tagline: 'Kameralne smyczki, fortepian i harmonia',
    prompt: 'classical chamber music, expressive string quartet, warm concert grand piano, graceful counterpoint, noble acoustic concert hall reverb, instrumental',
    bpm: 76,
    density: 0.4,
    brightness: 0.45,
    category: 'fokus',
    group: 'klasyka-instrumentalna',
  },
  {
    id: 'instrumentalna-akustyczna',
    host: 'Ida',
    name: 'Instrumentalna Akustyczna',
    tagline: 'Gitara fingerstyle, ciepłe drewno i cisza',
    prompt: 'intimate acoustic instrumental, warm fingerstyle nylon and steel string guitar, soft upright bass, delicate brushed percussion, organic studio warmth, instrumental',
    bpm: 90,
    density: 0.35,
    brightness: 0.45,
    category: 'chill',
    group: 'klasyka-instrumentalna',
  },
  {
    id: 'etno-world',
    host: 'Tadek',
    name: 'Etno i World',
    tagline: 'Tradycyjne instrumenty świata w głębokim rytmie',
    prompt: 'world ethnic fusion, hypnotic hand percussion, oud and kora melodies, warm duduk phrasing, deep organic bass pulse, desert and mountain horizon mood, instrumental',
    bpm: 104,
    density: 0.5,
    brightness: 0.5,
    category: 'chill',
    group: 'etno-folk',
  },
  {
    id: 'slowianski-folk',
    host: 'Marta',
    name: 'Słowiański Folk',
    tagline: 'Suka biłgorajska, bęben obręczowy i leśny trans',
    prompt: 'modern Slavic folk instrumental, traditional fiddle and suka strings, deep frame drum rhythm, wooden flute overtones, mystical forest atmosphere, earthy acoustic groove, instrumental',
    bpm: 106,
    density: 0.5,
    brightness: 0.45,
    category: 'energia',
    group: 'etno-folk',
  },
  ...EXTRA_STATIONS,
];

export const DEFAULT_STATION_ID = 'dos-groove';

let runtimeGroups: MusicGroup[] = MUSIC_GROUPS.map((g) => ({ ...g, stations: [...g.stations] }));
let runtimeStations: Station[] = STATIONS.map((s) => ({ ...s }));

export function getActiveGroups(): MusicGroup[] {
  return runtimeGroups;
}

export function getActiveStations(): Station[] {
  return runtimeStations;
}

export function groupById(id: string | null | undefined): MusicGroup | undefined {
  if (!id) return undefined;
  return runtimeGroups.find((g) => g.id === id) ?? MUSIC_GROUPS.find((g) => g.id === id);
}

export function stationsForGroup(groupId: MusicGroupId | string): Station[] {
  const grp = groupById(groupId);
  const byGroupField = runtimeStations.filter((s) => s.group === groupId && s.enabled !== false);
  if (!grp) return byGroupField;
  const ordered: Station[] = [];
  for (const sid of grp.stations) {
    const found = runtimeStations.find((s) => s.id === sid && s.enabled !== false);
    if (found && !ordered.some((o) => o.id === found.id)) {
      ordered.push(found);
    }
  }
  for (const s of byGroupField) {
    if (!ordered.some((o) => o.id === s.id)) {
      ordered.push(s);
    }
  }
  return ordered;
}

export function nextStationInGroup(groupId: MusicGroupId | string, currentStationId: string): Station {
  const list = stationsForGroup(groupId);
  if (list.length === 0) return stationById(currentStationId);
  const idx = list.findIndex((s) => s.id === currentStationId);
  return list[(idx + 1) % list.length];
}

export interface CatalogPayload {
  groups?: Array<{
    id: string;
    name?: string;
    tagline?: string;
    color?: string;
    stations?: string[];
  }>;
  stations?: Array<Partial<Station> & { id: string }>;
}

/**
 * Merge dynamic catalog from GET /radio-api/catalog into the runtime station/group list.
 * Falls back cleanly to static MUSIC_GROUPS + STATIONS if payload is empty or invalid.
 */
export function applyCatalog(payload: CatalogPayload | null | undefined): {
  groups: MusicGroup[];
  stations: Station[];
} {
  if (!payload || (!Array.isArray(payload.stations) && !Array.isArray(payload.groups))) {
    runtimeGroups = MUSIC_GROUPS.map((g) => ({ ...g, stations: [...g.stations] }));
    runtimeStations = STATIONS.map((s) => ({ ...s }));
    return { groups: runtimeGroups, stations: runtimeStations };
  }

  const disabledIds = new Set<string>();
  const stationMap = new Map<string, Station>();
  for (const base of STATIONS) {
    stationMap.set(base.id, { ...base });
  }

  if (Array.isArray(payload.stations)) {
    for (const raw of payload.stations) {
      if (!raw || typeof raw.id !== 'string') continue;
      if (raw.enabled === false) {
        disabledIds.add(raw.id);
        stationMap.delete(raw.id);
        continue;
      }
      const existing = stationMap.get(raw.id);
      const groupId = (raw.group ?? existing?.group ?? 'fokus-puls') as MusicGroupId;
      stationMap.set(raw.id, {
        id: raw.id,
        name: raw.name ?? existing?.name ?? raw.id,
        tagline: raw.tagline ?? existing?.tagline ?? '',
        prompt: raw.prompt ?? existing?.prompt ?? 'instrumental electronic music',
        bpm: typeof raw.bpm === 'number' ? raw.bpm : (existing?.bpm ?? 120),
        density: typeof raw.density === 'number' ? raw.density : (existing?.density ?? 0.5),
        brightness: typeof raw.brightness === 'number' ? raw.brightness : (existing?.brightness ?? 0.5),
        category: raw.category ?? existing?.category ?? 'fokus',
        group: groupId,
        host: raw.host ?? existing?.host ?? 'Kuba',
        enabled: true,
      });
    }
  }

  const mergedStations = Array.from(stationMap.values());
  const groupMap = new Map<string, MusicGroup>();
  for (const g of MUSIC_GROUPS) {
    groupMap.set(g.id, {
      ...g,
      stations: g.stations.filter((sid) => !disabledIds.has(sid) && stationMap.has(sid)),
    });
  }

  if (Array.isArray(payload.groups)) {
    for (const rawG of payload.groups) {
      if (!rawG || typeof rawG.id !== 'string') continue;
      const base = groupMap.get(rawG.id);
      const rawStationIds = Array.isArray(rawG.stations) ? rawG.stations : (base?.stations ?? []);
      const validIds = rawStationIds.filter((sid) => !disabledIds.has(sid) && stationMap.has(sid));
      groupMap.set(rawG.id as MusicGroupId, {
        id: rawG.id as MusicGroupId,
        name: rawG.name ?? base?.name ?? rawG.id,
        tagline: rawG.tagline ?? base?.tagline ?? '',
        color: rawG.color ?? base?.color ?? '#2be38b',
        stations: validIds,
      });
    }
  }

  for (const st of mergedStations) {
    if (st.group && groupMap.has(st.group)) {
      const grp = groupMap.get(st.group)!;
      if (!grp.stations.includes(st.id)) {
        grp.stations.push(st.id);
      }
    }
  }

  runtimeStations = mergedStations.length > 0 ? mergedStations : STATIONS.map((s) => ({ ...s }));
  runtimeGroups = Array.from(groupMap.values());
  return { groups: runtimeGroups, stations: runtimeStations };
}

export interface AutoRamowkaSlot {
  id: string;
  label: string;
  hours: string;
  groupId: MusicGroupId;
  stationId: string;
  host: string;
  newsIntervalMinutes: 20;
  spotId: string;
  spotTitle: string;
  ctaLabel: string;
  ctaUrl: string;
}

const AUTO_RAMOWKA_SPOTS: Array<{ id: string; title: string }> = [
  { id: 'zrobimy-ai', title: 'zrobi.my — Automatyzacja AI i agenci głosowi dla firm' },
  { id: 'dosradio-ramowka', title: 'AmbiRadio — Auto-Ramówka 24/7 i własne pasma muzyczne' },
  { id: 'zrobimy-wdrozenia', title: 'zrobi.my — Dedykowane wdrożenia AI w 14 dni' },
];

export function computeAutoRamowkaSlot(now: Date = new Date()): AutoRamowkaSlot {
  let hour = now.getHours();
  try {
    const parts = new Intl.DateTimeFormat('pl-PL', {
      timeZone: 'Europe/Warsaw',
      hour: 'numeric',
      hour12: false,
    }).formatToParts(now);
    const hPart = parts.find((p) => p.type === 'hour');
    if (hPart) {
      const parsed = Number.parseInt(hPart.value, 10);
      if (Number.isFinite(parsed)) hour = parsed % 24;
    }
  } catch {
    // Fallback to local hour
  }

  const slotIndex = Math.floor((hour * 60 + now.getMinutes()) / 20) % AUTO_RAMOWKA_SPOTS.length;
  const spot = AUTO_RAMOWKA_SPOTS[slotIndex];

  if (hour >= 6 && hour < 9) {
    const st = stationById('poranna-kawa');
    return {
      id: 'poranny-rozruch',
      label: 'Poranny Rozruch',
      hours: '06:00–09:00',
      groupId: 'fokus-puls',
      stationId: st.id,
      host: st.host ?? 'Zosia',
      newsIntervalMinutes: 20,
      spotId: spot.id,
      spotTitle: spot.title,
      ctaLabel: 'Zamów wdrożenie AI · zrobi.my',
      ctaUrl: 'https://zrobi.my?utm_source=ambiradio&utm_medium=ramowka',
    };
  }
  if (hour >= 9 && hour < 13) {
    const st = stationById('dos-groove');
    return {
      id: 'gleboki-fokus',
      label: 'Głęboki Fokus',
      hours: '09:00–13:00',
      groupId: 'fokus-puls',
      stationId: st.id,
      host: st.host ?? 'Kuba',
      newsIntervalMinutes: 20,
      spotId: spot.id,
      spotTitle: spot.title,
      ctaLabel: 'Zamów wdrożenie AI · zrobi.my',
      ctaUrl: 'https://zrobi.my?utm_source=ambiradio&utm_medium=ramowka',
    };
  }
  if (hour >= 13 && hour < 17) {
    const st = stationById('stranger-synth');
    return {
      id: 'popoludniowy-puls',
      label: 'Popołudniowy Puls',
      hours: '13:00–17:00',
      groupId: 'synth-filmowa',
      stationId: st.id,
      host: st.host ?? 'Igor',
      newsIntervalMinutes: 20,
      spotId: spot.id,
      spotTitle: spot.title,
      ctaLabel: 'Zamów wdrożenie AI · zrobi.my',
      ctaUrl: 'https://zrobi.my?utm_source=ambiradio&utm_medium=ramowka',
    };
  }
  if (hour >= 17 && hour < 20) {
    const st = stationById('organic-house');
    return {
      id: 'zlota-godzina',
      label: 'Złota Godzina',
      hours: '17:00–20:00',
      groupId: 'etno-folk',
      stationId: st.id,
      host: st.host ?? 'Rafał',
      newsIntervalMinutes: 20,
      spotId: spot.id,
      spotTitle: spot.title,
      ctaLabel: 'Zamów wdrożenie AI · zrobi.my',
      ctaUrl: 'https://zrobi.my?utm_source=ambiradio&utm_medium=ramowka',
    };
  }
  if (hour >= 20 && hour < 24) {
    const st = stationById('melodic-house');
    return {
      id: 'wieczorny-klub-synth',
      label: 'Wieczorny Klub & Synth',
      hours: '20:00–24:00',
      groupId: 'klub-energia',
      stationId: st.id,
      host: st.host ?? 'Lena',
      newsIntervalMinutes: 20,
      spotId: spot.id,
      spotTitle: spot.title,
      ctaLabel: 'Zamów wdrożenie AI · zrobi.my',
      ctaUrl: 'https://zrobi.my?utm_source=ambiradio&utm_medium=ramowka',
    };
  }
  const st = stationById('warm-jazz');
  return {
    id: 'nocna-cisza',
    label: 'Nocna Cisza',
    hours: '00:00–06:00',
    groupId: 'chill-noc',
    stationId: st.id,
    host: st.host ?? 'Helena',
    newsIntervalMinutes: 20,
    spotId: spot.id,
    spotTitle: spot.title,
    ctaLabel: 'Zamów wdrożenie AI · zrobi.my',
    ctaUrl: 'https://zrobi.my?utm_source=ambiradio&utm_medium=ramowka',
  };
}

export function stationById(id: string | null | undefined): Station {
  return (
    runtimeStations.find((station) => station.id === id) ??
    STATIONS.find((station) => station.id === id) ??
    runtimeStations[0] ??
    STATIONS[0]
  );
}

/** Station whose host speaks for a custom mood station (custom stations have no host of their own). */
export function hostStationId(station: Station): string {
  return isPresetStation(station) ? station.id : DEFAULT_STATION_ID;
}

export function isPresetStation(station: Station): boolean {
  return (
    runtimeStations.some((preset) => preset.id === station.id) ||
    STATIONS.some((preset) => preset.id === station.id)
  );
}

/** Server-side whitelisted voices for the spoken time. */
export type HostVoice = 'Puck' | 'Kore' | 'Charon';

export function hostVoiceForHour(hour: number): HostVoice {
  if (hour >= 6 && hour < 10) return 'Puck';
  if (hour >= 10 && hour < 18) return 'Kore';
  return 'Charon';
}
