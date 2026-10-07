import { createRng } from '@pentwin/shared';
import { describe, expect, it } from 'vitest';
import { createVariantPicker, type Glyph, type GlyphBank } from './glyphs';

const bankWith = (counts: Record<string, number>): GlyphBank => ({
  name: 'test',
  xHeight: 140,
  capHeight: 210,
  descender: 70,
  spaceAdvance: 130,
  paint: 'stroke',
  glyphs: new Map(
    Object.entries(counts).map(([char, n]) => [
      char,
      Array.from({ length: n }, (_, variant): Glyph => ({
        char,
        variant,
        path: [],
        advance: 100,
        lsb: 0,
        rsb: 0,
      })),
    ]),
  ),
});

const picks = (bank: GlyphBank, char: string, n: number, seed = 1): number[] => {
  const picker = createVariantPicker(bank, createRng(seed));
  return Array.from({ length: n }, () => picker.pick(char)!.variant);
};

describe('createVariantPicker', () => {
  it.each([2, 3, 4, 7])('never repeats immediately over 10,000 picks with %i variants', (n) => {
    const sequence = picks(bankWith({ e: n }), 'e', 10_000);
    for (let i = 1; i < sequence.length; i++) expect(sequence[i]).not.toBe(sequence[i - 1]);
    expect(new Set(sequence).size).toBe(n);
  });

  it('avoids repeats within the window when there are enough variants', () => {
    const sequence = picks(bankWith({ e: 4 }), 'e', 10_000);
    for (let i = 2; i < sequence.length; i++) expect(sequence[i]).not.toBe(sequence[i - 2]);
  });

  it('is not a fixed cycle', () => {
    const sequence = picks(bankWith({ e: 4 }), 'e', 400).join('');
    expect(sequence).not.toBe(sequence.slice(0, 4).repeat(100));
  });

  it('tracks each character separately', () => {
    const picker = createVariantPicker(bankWith({ a: 2, b: 2 }), createRng(3));
    let lastA = -1;
    for (let i = 0; i < 1000; i++) {
      const a = picker.pick('a')!.variant;
      picker.pick('b');
      expect(a).not.toBe(lastA);
      lastA = a;
    }
  });

  it('handles single-variant and unknown characters', () => {
    const picker = createVariantPicker(bankWith({ a: 1 }), createRng(1));
    expect(picker.pick('a')!.variant).toBe(0);
    expect(picker.pick('a')!.variant).toBe(0);
    expect(picker.pick('?')).toBeUndefined();
  });

  it('is reproducible for the same seed', () => {
    const bank = bankWith({ e: 5 });
    expect(picks(bank, 'e', 500, 9)).toEqual(picks(bank, 'e', 500, 9));
    expect(picks(bank, 'e', 500, 9)).not.toEqual(picks(bank, 'e', 500, 10));
  });
});
