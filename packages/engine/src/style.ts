import type { PointFn } from './path';

/** How one line of writing deviates from the ideal. Lengths in mm, angles in radians. */
export interface LineStyle {
  /** Shift of the line's start from the left margin. */
  offsetX: number;
  /** Tilt of the whole line; positive runs downhill to the right. */
  slope: number;
  /** Vertical wander of the baseline at page position `x`. */
  baselineShift: (x: number) => number;
}

/** How one placed glyph deviates from its stored shape. */
export interface GlyphStyle {
  scale: number;
  rotation: number;
  /** Positive leans to the right. */
  slant: number;
  /** Multiplier on the pen width. */
  strokeScale: number;
  /** Shape distortion applied in glyph units before anything else. */
  warp?: PointFn;
}

/**
 * Supplies the per-line and per-glyph variation for one page. The renderer only does
 * geometry; everything that makes the writing look human comes through this interface.
 */
export interface Styler {
  line(lineIndex: number): LineStyle;
  glyph(char: string): GlyphStyle;
  /** Multiplier on the space between two words. */
  wordGap(): number;
  /** Extra space (mm) between two adjacent letters of a word. */
  letterGap(prev: string, char: string): number;
}

const FLAT_LINE: LineStyle = { offsetX: 0, slope: 0, baselineShift: () => 0 };
const PLAIN_GLYPH: GlyphStyle = { scale: 1, rotation: 0, slant: 0, strokeScale: 1 };

/** No variation at all: every glyph exactly as stored, on a perfectly straight line. */
export const identityStyler: Styler = {
  line: () => FLAT_LINE,
  glyph: () => PLAIN_GLYPH,
  wordGap: () => 1,
  letterGap: () => 0,
};
