import { createRng, type Rng, type Seed } from '@pentwin/shared';
import { applyEffects, type RasterImage } from './effects';

/** One look per export: a page that is half scan and half photo looks wrong. */
export type FinishMode = 'none' | 'scan' | 'photo';

export interface FinishOptions {
  mode: Exclude<FinishMode, 'none'>;
  seed: Seed;
  /** Pixels per millimetre, so the paper's grain is the same size at any resolution. */
  pxPerMm: number;
  /** 0 to 1. How patchily the pen covers the paper's tooth (the ink's `grain`). */
  patch?: number;
  /** The clean page on the other side of the sheet, for faint show-through. */
  backside?: RasterImage;
  /** A scan of blank paper. Used in place of the generated grain when given. */
  paper?: RasterImage;
}

/** Darkest the paper's own texture gets, as a share of its brightness. */
const GRAIN_DEPTH = 0.055;
/** How strongly writing on the back shows through. */
const SHOW_THROUGH = 0.07;
/** How much a little of the pen's line is lost on the high spots of the paper. */
const PATCH_DEPTH = 2.2;

/** Smooth noise over the whole page, 0 to 1, from one coarse random lattice. */
function addOctave(
  field: Float32Array,
  width: number,
  height: number,
  cellX: number,
  cellY: number,
  weight: number,
  rng: Rng,
): void {
  const columns = Math.ceil(width / cellX) + 2;
  const rows = Math.ceil(height / cellY) + 2;
  const lattice = new Float32Array(columns * rows);
  for (let i = 0; i < lattice.length; i++) lattice[i] = rng.next();
  for (let y = 0; y < height; y++) {
    const gy = y / cellY;
    const r = Math.floor(gy);
    const fy = gy - r;
    for (let x = 0; x < width; x++) {
      const gx = x / cellX;
      const c = Math.floor(gx);
      const fx = gx - c;
      const a = lattice[r * columns + c]! * (1 - fx) + lattice[r * columns + c + 1]! * fx;
      const b =
        lattice[(r + 1) * columns + c]! * (1 - fx) + lattice[(r + 1) * columns + c + 1]! * fx;
      field[y * width + x]! += (a * (1 - fy) + b * fy) * weight;
    }
  }
}

/** The paper's surface: fine fibres that lie mostly one way, over a slower mottling. */
function paperTooth(width: number, height: number, pxPerMm: number, rng: Rng): Float32Array {
  const field = new Float32Array(width * height);
  const cell = (mm: number): number => Math.max(1.2, mm * pxPerMm);
  addOctave(field, width, height, cell(0.5), cell(0.17), 0.5, rng);
  addOctave(field, width, height, cell(0.9), cell(0.9), 0.3, rng);
  addOctave(field, width, height, cell(6), cell(6), 0.2, rng);
  return field;
}

/** A scan of blank paper as brightness around 1, cut at random so no two pages match. */
function scannedPaper(paper: RasterImage, width: number, height: number, rng: Rng): Float32Array {
  const out = new Float32Array(width * height);
  const offsetX = rng.int(0, Math.max(0, paper.width - width));
  const offsetY = rng.int(0, Math.max(0, paper.height - height));
  const flipX = rng.next() < 0.5;
  const flipY = rng.next() < 0.5;
  let sum = 0;
  for (let y = 0; y < height; y++) {
    const sy = (flipY ? height - 1 - y : y) + offsetY;
    const row = Math.min(paper.height - 1, sy);
    for (let x = 0; x < width; x++) {
      const sx = Math.min(paper.width - 1, (flipX ? width - 1 - x : x) + offsetX);
      const value = paper.data[(row * paper.width + sx) * 4 + 1]!;
      out[y * width + x] = value;
      sum += value;
    }
  }
  const mean = sum / out.length || 1;
  // Used directly as the page's tooth, centred on the middle of the 0 to 1 range.
  for (let i = 0; i < out.length; i++) out[i] = 0.5 + ((out[i]! - mean) / mean) * 4;
  return out;
}

/**
 * Makes ink and paper one image. The ink is multiplied into the paper, so its grain shows
 * through the writing, and a pen covers the tooth of the paper unevenly. Everything after
 * that (turn, light, softness, noise) then falls on ink and paper alike: ink that is
 * sharper than its paper looks pasted on.
 */
export function finishPage(image: RasterImage, options: FinishOptions): RasterImage {
  const { width, height, data } = image;
  const rng = createRng(`${options.seed}/finish/${options.mode}`);
  const tooth = options.paper
    ? scannedPaper(options.paper, width, height, rng)
    : paperTooth(width, height, options.pxPerMm, rng);
  const patch = (options.patch ?? 0) * PATCH_DEPTH;
  const back = options.backside;
  const merged = new Uint8ClampedArray(data.length);

  // The inner edge of a notebook sheet falls into shadow.
  const gutter = new Float32Array(width);
  for (let x = 0; x < width; x++) gutter[x] = 1 - 0.035 * Math.exp(-x / (options.pxPerMm * 9));

  // Seen through the sheet the page is a mirror image, and blurred by the paper.
  let through: Float32Array | undefined;
  if (back) {
    through = new Float32Array(width * height);
    for (let y = 0; y < height; y++) {
      const above = Math.max(0, y - 2) * width;
      const below = Math.min(height - 1, y + 2) * width;
      const row = y * width;
      for (let x = 0; x < width; x++) {
        const mirror = width - 1 - x;
        const near = Math.max(0, mirror - 2);
        const seen =
          (back.data[(row + mirror) * 4 + 1]! +
            back.data[(above + mirror) * 4 + 1]! +
            back.data[(below + mirror) * 4 + 1]! +
            back.data[(row + near) * 4 + 1]!) /
          4;
        through[row + x] = 1 - SHOW_THROUGH * (1 - seen / 255);
      }
    }
  }

  for (let p = 0; p < width * height; p++) {
    const o = p * 4;
    const t = tooth[p]!;
    let paper = (1 - GRAIN_DEPTH * (1 - Math.min(1, t * 1.25))) * gutter[p % width]!;
    if (through) paper *= through[p]!;
    // The pen skips a little over the high spots of the paper.
    const cover = 1 - patch * Math.max(0, t - 0.5);
    merged[o] = 255 * paper * (1 - (1 - data[o]! / 255) * cover);
    merged[o + 1] = 255 * paper * (1 - (1 - data[o + 1]! / 255) * cover);
    merged[o + 2] = 255 * paper * (1 - (1 - data[o + 2]! / 255) * cover);
    merged[o + 3] = 255;
  }
  return applyEffects({ width, height, data: merged }, { mode: options.mode, seed: options.seed });
}
