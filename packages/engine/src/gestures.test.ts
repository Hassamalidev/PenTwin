import { createRng } from '@pentwin/shared';
import { describe, expect, it } from 'vitest';
import type { Glyph } from './glyphs';
import { NO_JITTER, type JitterParams } from './jitter';
import { placeMarks } from './marks';
import { parsePath, pathBounds, type PathCommand } from './path';
import { PRESETS } from './presets';
import { renderText } from './render';
import { sceneToSvg } from './svg';
import { loadSampleBank } from './testing';
import { wholeLetters } from './writer';

/**
 * Dot drift, word tilt and joins: what the hand does between and after letters.
 */
const bank = loadSampleBank();
const base = { seed: 'gestures', pageSize: 'A5', lineHeight: 10, xHeight: 4 } as const;
const page = (text: string, jitter: JitterParams) =>
  renderText(text, bank, { ...base, jitter }).pages[0]!;

const parts = (path: readonly PathCommand[]): PathCommand[][] => {
  const out: PathCommand[][] = [];
  for (const c of path) {
    if (c.type === 'M' || out.length === 0) out.push([]);
    out.at(-1)!.push(c);
  }
  return out;
};

/** The tallest part of a dotted letter is its stem; the smallest is its dot. */
const stemAndDot = (path: readonly PathCommand[]): [PathCommand[], PathCommand[]] => {
  const height = (part: PathCommand[]): number => {
    const b = pathBounds(part);
    return b.maxY - b.minY;
  };
  const sorted = [...parts(path)].sort((a, b) => height(b) - height(a));
  return [sorted[0]!, sorted.at(-1)!];
};

describe('off unless asked for', () => {
  it('leaves the page exactly as it was when the new gestures are left out or zero', () => {
    const text = 'The quick brown fox jumps over the lazy dog, twice. It is fit.';
    const without = { ...PRESETS.rushed };
    delete without.dotDrift;
    delete without.wordTilt;
    delete without.joins;
    const zeroed = { ...without, dotDrift: 0, wordTilt: 0, joins: 0 };
    expect(sceneToSvg(page(text, zeroed))).toBe(sceneToSvg(page(text, without)));
  });

  it('never changes which letters are written, so the text reads the same', () => {
    const text = 'little bits of tiny jittery writing fill it';
    const read = (jitter: JitterParams): string =>
      wholeLetters(page(text, jitter).strokes)
        .filter((s) => s.char !== '')
        .map((s) => s.char)
        .join('');
    const plain = read(NO_JITTER);
    expect(read({ ...NO_JITTER, dotDrift: 0.4, wordTilt: 3, joins: 1 })).toBe(plain);
  });
});

describe('dot drift', () => {
  const i = bank.glyphs.get('i')![0]!;
  const t = bank.glyphs.get('t')![0]!;

  it('moves the dot of an i and leaves its stem alone', () => {
    const moved = placeMarks(i, bank.xHeight, 'stroke', 0.4, createRng('dots'));
    const [stem, dot] = stemAndDot(moved);
    const [stem0, dot0] = stemAndDot(i.path);
    expect(stem).toEqual(stem0);
    const a = pathBounds(dot0!);
    const b = pathBounds(dot!);
    expect(Math.hypot(b.minX - a.minX, b.minY - a.minY)).toBeGreaterThan(0);
  });

  it('lands dots to the right on average, as a hand coming back along the word does', () => {
    const rng = createRng('dots-right');
    const shifts = Array.from({ length: 200 }, () => {
      const [, dot] = stemAndDot(placeMarks(i, bank.xHeight, 'stroke', 0.3, rng));
      return pathBounds(dot).minX - pathBounds(stemAndDot(i.path)[1]).minX;
    });
    const mean = shifts.reduce((sum, v) => sum + v, 0) / shifts.length;
    expect(mean).toBeGreaterThan(0);
    // Never further than about a third of an x-height at this setting.
    expect(Math.max(...shifts.map(Math.abs))).toBeLessThan(bank.xHeight * 0.3 * 1.5);
  });

  it('tilts and moves the crossbar of a t', () => {
    const moved = parts(placeMarks(t, bank.xHeight, 'stroke', 0.4, createRng('bar')));
    const original = parts(t.path);
    expect(moved).toHaveLength(original.length);
    expect(moved).not.toEqual(original);
  });

  it('never moves the hole of a filled letter', () => {
    // A filled "i" with a hole in its stem, and a separate dot above.
    const filled: Glyph = {
      char: 'i',
      variant: 0,
      advance: 40,
      lsb: 0,
      rsb: 0,
      path: parsePath(
        'M0 0 L20 0 L20 -100 L0 -100 Z M5 -10 L15 -10 L15 -90 L5 -90 Z M2 -130 L18 -130 L18 -146 L2 -146 Z',
      ),
    };
    const [body, hole, dot] = parts(placeMarks(filled, 100, 'fill', 0.4, createRng('fill')));
    const [body0, hole0, dot0] = parts(filled.path);
    expect(body).toEqual(body0);
    expect(hole).toEqual(hole0);
    expect(dot).not.toEqual(dot0);
  });
});

describe('word tilt', () => {
  it('gives each word its own small tilt while the letters stay together', () => {
    const text = 'xxxxx xxxxx xxxxx xxxxx xxxxx xxxxx';
    const slopes = (jitter: JitterParams): number[] => {
      const letters = wholeLetters(page(text, jitter).strokes);
      return [0, 1, 2, 3, 4, 5].map((w) => {
        const first = pathBounds(letters[w * 5]!.path);
        const last = pathBounds(letters[w * 5 + 4]!.path);
        return (last.maxY - first.maxY) / (last.minX - first.minX);
      });
    };
    const still = slopes(NO_JITTER);
    for (const s of still) expect(Math.abs(s)).toBeLessThan(0.01);
    const tilted = slopes({ ...NO_JITTER, wordTilt: 3 });
    const spread = Math.max(...tilted) - Math.min(...tilted);
    expect(spread).toBeGreaterThan(Math.tan((1 * Math.PI) / 180));
    // Never more than the setting: 3 degrees either way, plus a little for fatigue.
    for (const s of tilted) expect(Math.abs(s)).toBeLessThan(Math.tan((3.2 * Math.PI) / 180));
  });
});

describe('joins', () => {
  const text = 'minimum aluminium in a unit of time and an animal ran in';

  it('joins some letters inside words and never across a space', () => {
    const scene = page(text, { ...NO_JITTER, joins: 1 });
    const joins = scene.strokes.filter((s) => s.join);
    expect(joins.length).toBeGreaterThan(3);
    const letters = wholeLetters(scene.strokes).filter((s) => s.char !== '');
    const space = (bank.spaceAdvance * 4) / bank.xHeight;
    for (const join of joins) {
      const b = pathBounds(join.path);
      // Shorter than a word gap: it only bridges two letters of one word.
      expect(b.maxX - b.minX).toBeLessThan(space * 1.6);
      expect(join.char).toBe('');
    }
    expect(letters.map((s) => s.char).join('')).toBe(text.replace(/\s+/g, ''));
  });

  it('is never used for handwriting made of filled outlines', () => {
    const filledBank = { ...bank, paint: 'fill' as const };
    const { pages } = renderText(text, filledBank, { ...base, jitter: { ...NO_JITTER, joins: 1 } });
    expect(pages[0]!.strokes.some((s) => s.join)).toBe(false);
  });
});
