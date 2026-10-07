import type { Alignment, LabeledGlyph } from './align';
import { cutGlyph, type GlyphBitmap } from './cut';
import type { Segmentation } from './segment';

/** Measurements of the writing on one page, in pixels. */
export interface PageMetrics {
  xHeight: number;
  capHeight: number;
  descender: number;
  /** Typical gap between two letters of a word. */
  letterGap: number;
  /** Typical gap between two words. */
  wordGap: number;
  /** Typical thickness of a pen stroke. */
  strokeWidth: number;
}

export interface NormalizedGlyph {
  char: string;
  confidence: number;
  cut: LabeledGlyph['cut'];
  line: number;
  /** Index of the word this glyph belongs to. */
  word: number;
  bitmap: GlyphBitmap;
  /** Where the writing baseline crosses this glyph, in pixels below the bitmap's top. */
  baseline: number;
  /** Space this glyph keeps to its left and right, in pixels. Negative means it overlaps. */
  lsb: number;
  rsb: number;
}

const HANGS = new Set('gjpqy');
const X_HIGH = new Set('acemnorsuvwxz');
const CAP_HIGH = /^[A-Zbdhkl]$/;
/** Characters that rest on the baseline: letters and digits without a descender. */
const sitsOnBaseline = (char: string): boolean => /^[a-zA-Z0-9]$/.test(char) && !HANGS.has(char);

const median = (values: number[], fallback = 0): number => {
  if (values.length === 0) return fallback;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)]!;
};

type Line = (x: number) => number;

/** Least-squares line through points, refitted once without the outliers. */
function fitLine(points: { x: number; y: number }[], outlier: number): Line | undefined {
  const fit = (pts: { x: number; y: number }[]): Line | undefined => {
    if (pts.length === 0) return undefined;
    const meanX = pts.reduce((s, p) => s + p.x, 0) / pts.length;
    const meanY = pts.reduce((s, p) => s + p.y, 0) / pts.length;
    const spread = pts.reduce((s, p) => s + (p.x - meanX) ** 2, 0);
    // With one point, or points stacked on one x, assume a level line.
    const slope =
      spread < 1 ? 0 : pts.reduce((s, p) => s + (p.x - meanX) * (p.y - meanY), 0) / spread;
    return (x) => meanY + slope * (x - meanX);
  };
  const first = fit(points);
  if (!first) return undefined;
  return fit(points.filter((p) => Math.abs(p.y - first(p.x)) <= outlier)) ?? first;
}

/**
 * Puts every cut glyph on a common footing: finds the baseline each one sat on, the
 * overall letter proportions, and the space each glyph kept around itself. After this,
 * glyphs taken from different lines of the page can be mixed freely.
 */
export function normalizeGlyphs(
  alignment: Alignment,
  page: Segmentation,
  imageWidth: number,
): { glyphs: NormalizedGlyph[]; metrics: PageMetrics } {
  // Joined pairs come along as glyphs of their own. The single-character tests below
  // never match them, so they do not disturb the measurements.
  const cuts = [...alignment.glyphs, ...alignment.joined].flatMap((glyph) => {
    const bitmap = cutGlyph(glyph, page.labels, imageWidth);
    return bitmap ? [{ glyph, bitmap }] : [];
  });
  type Cut = (typeof cuts)[number];
  const bottom = (c: Cut): number => c.bitmap.y + c.bitmap.height;
  const right = (c: Cut): number => c.bitmap.x + c.bitmap.width;
  const centre = (c: Cut): number => c.bitmap.x + c.bitmap.width / 2;

  // Baseline of each line: a straight line through the bottoms of the letters resting on it.
  const baselines = new Map<number, Line>();
  for (const [index, line] of page.lines.entries()) {
    const resting = cuts
      .filter((c) => c.glyph.line === index && sitsOnBaseline(c.glyph.char))
      .map((c) => ({ x: centre(c), y: bottom(c) }));
    baselines.set(index, fitLine(resting, page.bandHeight * 0.25) ?? (() => line.bottom));
  }
  const baselineOf = (c: Cut): number => baselines.get(c.glyph.line)!(centre(c));

  const heights = (test: (char: string) => boolean): number[] =>
    cuts.filter((c) => test(c.glyph.char)).map((c) => baselineOf(c) - c.bitmap.y);
  const xHeight = median(
    heights((char) => X_HIGH.has(char)),
    page.bandHeight,
  );
  const capHeight = median(
    heights((char) => CAP_HIGH.test(char)),
    xHeight * 1.5,
  );
  const descender = median(
    cuts.filter((c) => HANGS.has(c.glyph.char)).map((c) => bottom(c) - baselineOf(c)),
    xHeight * 0.5,
  );

  // Gaps to the neighbours, in reading order.
  const ordered = [...cuts].sort((a, b) => a.glyph.line - b.glyph.line || a.bitmap.x - b.bitmap.x);
  const letterGaps: number[] = [];
  const wordGaps: number[] = [];
  const gapAfter = new Map<Cut, number>();
  const gapBefore = new Map<Cut, number>();
  for (let i = 1; i < ordered.length; i++) {
    const prev = ordered[i - 1]!;
    const cur = ordered[i]!;
    if (prev.glyph.line !== cur.glyph.line) continue;
    const gap = cur.bitmap.x - right(prev);
    if (prev.glyph.word === cur.glyph.word) {
      letterGaps.push(gap);
      gapAfter.set(prev, gap);
      gapBefore.set(cur, gap);
    } else if (cur.glyph.word === prev.glyph.word + 1) {
      wordGaps.push(gap);
    }
  }
  const letterGap = median(letterGaps, xHeight * 0.15);
  const wordGap = median(wordGaps, xHeight * 0.9);
  // A glyph at the edge of a word, or beside a flagged neighbour, gets the typical gap.
  const bearing = (gap: number | undefined): number =>
    Math.max(-0.15 * xHeight, Math.min(0.6 * xHeight, (gap ?? letterGap) / 2));

  // Stroke thickness: ink area divided by half the length of its outline.
  let inkArea = 0;
  let outline = 0;
  for (const { bitmap } of cuts) {
    const { width, height, data } = bitmap;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (!data[y * width + x]) continue;
        inkArea++;
        const open =
          x === 0 ||
          y === 0 ||
          x === width - 1 ||
          y === height - 1 ||
          !data[y * width + x - 1] ||
          !data[y * width + x + 1] ||
          !data[(y - 1) * width + x] ||
          !data[(y + 1) * width + x];
        if (open) outline++;
      }
    }
  }

  return {
    metrics: {
      xHeight,
      capHeight,
      descender,
      letterGap,
      wordGap,
      strokeWidth: outline > 0 ? (2 * inkArea) / outline : 0,
    },
    glyphs: cuts.map((c) => ({
      char: c.glyph.char,
      confidence: c.glyph.confidence,
      cut: c.glyph.cut,
      line: c.glyph.line,
      word: c.glyph.word,
      bitmap: c.bitmap,
      baseline: baselineOf(c) - c.bitmap.y,
      lsb: bearing(gapBefore.get(c)),
      rsb: bearing(gapAfter.get(c)),
    })),
  };
}
