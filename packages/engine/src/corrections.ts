import type { Rng } from '@pentwin/shared';

/**
 * Markers placed in the text before layout. They are private-use characters, take no
 * space, and are removed again when the word is written.
 */
export const STRUCK = '';
export const RETRACE = '';

export interface CorrectionCounts {
  /** Words written wrongly, struck through and written again. */
  struck: number;
  /** Letters gone over a second time. */
  retraced: number;
}

/**
 * Only plain lowercase words of four letters or more are ever touched, optionally with
 * one trailing punctuation mark. That rule is what protects meaning: numbers, dates,
 * names and anything else capitalised, formulas, codes, e-mail addresses and
 * abbreviations all fail it and are written exactly once, exactly as given.
 */
const SAFE_WORD = /^([a-z]{4,})([.,;:!?]?)$/;

export const canCorrect = (word: string): boolean => SAFE_WORD.test(word);

/** A plausible slip of the pen for a word: two letters swapped, or a wrong letter early on. */
function slip(letters: string, rng: Rng): string {
  const swaps: number[] = [];
  for (let i = 1; i < letters.length - 1; i++) {
    if (letters[i] !== letters[i + 1]) swaps.push(i);
  }
  if (swaps.length > 0 && rng.next() < 0.6) {
    const i = rng.pick(swaps);
    // A writer notices right after the swapped pair and stops there.
    return letters.slice(0, i) + letters[i + 1] + letters[i];
  }
  // A false start: the first letters, then a wrong one.
  const keep = rng.int(2, Math.min(3, letters.length - 2));
  const others = [...new Set(letters)].filter((c) => c !== letters[keep]);
  return letters.slice(0, keep) + rng.pick(others);
}

/**
 * Adds occasional corrections to a text. `rate` is the chance, per eligible word, of
 * each kind of correction (0.02 means roughly one word in fifty struck out and one in
 * fifty with a letter retraced).
 *
 * The returned text contains every original word, unchanged and in order. A struck word
 * is an extra word placed before the correct one. Whitespace and line breaks are kept.
 */
export function addCorrections(
  text: string,
  rate: number,
  rng: Rng,
): { text: string; counts: CorrectionCounts } {
  const counts: CorrectionCounts = { struck: 0, retraced: 0 };
  if (rate <= 0) return { text, counts };

  let previousCorrected = false;
  const out = text.split(/(\s+)/).map((part) => {
    const match = SAFE_WORD.exec(part);
    // Never two corrections in a row: that reads as a staged mess, not a slip.
    if (!match || previousCorrected) {
      if (match || part.trim()) previousCorrected = false;
      return part;
    }
    const letters = match[1]!;
    const roll = rng.next();
    if (roll < rate) {
      counts.struck++;
      previousCorrected = true;
      return `${STRUCK}${slip(letters, rng)} ${part}`;
    }
    if (roll < rate * 2) {
      counts.retraced++;
      previousCorrected = true;
      const at = rng.int(0, letters.length - 1);
      return part.slice(0, at) + RETRACE + part.slice(at);
    }
    previousCorrected = false;
    return part;
  });
  return { text: out.join(''), counts };
}

/** Splits a laid-out word into its text and the correction markers it carried. */
export function readMarkers(word: string): { text: string; struck: boolean; retrace?: number } {
  const struck = word.startsWith(STRUCK);
  const body = struck ? word.slice(STRUCK.length) : word;
  const at = body.indexOf(RETRACE);
  if (at < 0) return { text: body, struck };
  return { text: body.slice(0, at) + body.slice(at + RETRACE.length), struck, retrace: at };
}
