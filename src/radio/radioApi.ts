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
}

export class TrialEndedError extends Error {
  constructor() { super('Darmowe 10 minut minęło. Załóż konto, żeby słuchać dalej.'); }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { credentials: 'same-origin', ...init });
  if (response.status === 402) throw new TrialEndedError();
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

export const radioApi = {
  me: () => request<AccessState>('/radio-api/me'),
  startTrial: () => postJson<AccessState>('/radio-api/trial/start'),
  register: (email: string, password: string) => postJson<{ email: string }>('/radio-api/register', { email, password }),
  login: (email: string, password: string) => postJson<{ email: string }>('/radio-api/login', { email, password }),
  logout: () => postJson<{ ok: boolean }>('/radio-api/logout'),
  news: (categories: NewsCategory[]) =>
    request<{ categories: CategoryNews[] }>(`/radio-api/news?cats=${categories.join(',')}`),
  mood: (description: string) =>
    postJson<{ id: string; name: string; tagline: string; prompt: string; bpm: number; density: number; brightness: number }>('/radio-api/mood', { mood: description }),
  async audio(path: string): Promise<ArrayBuffer> {
    const response = await fetch(path, { credentials: 'same-origin' });
    if (response.status === 402) throw new TrialEndedError();
    if (!response.ok) throw new Error(`Audio HTTP ${response.status}`);
    return response.arrayBuffer();
  },
};
