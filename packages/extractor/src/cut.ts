import type { LabeledGlyph } from './align';
import type { BinaryImage } from './image';

/** A glyph's own ink, cropped tight, with where it sat on the page. */
export interface GlyphBitmap extends BinaryImage {
  /** Position of the bitmap's top-left corner on the page, in pixels. */
  x: number;
  y: number;
}

/**
 * Cuts one glyph out of the page. Only pixels belonging to the glyph's own pen marks are
 * taken, so a neighbour's tail reaching into the box is left behind. Returns undefined
 * if the box holds no ink of the glyph at all.
 */
export function cutGlyph(
  glyph: LabeledGlyph,
  labels: Int32Array,
  imageWidth: number,
): GlyphBitmap | undefined {
  const ids = new Set(glyph.componentIds);
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -1;
  let y1 = -1;
  for (let y = glyph.y0; y < glyph.y1; y++) {
    for (let x = glyph.x0; x < glyph.x1; x++) {
      if (!ids.has(labels[y * imageWidth + x]!)) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  if (x1 < 0) return undefined;

  const width = x1 - x0 + 1;
  const height = y1 - y0 + 1;
  const data = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (ids.has(labels[(y + y0) * imageWidth + x + x0]!)) data[y * width + x] = 1;
    }
  }
  return { width, height, data, x: x0, y: y0 };
}
