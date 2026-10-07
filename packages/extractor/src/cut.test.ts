import { PRESETS } from '@pentwin/engine';
import { describe, expect, it } from 'vitest';
import type { LabeledGlyph } from './align';
import { cutGlyph } from './cut';
import { CONDITIONS, degrade, extractLabels, renderSamplePage, type TruthGlyph } from './testing';

/** A cut is bad when the character written at its centre is not the one it is labeled as. */
const isBad = (glyph: LabeledGlyph, truth: readonly TruthGlyph[]): boolean => {
  const inside = truth.filter(
    (t) => t.x >= glyph.x0 - 2 && t.x < glyph.x1 + 2 && t.y >= glyph.y0 - 2 && t.y < glyph.y1 + 2,
  );
  return !inside.some((t) => t.char === glyph.char);
};

describe('character cutting', { timeout: 180_000 }, () => {
  const page = renderSamplePage();
  const clean = extractLabels(degrade(page.gray, CONDITIONS.good!));
  // Letters pushed together until many touch: the hard case for cutting.
  const tightPage = renderSamplePage({
    jitter: { ...PRESETS.normal, tracking: -0.12 },
    seed: 't',
  });
  const tight = extractLabels(degrade(tightPage.gray, CONDITIONS.good!));

  it('gives every glyph a confidence between 0 and 1', () => {
    for (const glyph of [...clean.alignment.glyphs, ...tight.alignment.glyphs]) {
      expect(glyph.confidence).toBeGreaterThan(0);
      expect(glyph.confidence).toBeLessThanOrEqual(1);
    }
  });

  it('keeps the bad-cut rate under 1% on a clean page', () => {
    const bad = clean.alignment.glyphs.filter((g) => isBad(g, page.truth));
    expect(bad.length / clean.alignment.glyphs.length).toBeLessThan(0.01);
  });

  it('keeps the bad-cut rate under 2% even when letters touch', () => {
    const bad = tight.alignment.glyphs.filter((g) => isBad(g, tightPage.truth));
    expect(bad.length / tight.alignment.glyphs.length).toBeLessThan(0.02);
  });

  it('trusts a cut out of touching letters less than a clean one', () => {
    const all = [...clean.alignment.glyphs, ...tight.alignment.glyphs];
    const cleanCuts = all.filter((g) => g.cut === 'clean');
    const repaired = all.filter((g) => g.cut === 'split' || (g.cut === 'merged' && g.char !== '"'));
    const mean = (glyphs: LabeledGlyph[]): number =>
      glyphs.reduce((sum, g) => sum + g.confidence, 0) / glyphs.length;
    expect(mean(cleanCuts)).toBeGreaterThan(0.8);
    for (const glyph of repaired) expect(glyph.confidence).toBeLessThan(0.65);
  });

  it('refuses to cut letters joined by more than a thin stroke', () => {
    const joined = tight.alignment.flagged.filter((f) => f.reason === 'letters-joined');
    expect(joined.length).toBeGreaterThan(3);
    for (const pair of joined) expect([...pair.expected]).toHaveLength(2);
  });

  it('cuts out only the glyph, cropped tight', () => {
    const { alignment, page: segmented, binary } = clean;
    for (const glyph of alignment.glyphs.slice(0, 80)) {
      const bitmap = cutGlyph(glyph, segmented.labels, binary.width)!;
      expect(bitmap.width).toBeLessThanOrEqual(glyph.x1 - glyph.x0);
      expect(bitmap.height).toBeLessThanOrEqual(glyph.y1 - glyph.y0);
      // Tight: ink touches all four edges.
      const row = (y: number): number[] => [
        ...bitmap.data.subarray(y * bitmap.width, (y + 1) * bitmap.width),
      ];
      const column = (x: number): number[] =>
        Array.from({ length: bitmap.height }, (_, y) => bitmap.data[y * bitmap.width + x]!);
      for (const edge of [row(0), row(bitmap.height - 1), column(0), column(bitmap.width - 1)]) {
        expect(edge.some(Boolean)).toBe(true);
      }
    }
  });

  it('returns nothing for a box with no ink of its own', () => {
    const { page: segmented, binary } = clean;
    const empty: LabeledGlyph = {
      char: 'a',
      x0: 0,
      y0: 0,
      x1: 5,
      y1: 5,
      componentIds: [0],
      confidence: 1,
      line: 0,
      word: 0,
      cut: 'clean',
    };
    expect(cutGlyph(empty, segmented.labels, binary.width)).toBeUndefined();
  });
});
