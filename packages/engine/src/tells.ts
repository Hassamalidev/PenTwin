import { pathBounds, serializePath, transformPath, type Bounds, type PathCommand } from './path';
import { outlineStroke } from './pen';
import type { PageScene } from './render';
import { wholeLetters, type InkStroke } from './writer';

/**
 * Measures, from rendered pages alone, the signs that most quickly give away writing
 * that was not done by hand. Each is something a document examiner or a sharp teacher
 * notices: letters that are exact copies, lines that sit on a ruler, a pen of one
 * weight, dots placed by a template, words all parallel to their line.
 *
 * The limits are this project's own judgement, set so that a page without any
 * variation fails every one and a neat but human page passes. They are NOT measured
 * from real people's writing, and passing them is not evidence that people cannot tell.
 * They exist to stop a change from quietly making the output more mechanical.
 */
export interface TellReport {
  /** Letters measured. */
  letters: number;
  /** Share of letters that are an exact copy of an earlier one, 0 to 1. */
  repeats: number;
  /** Spread of letter bottoms around each line's straight fit, in x-heights. */
  baselineSpread: number;
  /**
   * How much the pen's width changes along and between strokes (relative). Undefined for
   * handwriting made of filled outlines, whose width comes from the writer's own pen.
   */
  penVariation?: number;
  /** Spread of the i-dot's offset from its stem, in x-heights. Undefined with fewer than 3. */
  dotSpread?: number;
  /** Spread of word tilts inside lines, in degrees. Undefined with fewer than 3 words. */
  wordTiltSpread?: number;
}

export type TellName = Exclude<keyof TellReport, 'letters'>;

export interface TellLimit {
  /** What the reader would notice. */
  label: string;
  /** `max`: must not exceed `value`. `min`: must reach it. */
  kind: 'max' | 'min';
  value: number;
  unit: string;
}

export const TELL_LIMITS: Record<TellName, TellLimit> = {
  repeats: { label: 'Identical letters', kind: 'max', value: 0.02, unit: 'share' },
  baselineSpread: { label: 'Ruler-straight lines', kind: 'min', value: 0.025, unit: 'x-height' },
  penVariation: { label: 'Pen of one weight', kind: 'min', value: 0.15, unit: 'relative' },
  dotSpread: { label: 'Dots placed by template', kind: 'min', value: 0.05, unit: 'x-height' },
  // About three times what a page with no variation measures in the plain test letters.
  wordTiltSpread: { label: 'Words all parallel', kind: 'min', value: 0.5, unit: 'degrees' },
};

/** Small letters that sit on the line and have no tail: their bottoms trace the baseline. */
const ON_LINE = new Set([...'acemnorsuvwxz']);

const std = (values: readonly number[]): number => {
  if (values.length < 2) return 0;
  const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
  return Math.sqrt(values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / (values.length - 1));
};

/** Least-squares line through points; returns slope and the residuals. */
function fit(points: readonly { x: number; y: number }[]): { slope: number; residuals: number[] } {
  const n = points.length;
  const mx = points.reduce((s, p) => s + p.x, 0) / n;
  const my = points.reduce((s, p) => s + p.y, 0) / n;
  const sxx = points.reduce((s, p) => s + (p.x - mx) ** 2, 0);
  const sxy = points.reduce((s, p) => s + (p.x - mx) * (p.y - my), 0);
  const slope = sxx > 0 ? sxy / sxx : 0;
  return { slope, residuals: points.map((p) => p.y - (my + slope * (p.x - mx))) };
}

function split(path: readonly PathCommand[]): PathCommand[][] {
  const parts: PathCommand[][] = [];
  for (const command of path) {
    if (command.type === 'M' || parts.length === 0) parts.push([]);
    parts.at(-1)!.push(command);
  }
  return parts;
}

const rawFoot = (l: Letter) => ({ x: (l.box.minX + l.box.maxX) / 2, y: l.box.maxY });

function groupBy<T, K>(items: readonly T[], key: (item: T) => K): Map<K, T[]> {
  const groups = new Map<K, T[]>();
  for (const item of items) {
    const list = groups.get(key(item)) ?? [];
    list.push(item);
    groups.set(key(item), list);
  }
  return groups;
}

interface Letter {
  char: string;
  path: PathCommand[];
  box: Bounds;
  line: number;
}

