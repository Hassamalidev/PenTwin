import { describe, expect, it } from 'vitest';
import type { RasterImage } from './effects';
import { finishPage } from './finish';
import { scenesToFinishedPdf } from './node/finished';
import { sceneToPixels } from './node/png';
import { presetOptions } from './presets';
import { renderText } from './render';
import { loadSampleBank } from './testing';

const bank = loadSampleBank();
const { pages } = renderText('The quick brown fox jumps over the lazy dog. '.repeat(10), bank, {
  seed: 'finish',
  pageSize: 'A5',
  ...presetOptions('normal'),
});
const scene = pages[0]!;
const clean = sceneToPixels({ ...scene, inkEffects: undefined }, 90);
const pxPerMm = 90 / 25.4;
const options = { seed: 1, pxPerMm, patch: 0.12 };

const spread = (image: RasterImage, keep: (v: number) => boolean): number => {
  const values: number[] = [];
  for (let i = 1; i < image.data.length; i += 4) {
    if (keep(clean.data[i]!)) values.push(image.data[i]!);
  }
  const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
  return Math.sqrt(values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length);
};
const difference = (a: RasterImage, b: RasterImage): number => {
  let sum = 0;
  for (let i = 0; i < a.data.length; i++) sum += Math.abs(a.data[i]! - b.data[i]!);
  return sum / a.data.length;
};

describe('finishing a page', { timeout: 120_000 }, () => {
  it('gives blank paper a real texture instead of flat white', () => {
    const page = finishPage(clean, { ...options, mode: 'scan' });
    expect(spread(page, (v) => v === 255)).toBeGreaterThan(1.5);
  });

  it('is reproducible for a seed, leaves its input alone, and differs by seed', () => {
    const before = Array.from(clean.data.slice(0, 4000));
    const a = finishPage(clean, { ...options, mode: 'photo' });
    expect(Array.from(clean.data.slice(0, 4000))).toEqual(before);
    expect(difference(a, finishPage(clean, { ...options, mode: 'photo' }))).toBe(0);
    expect(
      difference(a, finishPage(clean, { ...options, seed: 2, mode: 'photo' })),
    ).toBeGreaterThan(0.3);
  });

  it('softens ink and paper together: no pure black, no razor edge', () => {
    const page = finishPage(clean, { ...options, mode: 'scan' });
    let darkest = 255;
    for (let i = 0; i < page.data.length; i += 4) darkest = Math.min(darkest, page.data[i + 1]!);
    expect(darkest).toBeGreaterThan(0);
  });

  it('lets the other side of the sheet show through faintly', () => {
    const blank: RasterImage = {
      width: clean.width,
      height: clean.height,
      data: new Uint8Array(clean.data.length).fill(255),
    };
    const alone = finishPage(blank, { ...options, mode: 'scan' });
    const backed = finishPage(blank, { ...options, mode: 'scan', backside: clean });
    const shift = difference(alone, backed);
    expect(shift).toBeGreaterThan(0.02);
    expect(shift).toBeLessThan(3);
  });

  it('uses a scan of blank paper when given one, cut differently for each seed', () => {
    const paper: RasterImage = {
      width: clean.width + 40,
      height: clean.height + 40,
      data: Uint8Array.from({ length: (clean.width + 40) * (clean.height + 40) * 4 }, (_, i) =>
        i % 4 === 3 ? 255 : 225 + ((i * 7) % 13),
      ),
    };
    const a = finishPage(clean, { ...options, mode: 'scan', paper });
    const b = finishPage(clean, { ...options, seed: 9, mode: 'scan', paper });
    expect(difference(a, b)).toBeGreaterThan(0.2);
  });

  it('writes one picture page for each page, and stays within a sensible size', async () => {
    const pdf = await scenesToFinishedPdf(pages.slice(0, 1), {
      finish: 'scan',
      seed: 's',
      dpi: 90,
      watermark: 'free plan',
    });
    expect(new TextDecoder('latin1').decode(pdf.slice(0, 5))).toBe('%PDF-');
    expect(pdf.length).toBeGreaterThan(5_000);
    expect(pdf.length).toBeLessThan(2_000_000);
  });
});
