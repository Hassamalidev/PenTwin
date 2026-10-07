import { describe, expect, it } from 'vitest';
import { shrinkGray, type GrayImage } from './image';
import { assessQuality } from './quality';
import { CONDITIONS, degrade, renderSamplePage, toRgba, type Degradation } from './testing';

const page = renderSamplePage();
const codes = (gray: GrayImage): string[] =>
  assessQuality(toRgba(gray)).issues.map((issue) => issue.code);
const photo = (d: Degradation): GrayImage => degrade(page.gray, d);

/** Cuts a vertical slice out of the page, slicing through the writing on both sides. */
const cropThroughText = (): GrayImage => {
  const width = Math.round(page.gray.width * 0.6);
  const data = new Uint8Array(width * page.gray.height);
  for (let y = 0; y < page.gray.height; y++) {
    for (let x = 0; x < width; x++) {
      data[y * width + x] = page.gray.data[y * page.gray.width + x + 150]!;
    }
  }
  return { width, height: page.gray.height, data };
};

describe('assessQuality', { timeout: 60_000 }, () => {
  it.each(Object.keys(CONDITIONS))('accepts the usable "%s" photo', (name) => {
    const report = assessQuality(toRgba(photo(CONDITIONS[name]!)));
    expect(report.issues).toEqual([]);
    expect(report.ok).toBe(true);
  });

  it.each([
    ['too-dark', 'Add more light', () => photo({ brightness: 0.25, noise: 3 })],
    ['shadow', 'shadow', () => photo({ shadow: 0.85, noise: 3 })],
    ['blurry', 'Hold the phone steady', () => photo({ blur: 4, noise: 3 })],
    ['low-resolution', 'Move closer', () => shrinkGray(page.gray, 700)],
    ['cropped', 'whole page', cropThroughText],
  ] as const)('rejects a %s photo and says what to do', (code, advice, make) => {
    const report = assessQuality(toRgba(make()));
    expect(report.ok).toBe(false);
    expect(report.issues.map((issue) => issue.code)).toEqual([code]);
    expect(report.issues[0]!.message).toContain(advice);
  });

  it('rejects a blank page', () => {
    const blank: GrayImage = {
      width: 1200,
      height: 1600,
      data: new Uint8Array(1200 * 1600).fill(235),
    };
    expect(codes(blank)).toEqual(['no-writing']);
  });

  it('reports every problem at once', () => {
    expect(codes(photo({ brightness: 0.25, blur: 4 })).sort()).toEqual(['blurry', 'too-dark']);
  });
});
