import { describe, expect, it } from 'vitest';
import { applyEffects, encodePng, type EffectOptions, type RasterImage } from './effects';
import { sceneToPixels, svgToPixels } from './node/png';
import { PRESETS } from './presets';
import { renderText } from './render';
import { loadSampleBank } from './testing';

const bank = loadSampleBank();
const scene = renderText('The quick brown fox jumps over the lazy dog. '.repeat(14), bank, {
  seed: 'fx',
  pageSize: 'A5',
  jitter: PRESETS.normal,
  paper: { kind: 'ruled', ruling: 'wide' },
}).pages[0]!;
const clean = sceneToPixels(scene, 90);
const fx = (options: EffectOptions): RasterImage => applyEffects(clean, { seed: 1, ...options });

/** Mean brightness of a square patch centred on a relative position. */
const patch = (image: RasterImage, u: number, v: number, size = 24): number => {
  const cx = Math.round(u * (image.width - 1));
  const cy = Math.round(v * (image.height - 1));
  let sum = 0;
  let n = 0;
  for (let y = Math.max(0, cy - size); y < Math.min(image.height, cy + size); y++) {
    for (let x = Math.max(0, cx - size); x < Math.min(image.width, cx + size); x++) {
      const o = (y * image.width + x) * 4;
      sum += (image.data[o]! + image.data[o + 1]! + image.data[o + 2]!) / 3;
      n++;
    }
  }
  return sum / n;
};
const meanDifference = (a: RasterImage, b: RasterImage): number => {
  let sum = 0;
  for (let i = 0; i < a.data.length; i++) sum += Math.abs(a.data[i]! - b.data[i]!);
  return sum / a.data.length;
};
const darkPixels = (image: RasterImage): number => {
  let n = 0;
  for (let i = 0; i < image.data.length; i += 4) if (image.data[i + 2]! < 150) n++;
  return n;
};

describe('applyEffects', { timeout: 120_000 }, () => {
  it('returns the page unchanged at strength 0, without touching the input', () => {
    const before = Uint8Array.from(clean.data);
    const off = fx({ mode: 'photo', strength: 0 });
    expect(Array.from(off.data)).toEqual(Array.from(before));
    fx({ mode: 'photo' });
    expect(Array.from(clean.data)).toEqual(Array.from(before));
  });

  it('keeps a scan subtle: slightly toned and grainy, writing intact', () => {
    const scan = fx({ mode: 'scan' });
    expect(meanDifference(scan, clean)).toBeGreaterThan(1);
    // Most of this is the slight turn of the page moving edges by a pixel or two.
    expect(meanDifference(scan, clean)).toBeLessThan(25);
    // Paper is no longer pure white, but still bright.
    expect(patch(scan, 0.5, 0.03)).toBeLessThan(254);
    expect(patch(scan, 0.5, 0.03)).toBeGreaterThan(235);
    expect(darkPixels(scan) / darkPixels(clean)).toBeGreaterThan(0.75);
    expect(darkPixels(scan) / darkPixels(clean)).toBeLessThan(1.25);
  });

  it('gives a photo uneven light, darker corners and a warm cast', () => {
    const photo = fx({ mode: 'photo' });
    const margins = [
      [0.04, 0.03],
      [0.96, 0.03],
      [0.04, 0.985],
      [0.96, 0.985],
    ].map(([u, v]) => patch(photo, u!, v!, 10));
    // Light falls off across the page: the brightest and darkest corner clearly differ.
    expect(Math.max(...margins) - Math.min(...margins)).toBeGreaterThan(6);
    // And every corner is dimmer than the same corner of the clean page.
    expect(Math.max(...margins)).toBeLessThan(250);

    let red = 0;
    let blue = 0;
    for (let i = 0; i < photo.data.length; i += 4) {
      red += photo.data[i]!;
      blue += photo.data[i + 2]!;
    }
    expect(red).toBeGreaterThan(blue * 1.02);
    // Still gentle: the page stays bright and the writing is all there.
    expect(patch(photo, 0.5, 0.03)).toBeGreaterThan(190);
    expect(darkPixels(photo) / darkPixels(clean)).toBeGreaterThan(0.75);
  });

  it('is stronger as a photo than as a scan, and scales with strength', () => {
    const scan = meanDifference(fx({ mode: 'scan' }), clean);
    const photo = meanDifference(fx({ mode: 'photo' }), clean);
    const half = meanDifference(fx({ mode: 'photo', strength: 0.5 }), clean);
    expect(photo).toBeGreaterThan(scan);
    expect(half).toBeLessThan(photo);
    expect(half).toBeGreaterThan(0);
  });

  it('adds a crease only when asked', () => {
    const flat = fx({ mode: 'photo' });
    const creased = fx({ mode: 'photo', crease: true });
    const changedRows = new Set<number>();
    for (let i = 0; i < flat.data.length; i += 4) {
      if (Math.abs(flat.data[i]! - creased.data[i]!) > 3)
        changedRows.add(Math.floor(i / 4 / flat.width));
    }
    // A narrow band somewhere in the middle third of the page.
    expect(changedRows.size).toBeGreaterThan(2);
    expect(changedRows.size).toBeLessThan(flat.height * 0.06);
    for (const row of changedRows) {
      expect(row / flat.height).toBeGreaterThan(0.3);
      expect(row / flat.height).toBeLessThan(0.7);
    }
  });

  it('is reproducible for a seed and different for another', () => {
    const a = fx({ mode: 'photo', seed: 'x' });
    expect(meanDifference(a, fx({ mode: 'photo', seed: 'x' }))).toBe(0);
    expect(meanDifference(a, fx({ mode: 'photo', seed: 'y' }))).toBeGreaterThan(0.5);
  });
});

describe('encodePng', () => {
  it('writes a PNG that decodes back to the same pixels', async () => {
    const image = fx({ mode: 'photo' });
    const png = await encodePng(image);
    expect(Array.from(png.slice(0, 8))).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

    const base64 = Buffer.from(png).toString('base64');
    const svg =
      `<svg xmlns="http://www.w3.org/2000/svg" width="${image.width}" height="${image.height}">` +
      `<image width="${image.width}" height="${image.height}" href="data:image/png;base64,${base64}"/></svg>`;
    const decoded = svgToPixels(svg, image.width);
    expect(decoded.width).toBe(image.width);
    expect(decoded.height).toBe(image.height);
    expect(meanDifference(decoded, image)).toBeLessThan(0.5);
  });
});