/** Audits rendered pages. `xHeight` is the size the text was written at, in mm. */
export function auditTells(scenes: readonly PageScene[], xHeight: number): TellReport {
  const letters: Letter[] = [];
  const penStrokes: InkStroke[] = [];
  let filled = false;
  for (const scene of scenes) {
    filled ||= scene.paint === 'fill';
    const text = (s: InkStroke): boolean => s.char !== '' && !s.struck && !s.retrace;
    penStrokes.push(...scene.strokes.filter(text));
    for (const stroke of wholeLetters(scene.strokes).filter(text)) {
      const box = pathBounds(stroke.path);
      // The line whose baseline is closest to the letter's foot.
      let line = 0;
      scene.baselines.forEach((y, i) => {
        if (Math.abs(y - box.maxY) < Math.abs(scene.baselines[line]! - box.maxY)) line = i;
      });
      letters.push({
        char: stroke.char,
        path: stroke.path,
        box,
        line: line + 1000 * scenes.indexOf(scene),
      });
    }
  }

  // Exact copies: the same outline, wherever it was placed.
  const seen = new Set<string>();
  let repeats = 0;
  let compared = 0;
  for (const letter of letters) {
    // A full stop or comma is too small to tell a copy from a fresh mark at this tolerance.
    if (
      Math.max(letter.box.maxX - letter.box.minX, letter.box.maxY - letter.box.minY) <
      xHeight * 0.4
    ) {
      continue;
    }
    compared++;
    const key =
      letter.char +
      serializePath(
        transformPath(letter.path, (x, y) => [x - letter.box.minX, y - letter.box.minY]),
        1,
      );
    if (seen.has(key)) repeats++;
    else seen.add(key);
  }

  // Each letter has its own foot: a round o dips below the line in any font. Measure
  // each letter's foot against that letter's usual place, not against the bare line.
  const feet = new Map<string, number[]>();
  for (const [, list] of groupBy(letters, (l) => l.line)) {
    const onLine = list.filter((l) => ON_LINE.has(l.char));
    if (onLine.length < 4) continue;
    const lineFit = fit(onLine.map(rawFoot));
    onLine.forEach((l, i) => {
      const values = feet.get(l.char) ?? [];
      values.push(lineFit.residuals[i]!);
      feet.set(l.char, values);
    });
  }
  const usual = new Map(
    [...feet].map(([char, values]) => [char, values.reduce((s, v) => s + v, 0) / values.length]),
  );
  const foot = (l: Letter) => ({ x: rawFoot(l).x, y: l.box.maxY - (usual.get(l.char) ?? 0) });

  // Lines and words, from the letters that sit on the line.
  const byLine = new Map<number, Letter[]>();
  for (const letter of letters) {
    const list = byLine.get(letter.line) ?? [];
    list.push(letter);
    byLine.set(letter.line, list);
  }
  const residuals: number[] = [];
  const tilts: number[] = [];
  for (const list of byLine.values()) {
    list.sort((a, b) => a.box.minX - b.box.minX);
    const onLine = list.filter((l) => ON_LINE.has(l.char));
    if (onLine.length < 4) continue;
    const lineFit = fit(onLine.map(foot));
    residuals.push(...lineFit.residuals);
    // Words: most gaps on a line are between letters, so a gap well over the typical one
    // starts a new word, whatever the hand's own spacing.
    const gaps = list.slice(1).map((l, i) => l.box.minX - list[i]!.box.maxX);
    const typical = [...gaps].sort((x, y) => x - y)[Math.floor(gaps.length / 2)] ?? 0;
    const wordGap = Math.max(xHeight * 0.42, typical * 1.8);
    let word: Letter[] = [];
    const words: Letter[][] = [word];
    list.forEach((letter, i) => {
      const prev = list[i - 1];
      if (prev && letter.box.minX - prev.box.maxX > wordGap) words.push((word = []));
      word.push(letter);
    });
    for (const w of words) {
      const points = w.filter((l) => ON_LINE.has(l.char)).map(foot);
      // A short word gives too noisy a slope to say anything about its tilt.
      if (points.length < 4 || points.at(-1)!.x - points[0]!.x < xHeight * 3) continue;
      tilts.push((Math.atan(fit(points).slope) - Math.atan(lineFit.slope)) * (180 / Math.PI));
    }
  }

  // The dot of each i against the centre of its stem.
  const dots: number[] = [];
  for (const letter of letters.filter((l) => l.char === 'i')) {
    const parts = split(letter.path).map((p) => pathBounds(p));
    if (parts.length < 2) continue;
    const height = (b: Bounds) => b.maxY - b.minY;
    const sorted = [...parts].sort((a, b) => height(b) - height(a));
    const stem = sorted[0]!;
    const dot = sorted.at(-1)!;
    if (height(dot) > xHeight * 0.6 || dot.maxY > stem.minY + xHeight * 0.2) continue;
    dots.push(((dot.minX + dot.maxX) / 2 - (stem.minX + stem.maxX) / 2) / xHeight);
  }

  // The pen: change along each stroke, and between strokes.
  let penVariation: number | undefined;
  if (!filled || penStrokes.some((s) => s.pen)) {
    const along = penStrokes.map((s) => {
      if (!s.pen) return 0;
      const { min, max } = outlineStroke(s.path, s.width, s.pen);
      return (max - min) / ((max + min) / 2);
    });
    const widths = penStrokes.map((s) => s.width);
    const meanWidth = widths.reduce((sum, w) => sum + w, 0) / Math.max(1, widths.length);
    penVariation =
      along.reduce((sum, v) => sum + v, 0) / Math.max(1, along.length) +
      (meanWidth > 0 ? std(widths) / meanWidth : 0);
  }

  return {
    letters: letters.length,
    repeats: compared ? repeats / compared : 0,
    baselineSpread: std(residuals) / xHeight,
    ...(penVariation !== undefined ? { penVariation } : {}),
    ...(dots.length >= 3 ? { dotSpread: std(dots) } : {}),
    ...(tilts.length >= 3 ? { wordTiltSpread: std(tilts) } : {}),
  };
}

export interface TellVerdict {
  name: TellName;
  limit: TellLimit;
  /** Undefined when the page gave nothing to measure (no i's, a filled bank, ...). */
  value?: number;
  pass: boolean;
}

/** Each tell with its limit and whether the page passes. Unmeasured tells pass. */
export function judgeTells(report: TellReport): TellVerdict[] {
  return (Object.keys(TELL_LIMITS) as TellName[]).map((name) => {
    const limit = TELL_LIMITS[name];
    const value = report[name];
    const pass =
      value === undefined || (limit.kind === 'max' ? value <= limit.value : value >= limit.value);
    return { name, limit, ...(value !== undefined ? { value } : {}), pass };
  });
}
