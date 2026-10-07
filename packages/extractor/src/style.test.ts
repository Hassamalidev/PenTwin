import { PRESETS, type JitterParams } from '@pentwin/engine';
import { describe, expect, it } from 'vitest';
import { normalizeGlyphs } from './normalize';
import { measureStyle, type StyleFeatures } from './style';
import { extractLabels, renderSamplePage } from './testing';

const styleOf = (seed: string, jitter: JitterParams = PRESETS.normal): StyleFeatures => {
  const { alignment, page, binary } = extractLabels(renderSamplePage({ seed, jitter }).gray);
  const { glyphs, metrics } = normalizeGlyphs(alignment, page, binary.width);
  return measureStyle(glyphs, metrics);
};

describe('measureStyle', { timeout: 240_000 }, () => {
  // Two different pages by the "same writer": same style settings, different seed.
  const first = styleOf('page-one');
  const second = styleOf('page-two');

  it('gives plausible values', () => {
    expect(first.slant).toBeGreaterThan(0);
    expect(first.slant).toBeLessThan(12);
    expect(first.strokeWidth).toBeGreaterThan(0.1);
    expect(first.strokeWidth).toBeLessThan(0.3);
    expect(first.xHeightRatio).toBeGreaterThan(0.5);
    expect(first.xHeightRatio).toBeLessThan(0.85);
    expect(first.roundness).toBeGreaterThan(0.6);
    expect(first.roundness).toBeLessThanOrEqual(1);
    expect(first.letterWidth).toBeGreaterThan(0.5);
    expect(first.letterWidth).toBeLessThan(1.2);
  });

  it('is stable across two samples from the same writer', () => {
    // Recorded in docs/extraction-accuracy.md. Relative difference, except slant (degrees).
    const relative = (key: keyof StyleFeatures): number =>
      Math.abs(first[key] - second[key]) / Math.abs(first[key]);
    expect(Math.abs(first.slant - second.slant)).toBeLessThanOrEqual(2);
    expect(relative('strokeWidth')).toBeLessThan(0.08);
    expect(relative('xHeightRatio')).toBeLessThan(0.05);
    expect(relative('roundness')).toBeLessThan(0.05);
    expect(relative('letterWidth')).toBeLessThan(0.08);
  });

  it('tells writers apart', () => {
    const upright = styleOf('upright', { ...PRESETS.normal, slant: 0 });
    const leaning = styleOf('leaning', { ...PRESETS.normal, slant: 14 });
    expect(leaning.slant - upright.slant).toBeGreaterThan(9);
    expect(leaning.slant - upright.slant).toBeLessThan(19);
    expect(Math.abs(upright.slant)).toBeLessThanOrEqual(3);
  });
});
