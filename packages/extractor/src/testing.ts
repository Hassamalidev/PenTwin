import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { pathBounds, PRESETS, renderText, type JitterParams } from '@pentwin/engine';
import { loadGlyphBank, sceneToPixels } from '@pentwin/engine/node';
import { createRng } from '@pentwin/shared';
import { boxBlur, rotateGray, toGray, type GrayImage, type RgbaImage } from './image';
import { sampleTextOf, type SampleText } from './sample-text';

/**
 * Test support: fake "phone photos" of a handwriting sample.
 *
 * The page is written by the engine with the synthetic glyph set, so the exact character
 * at every position is known, and is then degraded the ways real photos are. No real
 * handwriting or user image is involved.
 */

const repoPath = (relative: string): string =>
  fileURLToPath(new URL(`../../../${relative}`, import.meta.url));

export const SAMPLE = JSON.parse(
  readFileSync(repoPath('docs/sample-text.json'), 'utf8'),
) as SampleText;
export const SAMPLE_TEXT = sampleTextOf(SAMPLE);

export interface TruthGlyph {
  char: string;
  /** Centre of the glyph's ink, in photo pixels (before any degradation). */
  x: number;
  y: number;
}

export interface SamplePage {
  gray: GrayImage;
  truth: TruthGlyph[];
  /** Pixels per millimetre. */
  pxPerMm: number;
}

export interface SamplePageOptions {
  dpi?: number;
  jitter?: JitterParams;
  seed?: string;
  text?: string;
}

/** Renders the copy-paragraph as a clean, flat, evenly lit page. */
export function renderSamplePage(options: SamplePageOptions = {}): SamplePage {
  const dpi = options.dpi ?? 200;
  const { bank } = loadGlyphBank(repoPath('tests/fixtures/glyphs/sample-user'));
  const { pages } = renderText(options.text ?? SAMPLE_TEXT, bank, {
    seed: options.seed ?? 'sample-photo',
    lineHeight: 10,
    xHeight: 3,
    penWidth: 0.5,
    inkColor: '#1a1a2e',
    jitter: options.jitter ?? PRESETS.normal,
  });
  if (pages.length !== 1) throw new Error('Sample text should fit on one page');
  const scene = pages[0]!;
  const pxPerMm = dpi / 25.4;
  return {
    gray: toGray(sceneToPixels(scene, dpi)),
    pxPerMm,
    truth: scene.strokes.map((stroke) => {
      const b = pathBounds(stroke.path);
      return {
        char: stroke.char,
        x: ((b.minX + b.maxX) / 2) * pxPerMm,
        y: ((b.minY + b.maxY) / 2) * pxPerMm,
      };
    }),
  };
}

export interface Degradation {
  /** Rotation of the page in the photo, in degrees. */
  rotate?: number;
  /** Overall brightness, 1 = unchanged, 0.4 = a dim room. */
  brightness?: number;
  /** Strength of a shadow falling across one side, 0 to 1. */
  shadow?: number;
  /** Blur radius in pixels. */
  blur?: number;
  /** Sensor noise amplitude in gray levels. */
  noise?: number;
}

/** Makes a clean page look like a photo taken under the given conditions. */
export function degrade(page: GrayImage, d: Degradation, seed = 1): GrayImage {
  let img = page;
  if (d.rotate) img = rotateGray(img, (-d.rotate * Math.PI) / 180, 245);
  if (d.blur) img = boxBlur(boxBlur(img, d.blur), d.blur);

  const rng = createRng(seed);
  const { width, height } = img;
  const out = new Uint8Array(img.data.length);
  const brightness = d.brightness ?? 1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      // The shadow darkens diagonally from the top-left to the bottom-right corner.
      const shade = 1 - (d.shadow ?? 0) * ((x / width) * 0.7 + (y / height) * 0.3);
      const noise = d.noise ? rng.float(-d.noise, d.noise) : 0;
      // Paper is never pure white in a photo.
      const v = img.data[y * width + x]! * 0.94 * brightness * shade + noise;
      out[y * width + x] = Math.max(0, Math.min(255, v));
    }
  }
  return { width, height, data: out };
}

export function toRgba(gray: GrayImage): RgbaImage {
  const data = new Uint8ClampedArray(gray.data.length * 4);
  for (let i = 0; i < gray.data.length; i++) {
    data[i * 4] = data[i * 4 + 1] = data[i * 4 + 2] = gray.data[i]!;
    data[i * 4 + 3] = 255;
  }
  return { width: gray.width, height: gray.height, data };
}

/** The conditions the pipeline is tested under. */
export const CONDITIONS: Record<string, Degradation> = {
  good: { noise: 3 },
  dim: { brightness: 0.45, noise: 4 },
  skewed: { rotate: 4.3, noise: 3 },
  shadowed: { shadow: 0.55, noise: 3 },
  blurry: { blur: 1, noise: 3 },
};
