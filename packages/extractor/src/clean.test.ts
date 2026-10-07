import { describe, expect, it } from 'vitest';
import { cleanImage, estimateSkew, normalizeIllumination, threshold } from './clean';
import { findComponents } from './image';
import { CONDITIONS, degrade, renderSamplePage, toRgba } from './testing';

const page = renderSamplePage();
// What a perfect result looks like: the clean page, thresholded directly.
const reference = threshold(page.gray);
const referenceInk = reference.data.reduce((sum, v) => sum + v, 0);

/** Share of pixels on which two masks agree about ink, relative to the amount of ink. */
const inkError = (a: Uint8Array, b: Uint8Array): number => {
  let differing = 0;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) differing++;
  return differing / referenceInk;
};

describe('cleanImage', { timeout: 60_000 }, () => {
  it.each(['good', 'dim', 'shadowed'])('recovers the ink from a %s photo', (name) => {
    const { binary, skewDegrees } = cleanImage(toRgba(degrade(page.gray, CONDITIONS[name]!)));
    expect(Math.abs(skewDegrees)).toBeLessThan(0.2);
    expect(inkError(binary.data, reference.data)).toBeLessThan(0.12);
  });

  it('keeps a slightly blurry photo usable', () => {
    const { binary } = cleanImage(toRgba(degrade(page.gray, CONDITIONS.blurry!)));
    // Blur fattens strokes, so compare what matters: the same number of pen marks.
    const expected = findComponents(reference).components.length;
    const found = findComponents(binary).components.length;
    expect(Math.abs(found - expected) / expected).toBeLessThan(0.05);
  });

  it('straightens a skewed photo', () => {
    const { binary, skewDegrees } = cleanImage(toRgba(degrade(page.gray, CONDITIONS.skewed!)));
    expect(skewDegrees).toBeCloseTo(4.3, 0);
    expect(Math.abs(estimateSkew(binary))).toBeLessThanOrEqual(0.2);
    const expected = findComponents(reference).components.length;
    const found = findComponents(binary).components.length;
    expect(Math.abs(found - expected) / expected).toBeLessThan(0.05);
  });

  it('shrinks large photos and reports the scale', () => {
    const { gray, scale } = cleanImage(toRgba(page.gray), { maxWidth: 800 });
    expect(gray.width).toBe(800);
    expect(scale).toBeCloseTo(800 / page.gray.width, 5);
  });

  it('removes sensor noise without losing pen marks', () => {
    const noisy = cleanImage(toRgba(degrade(page.gray, { noise: 12 })));
    const expected = findComponents(reference).components.length;
    expect(findComponents(noisy.binary).components.length).toBeLessThan(expected * 1.05);
  });
});

describe('illumination', () => {
  it('flattens a heavy shadow', () => {
    const shadowed = degrade(page.gray, { shadow: 0.6 });
    const paper = (img: { data: Uint8Array; width: number }, x: number): number =>
      img.data[5 * img.width + x]!; // top margin: bare paper
    const before = paper(shadowed, 10) - paper(shadowed, shadowed.width - 10);
    const flat = normalizeIllumination(shadowed);
    const after = Math.abs(paper(flat, 10) - paper(flat, flat.width - 10));
    expect(before).toBeGreaterThan(60);
    expect(after).toBeLessThan(8);
  });
});
