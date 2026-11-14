/** Live Lyria RealTime helper wiring: proxy client and station prompt/config. Used when a station has no archive. */
import { GoogleGenAI } from '@google/genai';
import { LiveMusicHelper } from '../audio/LiveMusicHelper';
import type { MusicGenerationConfig, Prompt } from '../types';
import { NEGATIVE_PROMPT, type Station } from './stations';

const LYRIA_MODEL = 'lyria-realtime-exp';
const LYRIA_PROXY_BASE = '/radio-ws/lyria';
const PLACEHOLDER_KEY = 'server-side';

export function createLyriaHelper(musicBus: AudioNode): LiveMusicHelper {
  const ai = new GoogleGenAI({
    apiKey: PLACEHOLDER_KEY,
    httpOptions: { apiVersion: 'v1alpha', baseUrl: location.origin + LYRIA_PROXY_BASE },
  });
  const helper = new LiveMusicHelper(ai, LYRIA_MODEL);
  helper.extraDestination = musicBus;
  return helper;
}

export async function applyStationToHelper(helper: LiveMusicHelper, station: Station): Promise<void> {
  const prompts = new Map<string, Prompt>([
    ['mood', { promptId: 'mood', text: station.prompt, weight: 1.3, cc: 0, color: '#888' }],
    ['neg', { promptId: 'neg', text: NEGATIVE_PROMPT, weight: 0.25, cc: 0, color: '#444' }],
  ]);
  const config = {
    bpm: station.bpm,
    density: station.density,
    brightness: station.brightness,
    guidance: 4.0,
    temperature: 1.0,
  } as MusicGenerationConfig;
  await helper.setWeightedPrompts(prompts);
  await helper.setMusicGenerationConfig(config);
}
