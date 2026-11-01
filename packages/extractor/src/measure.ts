import type { BinaryImage } from './image';
import { segmentPage, type Segment, type TextLine } from './segment';

/**
 * What a page of writing measures, read from its pixels alone. A real scan and a generated
 * page go through exactly this code, so the two can be compared directly. Lengths are in
 * x-heights (the height of a small letter), so the size of the writing does not matter.
 */
export interface PageMeasure {
  lines: number;
  words: number;
  /** Distance from one line to the next, and how much it varies (relative). */
  lineSpacing: number;
  lineSpacingVariation: number;
  /** Degrees. How much the slope of a line differs from line to line. */
  lineSlopeSpread: number;
  /** Spread of letter feet around each line's straight fit. */
  baselineSpread: number;
  /** Width of the gap between words, and how much it varies (relative). */
  wordGap: number;
  wordGapVariation: number;
  /** Relative variation of the height of small letters. */
  sizeVariation: number;
  /** Separate marks per word: low when letters are joined up. */
  marksPerWord: number;
  /** Degrees. Lean of the writing, and how much it changes from line to line. */
  slant: number;
  slantSpread: number;
  /** How far line starts and line ends wander. */
  leftSpread: number;
  rightSpread: number;
  /** Width of the pen line. */
  strokeWidth: number;
}

export type MeasureName = Exclude<keyof PageMeasure, 'lines' | 'words'>;

const mean = (values: readonly number[]): number =>
  values.length ? values.reduce((sum, v) => sum + v, 0) / values.length : 0;

const std = (values: readonly number[]): number => {
  if (values.length < 2) return 0;
  const m = mean(values);
  return Math.sqrt(values.reduce((sum, v) => sum + (v - m) ** 2, 0) / (values.length - 1));
};

const median = (values: readonly number[]): number => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)]!;
};

/** Least-squares line through points. */
function fitLine(points: readonly { x: number; y: number }[]): {
  slope: number;
  at: (x: number) => number;
} {
  const mx = mean(points.map((p) => p.x));
  const my = mean(points.map((p) => p.y));
  const sxx = points.reduce((sum, p) => sum + (p.x - mx) ** 2, 0);
  const sxy = points.reduce((sum, p) => sum + (p.x - mx) * (p.y - my), 0);
  const slope = sxx > 0 ? sxy / sxx : 0;
  return { slope, at: (x) => my + slope * (x - mx) };
}

/** Lean of a line of writing: the shear that lines up its strokes most sharply, in degrees. */
function lineSlant(line: TextLine, binary: BinaryImage): number {
  const { width, data } = binary;
  const x0 = Math.min(...line.words.map((w) => w.x0));
  const x1 = Math.max(...line.words.map((w) => w.x1));
  const y0 = Math.min(...line.words.map((w) => w.y0));
  const y1 = Math.max(...line.words.map((w) => w.y1));
  const xs: number[] = [];
  const ys: number[] = [];
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      if (data[y * width + x] === 1) {
        xs.push(x);
        ys.push(y - y0);
      }
    }
  }
  let best = 0;
  let bestScore = -1;
  const columns = new Float64Array(x1 - x0 + (y1 - y0) * 2 + 2);
  for (let degrees = -30; degrees <= 50; degrees += 2) {
    const shear = Math.tan((degrees * Math.PI) / 180);
    columns.fill(0);
    for (let i = 0; i < xs.length; i++) {
      const column = Math.round(xs[i]! - x0 + (y1 - y0) * 0.9 + (ys[i]! - (y1 - y0)) * shear);
      if (column >= 0 && column < columns.length) columns[column]! += 1;
    }
    let score = 0;
    for (const count of columns) score += count * count;
    if (score > bestScore) {
      bestScore = score;
      best = degrees;
    }
  }
  return best;
}

