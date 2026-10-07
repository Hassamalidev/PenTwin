import {
  boxBlur,
  findComponents,
  integralImage,
  resizeGray,
  rotateGray,
  shrinkGray,
  toGray,
  type BinaryImage,
  type GrayImage,
  type RgbaImage,
} from './image';

export interface CleanOptions {
  /** Photos wider than this are shrunk first. Plenty for letter shapes, and much faster. */
  maxWidth?: number;
}

export interface CleanResult {
  /** Evenly lit, straightened grayscale page. */
  gray: GrayImage;
  /** Ink mask of the same page. */
  binary: BinaryImage;
  /** Rotation that was removed, in degrees. */
  skewDegrees: number;
  /** Size of the working image relative to the photo (1 = not shrunk). */
  scale: number;
}

const DEG = Math.PI / 180;

/**
 * Estimates the bare paper brightness everywhere on the page. Taking the brightest pixel
 * of each small block skips over the ink; blurring the result leaves only the slow
 * changes: shadows, a lamp on one side, a dim room.
 */
export function estimateBackground(gray: GrayImage): GrayImage {
  const block = Math.max(8, Math.round(gray.width / 80));
  const width = Math.ceil(gray.width / block);
  const height = Math.ceil(gray.height / block);
  const maxima = new Uint8Array(width * height);
  for (let y = 0; y < gray.height; y++) {
    const row = Math.floor(y / block) * width;
    for (let x = 0; x < gray.width; x++) {
      const i = row + Math.floor(x / block);
      const v = gray.data[y * gray.width + x]!;
      if (v > maxima[i]!) maxima[i] = v;
    }
  }
  return resizeGray(boxBlur({ width, height, data: maxima }, 2), gray.width, gray.height);
}

/** Divides out the lighting so the paper is white everywhere and only ink stays dark. */
export function normalizeIllumination(gray: GrayImage): GrayImage {
  const background = estimateBackground(gray);
  const out = new Uint8Array(gray.data.length);
  for (let i = 0; i < out.length; i++) {
    out[i] = Math.min(255, (gray.data[i]! * 255) / Math.max(1, background.data[i]!));
  }
  return { width: gray.width, height: gray.height, data: out };
}

/**
 * Adaptive threshold: a pixel is ink when it is clearly darker than the average of its
 * neighbourhood. Works where a single global cut-off would fail under uneven light.
 */
export function threshold(gray: GrayImage, sensitivity = 0.15): BinaryImage {
  const { width, height } = gray;
  const radius = Math.max(8, Math.round(width / 60));
  const sums = integralImage(gray);
  const stride = width + 1;
  const out = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    const y0 = Math.max(0, y - radius);
    const y1 = Math.min(height, y + radius + 1);
    for (let x = 0; x < width; x++) {
      const x0 = Math.max(0, x - radius);
      const x1 = Math.min(width, x + radius + 1);
      const sum =
        sums[y1 * stride + x1]! -
        sums[y0 * stride + x1]! -
        sums[y1 * stride + x0]! +
        sums[y0 * stride + x0]!;
      const count = (y1 - y0) * (x1 - x0);
      if (gray.data[y * width + x]! * count < sum * (1 - sensitivity)) out[y * width + x] = 1;
    }
  }
  return { width, height, data: out };
}

/** Removes specks too small to be part of any pen mark. */
export function despeckle(binary: BinaryImage, minArea: number): BinaryImage {
  const { labels, components } = findComponents(binary);
  const out = new Uint8Array(binary.data.length);
  for (let i = 0; i < out.length; i++) {
    const id = labels[i]!;
    if (id >= 0 && components[id]!.area >= minArea) out[i] = 1;
  }
  return { width: binary.width, height: binary.height, data: out };
}

/**
 * Finds the page's rotation, in degrees, within +/- `maxDegrees`. When the text lines are
 * level, ink piles up in some rows and leaves others empty; the angle that makes the row
 * totals most uneven is the one that levels the lines. Passing the result to
 * `rotateGray` (as radians) straightens the page.
 */
export function estimateSkew(binary: BinaryImage, maxDegrees = 12): number {
  const { width, height, data } = binary;
  // A few thousand ink pixels are enough, and keep this fast on a phone.
  const step = Math.max(1, Math.round(Math.sqrt((width * height) / 400_000)));
  const xs: number[] = [];
  const ys: number[] = [];
  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      if (data[y * width + x]) {
        xs.push(x - width / 2);
        ys.push(y - height / 2);
      }
    }
  }
  if (xs.length < 50) return 0;

  const bins = Math.ceil((height * 1.5) / step);
  const rows = new Float64Array(bins);
  const score = (degrees: number): number => {
    const sin = Math.sin(degrees * DEG);
    const cos = Math.cos(degrees * DEG);
    rows.fill(0);
    for (let i = 0; i < xs.length; i++) {
      const row = Math.round((cos * ys[i]! - sin * xs[i]!) / step + bins / 2);
      if (row >= 0 && row < bins) rows[row]!++;
    }
    let total = 0;
    for (const count of rows) total += count * count;
    return total;
  };

  let best = 0;
  let bestScore = -1;
  const search = (from: number, to: number, increment: number): void => {
    for (let degrees = from; degrees <= to + 1e-9; degrees += increment) {
      const s = score(degrees);
      if (s > bestScore) {
        bestScore = s;
        best = degrees;
      }
    }
  };
  search(-maxDegrees, maxDegrees, 0.5);
  search(best - 0.5, best + 0.5, 0.1);
  return Math.round(best * 10) / 10;
}

/** Photo in, clean straightened ink mask out. */
export function cleanImage(photo: RgbaImage, options: CleanOptions = {}): CleanResult {
  const full = toGray(photo);
  const shrunk = shrinkGray(full, options.maxWidth ?? 1800);
  let gray = normalizeIllumination(shrunk);
  let binary = threshold(gray);

  const skewDegrees = estimateSkew(binary);
  if (Math.abs(skewDegrees) >= 0.2) {
    gray = rotateGray(gray, skewDegrees * DEG);
    binary = threshold(gray);
  }

  // A pen dot is several pixels across at this size; anything smaller is sensor noise.
  const minArea = Math.max(4, Math.round((gray.width / 1800) ** 2 * 6));
  return {
    gray,
    binary: despeckle(binary, minArea),
    skewDegrees,
    scale: shrunk.width / full.width,
  };
}
