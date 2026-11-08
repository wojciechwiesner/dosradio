import { describe, expect, it } from 'vitest';
import { summarizeBatch, type BatchResult } from '../src/ui/pill';

describe('summarizeBatch', () => {
  it('counts accepted, duplicates and errors with the failing links', () => {
    const results: BatchResult[] = [
      { url: 'https://youtu.be/aaaaaaaaaaa', video_id: 'aaaaaaaaaaa', status: 'queued', id: '1' },
      { url: 'https://youtu.be/aaaaaaaaaaa', video_id: 'aaaaaaaaaaa', status: 'duplicate' },
      { url: 'https://youtu.be/bbbbbbbbbbb', video_id: 'bbbbbbbbbbb', status: 'ready', id: '2' },
      { url: 'https://evil.example/x', video_id: null, status: 'error', error: 'To nie YouTube' },
    ];
    expect(summarizeBatch(results)).toBe(
      'Dodano 2, pominięto duplikaty: 1, błędy: 1 (https://evil.example/x). Pigułki robią się po kolei i trafią do listy Moje pigułki.',
    );
  });

  it('omits empty sections', () => {
    const results: BatchResult[] = [{ url: 'https://youtu.be/aaaaaaaaaaa', video_id: 'aaaaaaaaaaa', status: 'queued', id: '1' }];
    expect(summarizeBatch(results)).toBe('Dodano 1. Pigułki robią się po kolei i trafią do listy Moje pigułki.');
  });
});
