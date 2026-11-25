// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { classicShortcut, stepStation } from '../src/ui/keyboard';

const key = (k: string, target: EventTarget | null = document.body, mods: Partial<KeyboardEvent> = {}) =>
  ({ key: k, target, altKey: false, ctrlKey: false, metaKey: false, ...mods }) as KeyboardEvent;

describe('stepStation', () => {
  const ids = ['a', 'b', 'c'];
  it('moves forward and back, wrapping at both ends', () => {
    expect(stepStation(ids, 'a', 1)).toBe('b');
    expect(stepStation(ids, 'c', 1)).toBe('a');
    expect(stepStation(ids, 'a', -1)).toBe('c');
  });
  it('starts from the first station when the current one is not listed', () => {
    expect(stepStation(ids, 'zzz', 1)).toBe('a');
    expect(stepStation(ids, 'zzz', -1)).toBe('c');
  });
  it('returns null for an empty list', () => {
    expect(stepStation([], 'a', 1)).toBeNull();
  });
});

describe('classicShortcut', () => {
  it('maps Space to play/pause and arrows to stations', () => {
    expect(classicShortcut(key(' '), false)).toBe('toggle');
    expect(classicShortcut(key('ArrowRight'), false)).toBe('next');
    expect(classicShortcut(key('ArrowLeft'), false)).toBe('prev');
    expect(classicShortcut(key('a'), false)).toBeNull();
  });

  it('stays out of the way while a dialog is open or a modifier is held', () => {
    expect(classicShortcut(key(' '), true)).toBeNull();
    expect(classicShortcut(key('ArrowRight', document.body, { metaKey: true }), false)).toBeNull();
    expect(classicShortcut(key('ArrowLeft', document.body, { altKey: true }), false)).toBeNull();
  });

  it('never steals keys from form fields', () => {
    for (const tag of ['input', 'textarea', 'select']) {
      const field = document.createElement(tag);
      expect(classicShortcut(key(' ', field), false)).toBeNull();
      expect(classicShortcut(key('ArrowRight', field), false)).toBeNull();
    }
  });

  it('lets Space activate a focused button natively, but arrows still switch stations', () => {
    const button = document.createElement('button');
    expect(classicShortcut(key(' ', button), false)).toBeNull();
    expect(classicShortcut(key('ArrowRight', button), false)).toBe('next');
  });
});
