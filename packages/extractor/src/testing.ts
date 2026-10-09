import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { pathBounds, PRESETS, renderText, wholeLetters, type JitterParams } from '@pentwin/engine';
import { loadGlyphBank, sceneToPixels } from '@pentwin/engine/node';
import { createRng } from '@pentwin/shared';
import { alignToText } from './align';
import { cleanImage } from './clean';
import { boxBlur, rotateGray, toGray, type GrayImage, type RgbaImage } from './image';
import { sampleTextOf, type SampleText } from './sample-text';
import { segmentPage } from './segment';

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
  /** Lines of writing on the page. */
  lineCount: number;
  wordCount: number;
}

export interface SamplePageOptions {
  dpi?: number;
  jitter?: JitterParams;
  seed?: string;
  text?: string;
}

/**
 * The hand the synthetic sample pages are written in. It is the normal preset as it was
 * when the extraction thresholds were calibrated and docs/extraction-accuracy.md was
 * recorded: without word bounce, line ride and stroke pressure, which were added to the
 * engine later. Changing this changes every synthetic photo, so it is only to be done
 * together with a fresh `pnpm extract:measure`.
 */
export const SAMPLE_HAND: JitterParams = {
  ...PRESETS.normal,
  wordBounce: 0,
  lineRide: 0,
  pressure: 0,
};

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
    jitter: options.jitter ?? SAMPLE_HAND,
  });
  if (pages.length !== 1) throw new Error('Sample text should fit on one page');
  const scene = pages[0]!;
  const pxPerMm = dpi / 25.4;
  return {
    gray: toGray(sceneToPixels(scene, dpi)),
    pxPerMm,
    lineCount: scene.baselines.length,
    wordCount: (options.text ?? SAMPLE_TEXT).split(/\s+/).filter(Boolean).length,
    truth: wholeLetters(scene.strokes).map((stroke) => {
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

/** Runs a photo through cleanup, segmentation and labeling. */
export function extractLabels(photo: GrayImage, text = SAMPLE_TEXT) {
  const { binary } = cleanImage(toRgba(photo));
  const page = segmentPage(binary);
  return { binary, page, alignment: alignToText(page, binary.width, text) };
}

/** The conditions the pipeline is tested under. */
export const CONDITIONS: Record<string, Degradation> = {
  good: { noise: 3 },
  dim: { brightness: 0.45, noise: 4 },
  skewed: { rotate: 4.3, noise: 3 },
  shadowed: { shadow: 0.55, noise: 3 },
  blurry: { blur: 1, noise: 3 },
};

export interface AlignmentScore {
  /** Share of the page's characters that got the right label. */
  correct: number;
  /** Share of the page's characters that got a wrong label. */
  wrong: number;
  /** Share left unlabeled (flagged or missed). */
  unlabeled: number;
  mistakes: string[];
}

/** Compares labeled cuts with the characters actually written at those positions. */
export function scoreAlignment(
  glyphs: readonly { char: string; x0: number; y0: number; x1: number; y1: number }[],
  truth: readonly TruthGlyph[],
): AlignmentScore {
  let correct = 0;
  let wrong = 0;
  const mistakes: string[] = [];
  for (const t of truth) {
    // The cut that contains this character's centre; the tightest one if several do.
    const hits = glyphs
      .filter((g) => t.x >= g.x0 - 2 && t.x < g.x1 + 2 && t.y >= g.y0 - 2 && t.y < g.y1 + 2)
      .sort((a, b) => (a.x1 - a.x0) * (a.y1 - a.y0) - (b.x1 - b.x0) * (b.y1 - b.y0));
    const hit = hits[0];
    if (!hit) continue;
    if (hit.char === t.char) correct++;
    else {
      wrong++;
      mistakes.push(`${t.char}->${hit.char}`);
    }
  }
  const n = truth.length;
  return { correct: correct / n, wrong: wrong / n, unlabeled: (n - correct - wrong) / n, mistakes };
}
