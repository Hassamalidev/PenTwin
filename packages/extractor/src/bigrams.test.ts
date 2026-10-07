import { buildGlyphBank, pathBounds, PRESETS, renderText, sceneToSvg } from '@pentwin/engine';
import { describe, expect, it } from 'vitest';
import { extractGlyphBank } from './extract';
import { renderSamplePage, SAMPLE_TEXT, toRgba } from './testing';

const extract = (seed: string, tracking = 0) =>
  extractGlyphBank(
    toRgba(renderSamplePage({ seed, jitter: { ...PRESETS.normal, tracking } }).gray),
    SAMPLE_TEXT,
  );

describe('letter pairs', { timeout: 240_000 }, () => {
  const normal = extract('normal');
  const bank = buildGlyphBank(normal.bank!.metadata, (file) => normal.bank!.files[file]!);
  const text =
    'The other three brothers went there in the green street, and then on to the cheese shop.';
  const render = (bigrams?: number) => renderText(text, bank, { seed: 1, bigrams });

  it('captures the common pairs from a cleanly written sample', () => {
    // "ing" is covered by its "ng".
    for (const pair of ['th', 'er', 'in', 'an', 'ng', 'll', 'ee', 'oo', 'ou', 'st', 'ch']) {
      expect(normal.bigrams).toContain(pair);
    }
    for (const variants of Object.values(normal.bank!.metadata.bigrams!)) {
      expect(variants.length).toBeGreaterThanOrEqual(1);
      expect(variants.length).toBeLessThanOrEqual(3);
    }
  });

  it('keeps pairs the writer joined together, which cannot be cut apart', () => {
    const tight = extract('tight', -0.12);
    const joined = tight.flagged
      .filter((f) => f.reason === 'letters-joined')
      .map((f) => f.expected);
    expect(joined.length).toBeGreaterThan(5);
    for (const pair of joined) expect(tight.bigrams).toContain(pair);
  });

  it('makes a pair glyph as wide as its two letters together', () => {
    const width = (key: string, map = bank.glyphs): number => {
      const b = pathBounds(map.get(key)![0]!.path);
      return b.maxX - b.minX;
    };
    const pair = width('th', bank.bigrams);
    expect(pair).toBeGreaterThan(Math.max(width('t'), width('h')) * 1.3);
    expect(pair).toBeLessThan((width('t') + width('h')) * 1.5);
  });

  it('writes with pair glyphs, and reports how many', () => {
    const always = render(1);
    const never = render(0);
    expect(never.report.bigramCount).toBe(0);
    expect(never.pages[0]!.strokes.every((s) => s.char.length === 1)).toBe(true);

    expect(always.report.bigramCount).toBeGreaterThan(15);
    expect(always.report.glyphCount).toBe(never.report.glyphCount - always.report.bigramCount);
    const used = always.pages[0]!.strokes.filter((s) => s.char.length === 2).map((s) => s.char);
    expect(used).toEqual(expect.arrayContaining(['th', 'er', 'ee']));
    expect(always.report.unknownChars).toEqual({});
  });

  it('uses pairs only some of the time by default, so they do not repeat mechanically', () => {
    const usual = render().report.bigramCount;
    expect(usual).toBeGreaterThan(0);
    expect(usual).toBeLessThan(render(1).report.bigramCount);
  });

  it('keeps the line about as long with pairs as without', () => {
    // One word written both ways should end in nearly the same place.
    const right = (bigrams: number): number => {
      const { pages } = renderText('there', bank, { seed: 1, xHeight: 3, bigrams });
      return Math.max(...pages[0]!.strokes.map((s) => pathBounds(s.path).maxX));
    };
    expect(Math.abs(right(1) - right(0))).toBeLessThan(1.5);
  });

  it('is reproducible', () => {
    expect(sceneToSvg(render().pages[0]!)).toBe(sceneToSvg(render().pages[0]!));
  });
});
