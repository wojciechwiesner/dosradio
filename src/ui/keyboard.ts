/** Classic view keyboard: Space = play/pause, ArrowLeft/ArrowRight = previous/next station. Pure, DOM-light. */

export type ClassicShortcut = 'toggle' | 'prev' | 'next';

const FIELD_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT']);
const NATIVE_SPACE_TAGS = new Set(['BUTTON', 'A', 'SUMMARY']);

/** The id one step away from `current` in `ids`, wrapping around; unknown `current` starts at an end. */
export function stepStation(ids: readonly string[], current: string, step: 1 | -1): string | null {
  if (!ids.length) return null;
  const index = ids.indexOf(current);
  if (index < 0) return step === 1 ? ids[0] : ids[ids.length - 1];
  return ids[(index + step + ids.length) % ids.length];
}

function isField(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return FIELD_TAGS.has(target.tagName) || (target as HTMLElement).isContentEditable;
}

/**
 * Which shortcut a keydown means, or null to leave the key alone.
 * `blocked` is true while a dialog or the Orbita overlay is open.
 */
export function classicShortcut(event: KeyboardEvent, blocked: boolean): ClassicShortcut | null {
  if (blocked || event.altKey || event.ctrlKey || event.metaKey) return null;
  if (isField(event.target)) return null;
  if (event.key === ' ' || event.key === 'Spacebar') {
    const el = event.target instanceof Element ? event.target : null;
    if (el && (NATIVE_SPACE_TAGS.has(el.tagName) || el.getAttribute('role') === 'button')) return null;
    return 'toggle';
  }
  if (event.key === 'ArrowRight') return 'next';
  if (event.key === 'ArrowLeft') return 'prev';
  return null;
}