/** Measures one page. Undefined when it holds too little writing to say anything. */
export function measurePage(binary: BinaryImage): PageMeasure | undefined {
  const page = segmentPage(binary);
  const lines = page.lines.filter((line) => line.words.length >= 2);
  if (lines.length < 3 || page.bandHeight < 4) return undefined;
  const xHeight = page.bandHeight;

  const isSmall = (s: Segment): boolean => {
    const height = s.y1 - s.y0;
    return height > xHeight * 0.55 && height < xHeight * 1.4;
  };
  const middles: number[] = [];
  const slopes: number[] = [];
  const residuals: number[] = [];
  const gaps: number[] = [];
  const sizes: number[] = [];
  const lefts: number[] = [];
  const rights: number[] = [];
  const slants: number[] = [];
  let words = 0;
  let marks = 0;
  const widest = Math.max(...lines.map((l) => l.words.at(-1)!.x1 - l.words[0]!.x0));

  for (const line of lines) {
    const segments = line.words.flatMap((word) => word.segments);
    words += line.words.length;
    marks += segments.length;
    const small = segments.filter(isSmall);
    for (const s of small) sizes.push(s.y1 - s.y0);
    // Only full lines say where the writer starts: a stray fragment may begin anywhere.
    if (line.words.at(-1)!.x1 - line.words[0]!.x0 > widest * 0.5) {
      lefts.push(line.words[0]!.x0);
      rights.push(line.words.at(-1)!.x1);
    }
    line.words.slice(1).forEach((word, i) => gaps.push(word.x0 - line.words[i]!.x1));
    slants.push(lineSlant(line, binary));

    const feet = small.map((s) => ({ x: (s.x0 + s.x1) / 2, y: s.y1 }));
    if (feet.length < 3) {
      middles.push((line.top + line.bottom) / 2);
      continue;
    }
    const fit = fitLine(feet);
    slopes.push((Math.atan(fit.slope) * 180) / Math.PI);
    for (const foot of feet) residuals.push(foot.y - fit.at(foot.x));
    middles.push(fit.at((line.words[0]!.x0 + line.words.at(-1)!.x1) / 2));
  }

  const spacing = middles
    .slice(1)
    .map((y, i) => y - middles[i]!)
    .filter((step) => step > xHeight);
  const positiveGaps = gaps.filter((gap) => gap > 0);

  // Width of the pen from area and outline: an even line has outline = 2 * length.
  let area = 0;
  let edge = 0;
  const { width, height, data } = binary;
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      if (data[y * width + x] !== 1) continue;
      area++;
      if (data[y * width + x + 1] === 0) edge++;
      if (data[y * width + x - 1] === 0) edge++;
      if (data[(y + 1) * width + x] === 0) edge++;
      if (data[(y - 1) * width + x] === 0) edge++;
    }
  }

  return {
    lines: lines.length,
    words,
    lineSpacing: median(spacing) / xHeight,
    lineSpacingVariation: mean(spacing) > 0 ? std(spacing) / mean(spacing) : 0,
    lineSlopeSpread: std(slopes),
    baselineSpread: std(residuals) / xHeight,
    wordGap: median(positiveGaps) / xHeight,
    wordGapVariation: mean(positiveGaps) > 0 ? std(positiveGaps) / mean(positiveGaps) : 0,
    sizeVariation: mean(sizes) > 0 ? std(sizes) / mean(sizes) : 0,
    marksPerWord: marks / Math.max(1, words),
    slant: median(slants),
    slantSpread: std(slants),
    leftSpread: std(lefts) / xHeight,
    rightSpread: std(rights) / xHeight,
    strokeWidth: edge > 0 ? (2 * area) / edge / xHeight : 0,
  };
}

/** Median and spread of each measure over several pages. */
export interface MeasureRange {
  low: number;
  median: number;
  high: number;
}

export type MeasureSummary = Record<MeasureName, MeasureRange>;

const NAMES: MeasureName[] = [
  'lineSpacing',
  'lineSpacingVariation',
  'lineSlopeSpread',
  'baselineSpread',
  'wordGap',
  'wordGapVariation',
  'sizeVariation',
  'marksPerWord',
  'slant',
  'slantSpread',
  'leftSpread',
  'rightSpread',
  'strokeWidth',
];

/** The middle of each measure, with the range the middle 80% of pages falls in. */
export function summarizeMeasures(pages: readonly PageMeasure[]): MeasureSummary {
  const at = (sorted: number[], share: number): number =>
    sorted[Math.round(share * (sorted.length - 1))]!;
  return Object.fromEntries(
    NAMES.map((name) => {
      const sorted = pages.map((page) => page[name]).sort((a, b) => a - b);
      return [name, { low: at(sorted, 0.1), median: at(sorted, 0.5), high: at(sorted, 0.9) }];
    }),
  ) as MeasureSummary;
}

/**
 * How far a page's measures sit from the real range, 0 being inside it on every measure.
 * Each measure counts in units of the real range's own width, so all weigh the same.
 */
export function distanceFromReal(page: PageMeasure, real: MeasureSummary): number {
  let total = 0;
  for (const name of NAMES) {
    const { low, high, median: middle } = real[name];
    const width = Math.max(high - low, Math.abs(middle) * 0.1, 1e-3);
    const value = page[name];
    const outside = value < low ? low - value : value > high ? value - high : 0;
    total += (outside / width) ** 2;
  }
  return Math.sqrt(total / NAMES.length);
}
