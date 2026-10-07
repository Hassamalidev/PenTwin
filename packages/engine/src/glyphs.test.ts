import { describe, expect, it } from 'vitest';
import { ZodError } from 'zod';
import { buildGlyphBank, checkCoverage, REQUIRED_CHARS } from './glyphs';
import { loadGlyphBank } from './node/load';
import { SAMPLE_GLYPHS_DIR } from './testing';

const SVG = '<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0L10 10"/></svg>';
const variant = { file: 'a.svg', advance: 100, lsb: 10, rsb: 10, baseline: 50 };
const metadata = (glyphs: Record<string, unknown>) => ({
  version: 1,
  name: 'test',
  xHeight: 140,
  capHeight: 210,
  descender: 70,
  spaceAdvance: 130,
  paint: 'stroke',
  glyphs,
});

describe('sample glyph set', () => {
  const { bank, coverage } = loadGlyphBank(SAMPLE_GLYPHS_DIR);

  it('covers every required character with at least 3 variants', () => {
    expect(coverage).toEqual({ missing: [], weak: [] });
    for (const char of REQUIRED_CHARS)
      expect(bank.glyphs.get(char)?.length).toBeGreaterThanOrEqual(3);
  });

  it('stores variants that actually differ', () => {
    const [a, b] = bank.glyphs.get('e')!;
    expect(a!.path).not.toEqual(b!.path);
  });
});

describe('buildGlyphBank', () => {
  it('moves paths to pen-relative, baseline-relative coordinates', () => {
    const bank = buildGlyphBank(metadata({ a: [variant] }), () => SVG);
    expect(bank.glyphs.get('a')![0]!.path).toEqual([
      { type: 'M', x: 10, y: -50 },
      { type: 'L', x: 20, y: -40 },
    ]);
  });

  it('rejects invalid metadata', () => {
    expect(() => buildGlyphBank({ version: 1 }, () => SVG)).toThrow(ZodError);
    expect(() => buildGlyphBank(metadata({ ab: [variant] }), () => SVG)).toThrow(ZodError);
    expect(() => buildGlyphBank(metadata({ a: [] }), () => SVG)).toThrow(ZodError);
    expect(() => buildGlyphBank(metadata({ a: [{ ...variant, advance: -1 }] }), () => SVG)).toThrow(
      ZodError,
    );
  });

  it('rejects an SVG with no path', () => {
    expect(() => buildGlyphBank(metadata({ a: [variant] }), () => '<svg/>')).toThrow(
      /No path data/,
    );
  });
});

describe('checkCoverage', () => {
  it('reports missing and weak characters', () => {
    const bank = buildGlyphBank(
      metadata({ a: [variant, variant, variant], b: [variant] }),
      () => SVG,
    );
    expect(checkCoverage(bank, 3, ['a', 'b', 'c'])).toEqual({ missing: ['c'], weak: ['b'] });
  });
});
