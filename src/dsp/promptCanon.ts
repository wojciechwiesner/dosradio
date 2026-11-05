/**
 * Prompt canon filter (Techno Canon: no melodic leads in the mid range).
 *
 * Replaces the old reject-on-regex gate. Two properties matter:
 *  1. Negation-aware: "no melody", "zero melodies", "without arpeggios" are
 *     canon-COMPLIANT and must pass untouched.
 *  2. Rewrite, never silently drop: in `canon` mode a melodic request is
 *     rewritten into a canon-safe equivalent (vinyl stabs / raw percussion),
 *     and the caller gets a structured report it can surface in the UI.
 *
 * Pure functions only — no DOM, no audio. Covered by tests/promptCanon.test.ts.
 */

export type CanonMode = 'canon' | 'open';

export interface CanonResult {
  /** Text to send to the model. */
  text: string;
  /** 'pass' = untouched, 'rewritten' = melodic terms replaced. */
  verdict: 'pass' | 'rewritten';
  /** Melodic terms that were found and replaced (lower-case, as matched). */
  replaced: string[];
}

/**
 * Melodic terms with their canon-safe replacement. Order matters: longer
 * phrases first so "synth lead" wins over "lead".
 */
const MELODIC_REPLACEMENTS: ReadonlyArray<[RegExp, string]> = [
  [/\b(?:catchy|memorable)\s+(?:tunes?|hooks?)\b/i, 'chopped vinyl stab'],
  [/\b(?:piano|vocal|synth|flute|lead)\s+melod(?:y|ies|ic)\b/i, 'filtered vinyl chop'],
  [/\bmelodic\s+(?:leads?|lines?|synths?)\b/i, 'dub chord stab'],
  [/\bsynth\s+leads?\b/i, 'dub chord stab'],
  [/\barpeggi(?:o|os|ated|ator)\b/i, 'rolling percussion pattern'],
  [/\bsupersaws?\b/i, 'short filtered stab'],
  [/\bflutes?\b/i, 'breathy noise texture'],
  [/\bmelod(?:y|ies|ic)\b/i, 'hypnotic stab'],
];

/** Words that negate or attenuate a melodic term when they appear shortly before it. */
const NEGATION = /\b(?:no|zero|without|non|avoid|minus|free\s+of|less|lacking|minimal|sparse|barely|hardly)\b[\s-]*(?:\w+[\s-]+){0,2}$/i;

/** Suffix negation right after the term: "melody-free", "melodyless". */
const SUFFIX_NEGATION = /^(?:-?free|-?less)\b/i;

/** True when the match at `index` is negated ("no melody", "melody-free"). */
function isNegated(text: string, index: number, matchLength: number): boolean {
  const before = text.slice(Math.max(0, index - 32), index);
  const after = text.slice(index + matchLength, index + matchLength + 6);
  return NEGATION.test(before) || SUFFIX_NEGATION.test(after);
}

/** Replace every non-negated occurrence of `pattern` in `text`. */
function replaceUnnegated(
  text: string,
  pattern: RegExp,
  replacement: string,
  replaced: string[],
): string {
  const global = new RegExp(pattern.source, 'gi');
  return text.replace(global, (match: string, ...rest: unknown[]) => {
    const offset = rest[rest.length - 2] as number;
    const source = rest[rest.length - 1] as string;
    if (isNegated(source, offset, match.length)) return match;
    replaced.push(match.toLowerCase());
    return replacement;
  });
}

/** Detect whether a prompt asks for melodic content (negation-aware). */
export function hasMelodicIntent(text: string): boolean {
  return applyCanon(text, 'canon').verdict === 'rewritten';
}

/**
 * Apply the canon to a single prompt text.
 * `open` mode (Play, genre presets like Trance) passes everything through.
 */
export function applyCanon(text: string, mode: CanonMode): CanonResult {
  if (mode === 'open') return { text, verdict: 'pass', replaced: [] };

  const replaced: string[] = [];
  let out = text;
  for (const [pattern, replacement] of MELODIC_REPLACEMENTS) {
    out = replaceUnnegated(out, pattern, replacement, replaced);
  }
  if (replaced.length === 0) return { text, verdict: 'pass', replaced };

  // Autocheck: rewritten text must itself be canon-clean (no loops, no leaks).
  const recheck: string[] = [];
  for (const [pattern] of MELODIC_REPLACEMENTS) replaceUnnegated(out, pattern, '', recheck);
  if (recheck.length > 0) {
    throw new Error(`promptCanon: rewrite left melodic terms: ${recheck.join(', ')}`);
  }
  return { text: out, verdict: 'rewritten', replaced };
}
