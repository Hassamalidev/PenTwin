import { findComponents, type BinaryImage, type Component } from './image';

/** A rectangle in image pixels; `x1` and `y1` are exclusive. */
export interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** One candidate character: the pen marks that belong together (an "i" and its dot). */
export interface Segment extends Box {
  componentIds: number[];
}

export interface Word extends Box {
  segments: Segment[];
}

export interface TextLine {
  /** Top and bottom of the band where most of the line's ink is: roughly the x-height zone. */
  top: number;
  bottom: number;
  words: Word[];
}

export interface Segmentation {
  lines: TextLine[];
  /** Component id of every pixel (-1 for paper), for cutting glyphs out cleanly. */
  labels: Int32Array;
  components: Component[];
  /** Gaps wider than this many band heights were treated as spaces between words. */
  wordGapThreshold: number;
  /** Typical height of a line's dense band, in pixels: a first estimate of the x-height. */
  bandHeight: number;
}

const median = (values: number[]): number => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)]!;
};

/**
 * Finds the lines of writing from the amount of ink in each pixel row.
 *
 * Lines are first separated at the empty rows between them. Where two lines touch
 * (a descender reaching the next line's ascenders) the block is far too tall, and is
 * split again at its thinnest rows. Each line is then reduced to its dense core, which
 * is measured against that line's own peak so a line with a single short word counts
 * just as much as a full one.
 */
function findBands(binary: BinaryImage): { top: number; bottom: number }[] {
  const { width, height, data } = binary;
  const rows = new Float64Array(height);
  for (let y = 0; y < height; y++) {
    let count = 0;
    for (let x = 0; x < width; x++) count += data[y * width + x]!;
    rows[y] = count;
  }
  // Smooth a little so one thin row does not split a line in two.
  const smooth = rows.map((_, y) => (rows[y - 1] ?? 0) / 4 + rows[y]! / 2 + (rows[y + 1] ?? 0) / 4);
  const busy = [...smooth].filter((v) => v > 0).sort((a, b) => a - b);
  if (busy.length === 0) return [];
  const empty = Math.max(1, busy[Math.floor(busy.length * 0.95)]! * 0.02);

  const runs = (from: number, to: number, isInk: (y: number) => boolean): [number, number][] => {
    const out: [number, number][] = [];
    for (let y = from; y < to; y++) {
      if (!isInk(y)) continue;
      const last = out.at(-1);
      if (last && y - last[1] <= 2) last[1] = y + 1;
      else out.push([y, y + 1]);
    }
    return out;
  };
  const peakOf = (from: number, to: number): number => {
    let peak = 0;
    for (let y = from; y < to; y++) peak = Math.max(peak, smooth[y]!);
    return peak;
  };

  let blocks = runs(0, height, (y) => smooth[y]! > empty);
  const typical = median(blocks.map(([a, b]) => b - a));
  blocks = blocks.flatMap(([a, b]) => {
    if (b - a <= typical * 1.7) return [[a, b] as [number, number]];
    const peak = peakOf(a, b);
    return runs(a, b, (y) => smooth[y]! > peak * 0.2);
  });
  // A sliver on its own is a row of dots or quote marks, not a line.
  blocks = blocks.filter(([a, b]) => b - a >= typical * 0.3);

  return blocks.map(([a, b]) => {
    const peak = peakOf(a, b);
    const core = runs(a, b, (y) => smooth[y]! >= peak * 0.45);
    return { top: core[0]![0], bottom: core.at(-1)![1] };
  });
}

