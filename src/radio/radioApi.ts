/**
 * Thin client for the DOS Radio API (same origin). The Gemini key lives only on the server.
 */
import type { CategoryNews, NewsCategory } from './newsQueue';

export interface AccessState {
  allowed: boolean;
  registered: boolean;
  email: string | null;
  trial_started: boolean;
  trial_remaining: number;
  plus: boolean;
}

export interface NewsPreferences {
  keywords: string[];
  rss_feeds: string[];
  updated_at: number;
}

export interface DigestStory {
  id: string;
  title: string;
  radio_text: string;
  source_url: string;
  confirmed: boolean;
  category: string;
  audio_ready: boolean;
}

export interface NewsDigest {
  personal: boolean;
  fallback: boolean;
  stories: DigestStory[];
}

export interface PodcastPart {
  kind: 'voice' | 'music';
  url: string;
}

export interface PodcastManifest {
  id: string;
  topic: string;
  title: string;
  created_at: number;
  hosts: string[];
  parts: PodcastPart[];
}

export interface HostClips {
  jingles: string[];
  chatter: string[];
}

export class TrialEndedError extends Error {
  constructor() { super('Darmowa godzina minęła. Załóż konto, żeby słuchać dalej.'); }
}

const isPlusPath = (path: string): boolean => path.includes('/radio-api/plus/');

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { credentials: 'same-origin', ...init });
  if (response.status === 402 && !isPlusPath(path)) throw new TrialEndedError();
  if (!response.ok) {
    let detail = `HTTP ${response.status}`;
    try {
      const body = (await response.json()) as { detail?: unknown };
      if (typeof body.detail === 'string') detail = body.detail;
      else if (Array.isArray(body.detail)) detail = 'Sprawdź e-mail i hasło (min. 8 znaków).';
    } catch { /* non-JSON error body */ }
    throw new Error(detail);
  }
  return (await response.json()) as T;
}

const postJson = <T>(path: string, body?: unknown) =>
  request<T>(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });

const putJson = <T>(path: string, body: unknown) =>
  request<T>(path, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

async function fetchAudio(path: string): Promise<ArrayBuffer> {
  const response = await fetch(path, { credentials: 'same-origin' });
  if (response.status === 402 && !isPlusPath(path)) throw new TrialEndedError();
  if (!response.ok) {
    let detail = `Audio HTTP ${response.status}`;
    try {
      const body = (await response.json()) as { detail?: unknown };
      if (typeof body.detail === 'string') detail = body.detail;
    } catch { /* non-JSON error body */ }
    throw new Error(detail);
  }
  return response.arrayBuffer();
}

export const radioApi = {
  me: () => request<AccessState>('/radio-api/me'),
  startTrial: () => postJson<AccessState>('/radio-api/trial/start'),
  register: (email: string, password: string) => postJson<{ email: string; pending_verification: boolean }>('/radio-api/register', { email, password }),
  login: (email: string, password: string) => postJson<{ email: string }>('/radio-api/login', { email, password }),
  verify: (token: string) => postJson<{ email: string; verified: boolean }>('/radio-api/verify', { token }),
  resendVerification: (email: string, password: string) => postJson<{ ok: boolean; sent?: boolean }>('/radio-api/resend-verification', { email, password }),
  logout: () => postJson<{ ok: boolean }>('/radio-api/logout'),
  news: (categories: NewsCategory[]) =>
    request<{ categories: CategoryNews[] }>(`/radio-api/news?cats=${categories.join(',')}`),
  mood: (description: string) =>
    postJson<{ id: string; name: string; tagline: string; prompt: string; bpm: number; density: number; brightness: number }>('/radio-api/mood', { mood: description }),
  // --- DOS Radio Plus ---
  newsPreferences: () => request<NewsPreferences>('/radio-api/plus/news-preferences'),
  saveNewsPreferences: (keywords: string[], rssFeeds: string[]) =>
    putJson<NewsPreferences>('/radio-api/plus/news-preferences', { keywords, rss_feeds: rssFeeds }),
  newsDigest: () => request<NewsDigest>('/radio-api/plus/news-digest'),
  podcast: (topic?: string) => postJson<PodcastManifest>('/radio-api/plus/podcast', topic ? { topic } : {}),
  /** Host jingles and chatter for a station; null when the endpoint is missing or fails. */
  hostClips: async (stationId: string): Promise<HostClips | null> => {
    try {
      const response = await fetch(`/radio-api/host-clips/${encodeURIComponent(stationId)}`, { credentials: 'same-origin' });
      if (!response.ok) return null;
      const body = (await response.json()) as Partial<HostClips>;
      return { jingles: body.jingles ?? [], chatter: body.chatter ?? [] };
    } catch {
      return null;
    }
  },
  audio: fetchAudio,
};
