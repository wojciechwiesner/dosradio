import { describe, it, expect } from 'vitest';
import { AIRED_KEY, AiredStore, MAX_AIRED_IDS_PER_DAY, localDay, type AiredRemote } from '../src/radio/airedStore';
import { pickNextStory, type QueuedStory } from '../src/radio/newsQueue';

function memoryStorage() {
  const data = new Map<string, string>();
  return { data, getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); } };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('AiredStore', () => {
  it('remembers aired ids across a reload within the same day', () => {
    const storage = memoryStorage();
    const first = new AiredStore(storage, () => new Date(2026, 10, 7, 10));
    first.add('s1');
    first.add('s2');
    const reloaded = new AiredStore(storage, () => new Date(2026, 10, 7, 18));
    expect(reloaded.has('s1')).toBe(true);
    expect(reloaded.has('s2')).toBe(true);
    expect(reloaded.has('s3')).toBe(false);
  });

  it('resets at local midnight', () => {
    const storage = memoryStorage();
    let now = new Date(2026, 10, 7, 23, 59);
    const store = new AiredStore(storage, () => now);
    store.add('s1');
    now = new Date(2026, 10, 8, 0, 1);
    expect(store.has('s1')).toBe(false);
    expect(JSON.parse(storage.data.get(AIRED_KEY)!)).toEqual({ day: '2026-11-08', ids: [] });
    expect(new AiredStore(storage, () => now).has('s1')).toBe(false);
  });

  it('ignores corrupted or stale storage', () => {
    const storage = memoryStorage();
    storage.setItem(AIRED_KEY, '{nope');
    expect(new AiredStore(storage).ids.size).toBe(0);
    storage.setItem(AIRED_KEY, JSON.stringify({ day: '2001-01-01', ids: ['old'] }));
    expect(new AiredStore(storage).has('old')).toBe(false);
  });

  it('caps the set at 500 ids per day, keeping the newest', () => {
    const store = new AiredStore(memoryStorage());
    for (let index = 0; index < MAX_AIRED_IDS_PER_DAY + 5; index++) store.add(`s${index}`);
    expect(store.ids.size).toBe(MAX_AIRED_IDS_PER_DAY);
    expect(store.has('s0')).toBe(false);
    expect(store.has(`s${MAX_AIRED_IDS_PER_DAY + 4}`)).toBe(true);
  });

  it('formats the local day', () => {
    expect(localDay(new Date(2026, 0, 5, 23, 59))).toBe('2026-01-05');
  });
});

describe('AiredStore server sync', () => {
  const today = () => localDay(new Date());

  it('pull merges what other devices aired', async () => {
    const remote: AiredRemote = { fetchIds: async () => ['other'], pushIds: async () => null };
    const store = new AiredStore(memoryStorage(), () => new Date(), remote);
    store.add('mine');
    await store.pull();
    expect(store.has('other')).toBe(true);
    expect(store.has('mine')).toBe(true);
  });

  it('add pushes to the server and merges the answer', async () => {
    const pushed: Array<[string, string[]]> = [];
    const remote: AiredRemote = {
      fetchIds: async () => null,
      pushIds: async (day, ids) => { pushed.push([day, ids]); return [...ids, 'from-server']; },
    };
    const store = new AiredStore(memoryStorage(), () => new Date(), remote);
    store.add('s1');
    await flush();
    expect(pushed).toEqual([[today(), ['s1']]]);
    expect(store.has('from-server')).toBe(true);
  });

  it('never throws or blocks when the server fails', async () => {
    const remote: AiredRemote = {
      fetchIds: async () => { throw new Error('offline'); },
      pushIds: async () => { throw new Error('offline'); },
    };
    const store = new AiredStore(memoryStorage(), () => new Date(), remote);
    store.add('s1');
    await store.pull();
    await flush();
    expect(store.has('s1')).toBe(true);
  });

  it('works without a remote (guest) and can be attached later', async () => {
    const store = new AiredStore(memoryStorage());
    store.add('s1');
    await store.pull();
    store.setRemote({ fetchIds: async () => ['s2'], pushIds: async () => null });
    await store.pull();
    expect(store.has('s2')).toBe(true);
  });
});

describe('pickNextStory never restarts the cycle', () => {
  const stories: QueuedStory[] = ['a', 'b'].map((id) => ({
    id, title: id, radio_text: id, source_url: '', confirmed: true, category: 'ai', audio_ready: false,
  }));

  it('returns null once everything aired today and leaves the aired set intact', () => {
    const aired = new Set(['a', 'b']);
    expect(pickNextStory(stories, aired)).toBeNull();
    expect(aired.size).toBe(2);
  });
});