/** Groups marks that sit above one another (dots, the two bars of "=") into one segment. */
function buildSegments(components: Component[]): Segment[] {
  const segments: Segment[] = [];
  for (const c of [...components].sort((a, b) => a.x0 - b.x0)) {
    const last = segments.at(-1);
    if (last) {
      const overlap = Math.min(last.x1, c.x1) - Math.max(last.x0, c.x0);
      // Stacked means one above the other: two neighbouring letters can overlap sideways
      // when the writing slants, but they also share most of their height.
      const shared = Math.min(last.y1, c.y1) - Math.max(last.y0, c.y0);
      const stacked = shared < 0.2 * Math.min(last.y1 - last.y0, c.y1 - c.y0);
      if (stacked && overlap >= 0.5 * Math.min(last.x1 - last.x0, c.x1 - c.x0)) {
        last.x0 = Math.min(last.x0, c.x0);
        last.x1 = Math.max(last.x1, c.x1);
        last.y0 = Math.min(last.y0, c.y0);
        last.y1 = Math.max(last.y1, c.y1);
        last.componentIds.push(c.id);
        continue;
      }
    }
    segments.push({ x0: c.x0, y0: c.y0, x1: c.x1, y1: c.y1, componentIds: [c.id] });
  }
  return segments;
}

/**
 * Splits gap sizes into "between letters" and "between words" by finding the two
 * clusters they fall into. Adapts to how tightly each person writes.
 */
function findWordGapThreshold(gaps: number[]): number {
  if (gaps.length < 8) return 0.5;
  const sorted = [...gaps].sort((a, b) => a - b);
  let small = sorted[Math.floor(sorted.length * 0.25)]!;
  let large = sorted[Math.floor(sorted.length * 0.95)]!;
  for (let i = 0; i < 20; i++) {
    const mid = (small + large) / 2;
    const below = sorted.filter((g) => g <= mid);
    const above = sorted.filter((g) => g > mid);
    if (below.length === 0 || above.length === 0) break;
    small = below.reduce((a, b) => a + b, 0) / below.length;
    large = above.reduce((a, b) => a + b, 0) / above.length;
  }
  return (small + large) / 2;
}

/** Finds the lines, words and candidate characters on a cleaned, straightened page. */
export function segmentPage(binary: BinaryImage): Segmentation {
  const { labels, components } = findComponents(binary);
  const bands = findBands(binary);
  const typicalHeight = median(bands.map((b) => b.bottom - b.top));

  // Each mark goes to the line whose band it is in, or nearest to.
  const perLine: Component[][] = bands.map(() => []);
  for (const c of components) {
    if (c.y1 - c.y0 > typicalHeight * 6) continue; // not writing: a fold, an edge, a ruled line
    const centre = (c.y0 + c.y1) / 2;
    let best = -1;
    let bestDistance = Infinity;
    bands.forEach((band, i) => {
      const distance = Math.max(band.top - centre, centre - band.bottom, 0);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = i;
      }
    });
    if (best >= 0) perLine[best]!.push(c);
  }

  const lineSegments = perLine.map(buildSegments);
  const gaps: number[] = [];
  // Measured against the typical band height: single bands vary with their mix of letters.
  lineSegments.forEach((segments) => {
    for (let s = 1; s < segments.length; s++) {
      gaps.push((segments[s]!.x0 - segments[s - 1]!.x1) / typicalHeight);
    }
  });
  const wordGapThreshold = findWordGapThreshold(gaps);

  const lines = bands.map((band, i): TextLine => {
    const words: Word[] = [];
    for (const segment of lineSegments[i]!) {
      const word = words.at(-1);
      if (word && (segment.x0 - word.x1) / typicalHeight <= wordGapThreshold) {
        word.x1 = Math.max(word.x1, segment.x1);
        word.y0 = Math.min(word.y0, segment.y0);
        word.y1 = Math.max(word.y1, segment.y1);
        word.segments.push(segment);
      } else {
        words.push({
          x0: segment.x0,
          y0: segment.y0,
          x1: segment.x1,
          y1: segment.y1,
          segments: [segment],
        });
      }
    }
    return { top: band.top, bottom: band.bottom, words };
  });

  return {
    lines: lines.filter((line) => line.words.length > 0),
    labels,
    components,
    wordGapThreshold,
    bandHeight: typicalHeight,
  };
}
