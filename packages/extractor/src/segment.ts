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

/** A mark that is no part of the writing: a scanner's edge, a fold, a ruled line. */
const isStray = (c: Component, binary: BinaryImage): boolean => {
  const { width, height } = binary;
  const w = c.x1 - c.x0;
  const h = c.y1 - c.y0;
  const longAndThin = (w > width * 0.25 && h < w * 0.08) || (h > height * 0.25 && w < h * 0.08);
  return longAndThin || h > height * 0.3 || w > width * 0.7;
};

interface Track {
  /** Centres of the marks followed so far, left to right. */
  points: { x: number; y: number }[];
  /** Right edge of the last mark. */
  end: number;
  members: Component[];
}

/** Height of the line at `x`, between the marks followed. Flat beyond both ends. */
const trackAt = (points: Track['points'], x: number): number => {
  if (x <= points[0]!.x) return points[0]!.y;
  for (let i = 1; i < points.length; i++) {
    const b = points[i]!;
    if (x <= b.x) {
      const a = points[i - 1]!;
      return a.y + ((b.y - a.y) * (x - a.x)) / Math.max(1, b.x - a.x);
    }
  }
  return points.at(-1)!.y;
};

/**
 * Finds the lines of writing by following the marks from left to right. Real lines slope
 * and wander, often by more than the gap between them over a full width, so a row-by-row
 * ink profile of the page smears them together. Followed mark by mark, each only has to
 * continue from where the last one was.
 */
function trackLines(components: readonly Component[], binary: BinaryImage): Track[] {
  const heights = components
    .map((c) => c.y1 - c.y0)
    .filter((h) => h >= 3)
    .sort((a, b) => a - b);
  if (heights.length === 0) return [];
  // The taller marks are letters and words; the shorter ones are dots and commas.
  const body = heights[Math.floor(heights.length * 0.6)]!;
  const bodies = components
    .filter((c) => !isStray(c, binary) && c.y1 - c.y0 >= body * 0.45)
    .sort((a, b) => a.x0 - b.x0);

  let tracks: Track[] = [];
  for (const c of bodies) {
    const y = (c.y0 + c.y1) / 2;
    let best: Track | undefined;
    let bestCost = Infinity;
    for (const track of tracks) {
      const last = track.points.at(-1)!;
      const before = track.points.at(-5) ?? track.points[0]!;
      const run = last.x - before.x;
      const slope = run > 0 ? Math.max(-0.12, Math.min(0.12, (last.y - before.y) / run)) : 0;
      const expected = last.y + slope * (c.x0 - last.x);
      const off = Math.abs(y - expected);
      const gap = c.x0 - track.end;
      if (off > body * 0.75 || gap > body * 16) continue;
      const cost = off + Math.max(0, gap) * 0.03;
      if (cost < bestCost) {
        bestCost = cost;
        best = track;
      }
    }
    if (best) {
      best.points.push({ x: (c.x0 + c.x1) / 2, y });
      best.end = Math.max(best.end, c.x1);
      best.members.push(c);
    } else {
      tracks.push({ points: [{ x: (c.x0 + c.x1) / 2, y }], end: c.x1, members: [c] });
    }
  }

  // Pieces of one line that a wide gap kept apart: side by side, at the same height.
  tracks.sort((a, b) => a.points[0]!.x - b.points[0]!.x);
  const merged: Track[] = [];
  for (const track of tracks) {
    const same = merged.find(
      (other) =>
        track.points[0]!.x > other.end - body &&
        Math.abs(track.points[0]!.y - other.points.at(-1)!.y) < body * 0.9,
    );
    if (same) {
      same.points.push(...track.points);
      same.members.push(...track.members);
      same.end = Math.max(same.end, track.end);
    } else {
      merged.push(track);
    }
  }
  tracks = merged;
  // A lone mark is a stray tail or a dot: it joins whichever line is nearest, below.
  const real = tracks.filter((t) => t.members.length >= 2 || t.end - t.points[0]!.x > body * 4);
  return real.sort(
    (a, b) =>
      a.points.reduce((sum, p) => sum + p.y, 0) / a.points.length -
      b.points.reduce((sum, p) => sum + p.y, 0) / b.points.length,
  );
}

/**
 * The dense band of a line, measured along the line itself so that a slope does not widen
 * it: roughly the x-height zone. Returned as offsets from the line's own path.
 */
function lineBand(
  track: Track,
  labels: Int32Array,
  width: number,
): { top: number; bottom: number; middle: number } {
  const counts = new Map<number, number>();
  for (const c of track.members) {
    for (let y = c.y0; y < c.y1; y++) {
      for (let x = c.x0; x < c.x1; x++) {
        if (labels[y * width + x] !== c.id) continue;
        const offset = Math.round(y - trackAt(track.points, x));
        counts.set(offset, (counts.get(offset) ?? 0) + 1);
      }
    }
  }
  const offsets = [...counts.keys()].sort((a, b) => a - b);
  const value = (o: number): number =>
    (counts.get(o - 1) ?? 0) / 4 + (counts.get(o) ?? 0) / 2 + (counts.get(o + 1) ?? 0) / 4;
  const peak = Math.max(...offsets.map(value));
  const dense = offsets.filter((o) => value(o) >= peak * 0.45);
  const middle = track.points.reduce((sum, p) => sum + p.y, 0) / track.points.length;
  return { top: middle + dense[0]!, bottom: middle + dense.at(-1)! + 1, middle };
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
  // A stray mark far along a line makes a huge gap, which would pull the "between words"
  // cluster away from real word gaps. Gaps beyond a few letters wide all count the same.
  const sorted = gaps.map((g) => Math.min(g, 4)).sort((a, b) => a - b);
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
  const tracks = trackLines(components, binary);
  const bands = tracks.map((track) => lineBand(track, labels, binary.width));
  const typicalHeight = median(bands.map((b) => b.bottom - b.top));

  // Each mark goes to the line whose path it is nearest to.
  const perLine: Component[][] = bands.map(() => []);
  for (const c of components) {
    if (isStray(c, binary)) continue;
    const centre = (c.y0 + c.y1) / 2;
    const middle = (c.x0 + c.x1) / 2;
    let best = -1;
    let bestDistance = Infinity;
    tracks.forEach((track, i) => {
      const band = bands[i]!;
      const shift = trackAt(track.points, middle) - band.middle;
      const distance = Math.max(band.top + shift - centre, centre - band.bottom - shift, 0);
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
