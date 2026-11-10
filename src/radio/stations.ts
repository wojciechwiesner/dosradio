/**
 * DOS Radio music stations across moods and time-of-day host voices.
 * "DOS Groove" is the original prompt, preserved verbatim.
 */

export interface Station {
  id: string;
  name: string;
  tagline: string;
  prompt: string;
  bpm: number;
  density: number;
  brightness: number;
  category?: 'fokus' | 'energia' | 'chill' | 'noc';
  /** Host name; voice and manner live on the server (dosradio-api/app/hosts.py). */
  host?: string;
}

export const NEGATIVE_PROMPT = 'vocals, singing, harsh noise, screeching leads, distortion';

export const STATIONS: Station[] = [
  // --- Klasyki DOS Radio ---
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
  },
  {
    id: 'raw-techno',
    host: 'Wiktor',
    name: 'Mocne Techno',
    tagline: 'Ciężki industrialny warehouse groove',
    prompt: 'heavy driving raw techno, dark industrial warehouse groove, thunderous kick, metallic percussion, hypnotic modular rumble, instrumental',
    bpm: 134,
    density: 0.7,
    brightness: 0.4,
    category: 'energia',
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
  },
];

export const DEFAULT_STATION_ID = 'dos-groove';

export function stationById(id: string | null | undefined): Station {
  return STATIONS.find((station) => station.id === id) ?? STATIONS[0];
}

/** Station whose host speaks for a custom mood station (custom stations have no host of their own). */
export function hostStationId(station: Station): string {
  return STATIONS.some((preset) => preset.id === station.id) ? station.id : DEFAULT_STATION_ID;
}

export function isPresetStation(station: Station): boolean {
  return STATIONS.some((preset) => preset.id === station.id);
}

/** Server-side whitelisted voices for the spoken time. */
export type HostVoice = 'Puck' | 'Kore' | 'Charon';

export function hostVoiceForHour(hour: number): HostVoice {
  if (hour >= 6 && hour < 10) return 'Puck';
  if (hour >= 10 && hour < 18) return 'Kore';
  return 'Charon';
}
