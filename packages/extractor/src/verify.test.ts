import { describe, expect, it } from 'vitest';
import type { NormalizedGlyph } from './normalize';
import { verifyGlyphs } from './verify';

/** A glyph drawn from rows of text: "#" is ink. */
const glyph = (char: string, rows: string[]): NormalizedGlyph => {
  const height = rows.length;
  const width = rows[0]!.length;
  return {
    char,
    confidence: 0.9,
    cut: 'clean',
    line: 0,
    word: 0,
    bitmap: {
      width,
      height,
      x: 0,
      y: 0,
      data: Uint8Array.from(rows.join('').split(''), (c) => (c === '#' ? 1 : 0)),
    },
    baseline: height,
    lsb: 1,
    rsb: 1,
  };
};

const BAR = [
  '########',
  '########',
  '..##....',
  '..##....',
  '..##....',
  '..##....',
  '..##....',
  '..##....',
];
const RING = [
  '..####..',
  '.##..##.',
  '##....##',
  '##....##',
  '##....##',
  '##....##',
  '.##..##.',
  '..####..',
];
const WIDE = BAR.map((row) => row.repeat(3));
const bars = (n: number): NormalizedGlyph[] => Array.from({ length: n }, () => glyph('t', BAR));
const rings = (n: number): NormalizedGlyph[] => Array.from({ length: n }, () => glyph('o', RING));

describe('letters checking each other', () => {
  it('keeps letters that agree with their own samples', () => {
    const { refused } = verifyGlyphs([...bars(5), ...rings(5)], 8);
    expect(refused).toHaveLength(0);
  });

  it('refuses a cut that looks like another letter', () => {
    const wrong = glyph('t', RING);
    const { refused } = verifyGlyphs([...bars(5), ...rings(5), wrong], 8);
    expect(refused.map((g) => g.char)).toEqual(['t']);
    expect(refused[0]!.bitmap).toBe(wrong.bitmap);
  });

  it('refuses a whole word stored as one letter, by its width', () => {
    const wrong = glyph('t', WIDE);
    expect(verifyGlyphs([...bars(5), wrong], 8).refused).toHaveLength(1);
  });

  it('keeps its strongest few rather than lose a letter altogether', () => {
    const lookAlike = Array.from({ length: 4 }, () => glyph('c', RING));
    const { kept } = verifyGlyphs([...rings(8), ...lookAlike], 8);
    expect(kept.filter((g) => g.char === 'c').length).toBeGreaterThanOrEqual(3);
  });

  it('refuses a full stop as big as a letter', () => {
    expect(verifyGlyphs([glyph('.', RING)], 8).refused).toHaveLength(1);
  });

  it('refuses a pair that holds only one of its letters', () => {
    const pair = glyph('to', BAR);
    const { refused } = verifyGlyphs([...bars(5), ...rings(5), pair], 8);
    expect(refused.map((g) => g.char)).toEqual(['to']);
  });

  it('never changes the order or drops a sound cut', () => {
    const all = [...bars(4), ...rings(4)];
    expect(verifyGlyphs(all, 8).kept.map((g) => g.char)).toEqual(all.map((g) => g.char));
  });
});
