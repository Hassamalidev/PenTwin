import type { PathCommand } from './path';

/**
 * How the tip of a pen meets the paper. A plotter draws every stroke at one width with
 * round ends; a hand does not. The pen lands a little heavy, thins as it lifts off, and
 * a broad nib is wide on strokes across its edge and thin along it.
 */
export interface PenModel {
  /** 0 to 1. How far a stroke thins as the pen lifts at its end. */
  taper: number;
  /** Fraction. Extra width where the pen lands at the start of a stroke. */
  landing: number;
  /** 0 to 1. How much the width depends on the direction of travel. 0 for a round tip. */
  nib: number;
  /** Degrees. Direction a broad nib is held at; strokes along it are thinnest. */
  nibAngle?: number;
}

interface Point {
  x: number;
  y: number;
}

/** Flattening step along curves, in mm. Fine enough that no corner shows at print size. */
const STEP = 0.25;
/** Cosine of the turn (75 degrees) between two steps that starts a new piece of outline. */
const CORNER_COS = Math.cos((75 * Math.PI) / 180);
/** How far, in mm, a simplified outline may stray from the exact one. Far below a printed pixel. */
const TOLERANCE = 0.025;
/** Points on each round end of a piece. */
const CAP_POINTS = 4;
/** Mean of |sin| over a full turn, so a broad nib averages out to the pen's own width. */
const MEAN_SIN = 2 / Math.PI;

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/** Splits a path into polylines, one per pen-down (M), with curves sampled. */
export function flatten(path: readonly PathCommand[]): Point[][] {
  const lines: Point[][] = [];
  let x = 0;
  let y = 0;
  let start: Point = { x: 0, y: 0 };
  const add = (p: Point): void => {
    const line = lines.at(-1);
    if (!line) return;
    const last = line.at(-1)!;
    if (Math.abs(last.x - p.x) > 1e-4 || Math.abs(last.y - p.y) > 1e-4) line.push(p);
  };
  for (const c of path) {
    switch (c.type) {
      case 'M':
        start = { x: c.x, y: c.y };
        lines.push([start]);
        break;
      case 'L':
        add({ x: c.x, y: c.y });
        break;
      case 'Q': {
        const length = Math.hypot(c.x1 - x, c.y1 - y) + Math.hypot(c.x - c.x1, c.y - c.y1);
        const steps = Math.max(2, Math.min(24, Math.ceil(length / STEP)));
        for (let i = 1; i <= steps; i++) {
          const t = i / steps;
          add({
            x: lerp(lerp(x, c.x1, t), lerp(c.x1, c.x, t), t),
            y: lerp(lerp(y, c.y1, t), lerp(c.y1, c.y, t), t),
          });
        }
        break;
      }
      case 'C': {
        const length =
          Math.hypot(c.x1 - x, c.y1 - y) +
          Math.hypot(c.x2 - c.x1, c.y2 - c.y1) +
          Math.hypot(c.x - c.x2, c.y - c.y2);
        const steps = Math.max(2, Math.min(24, Math.ceil(length / STEP)));
        for (let i = 1; i <= steps; i++) {
          const t = i / steps;
          const u = 1 - t;
          add({
            x: u * u * u * x + 3 * u * u * t * c.x1 + 3 * u * t * t * c.x2 + t * t * t * c.x,
            y: u * u * u * y + 3 * u * u * t * c.y1 + 3 * u * t * t * c.y2 + t * t * t * c.y,
          });
        }
        break;
      }
      case 'Z':
        add(start);
        x = start.x;
        y = start.y;
        continue;
    }
    x = c.x;
    y = c.y;
  }
  return lines;
}

const round = (v: number): number => Math.round(v * 100) / 100;

/** A closed polygon as path commands. */
function polygon(points: readonly Point[]): PathCommand[] {
  const out: PathCommand[] = [{ type: 'M', x: round(points[0]!.x), y: round(points[0]!.y) }];
  for (let i = 1; i < points.length; i++) {
    out.push({ type: 'L', x: round(points[i]!.x), y: round(points[i]!.y) });
  }
  out.push({ type: 'Z' });
  return out;
}

/**
 * A pen dab: what a dot or a very short stroke leaves. It is drawn out along the tiny
 * movement the pen made, so no two full stops are the same round blob.
 */
function dab(points: readonly Point[], radius: number): PathCommand[] {
  const from = points[0]!;
  const to = points.at(-1)!;
  const cx = (from.x + to.x) / 2;
  const cy = (from.y + to.y) / 2;
  const length = Math.hypot(to.x - from.x, to.y - from.y);
  const angle = length > 0 ? Math.atan2(to.y - from.y, to.x - from.x) : 0;
  const rx = radius + length / 2;
  const ry = radius * 0.88;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const outline = Array.from({ length: 10 }, (_, i) => {
    // The same way round as every outline below.
    const a = -(i / 10) * Math.PI * 2;
    const x = Math.cos(a) * rx;
    const y = Math.sin(a) * ry;
    return { x: cx + x * cos - y * sin, y: cy + x * sin + y * cos };
  });
  return polygon(outline);
}

/** Drops points that lie within `TOLERANCE` of the line through their neighbours. */
function simplify(points: readonly Point[]): Point[] {
  if (points.length < 3) return [...points];
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    const p = points[a]!;
    const q = points[b]!;
    const dx = q.x - p.x;
    const dy = q.y - p.y;
    const length = Math.hypot(dx, dy);
    let worst = -1;
    let far = TOLERANCE;
    for (let i = a + 1; i < b; i++) {
      // A closed loop starts and ends on the same point: measure from that point instead.
      const d =
        length > 1e-9
          ? Math.abs((points[i]!.x - p.x) * dy - (points[i]!.y - p.y) * dx) / length
          : Math.hypot(points[i]!.x - p.x, points[i]!.y - p.y);
      if (d > far) {
        far = d;
        worst = i;
      }
    }
    if (worst >= 0) {
      keep[worst] = 1;
      stack.push([a, worst], [worst, b]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

/** Unit direction of travel at each point, from its neighbours. */
function tangents(points: readonly Point[]): Point[] {
  const n = points.length;
  return points.map((_, i) => {
    const a = points[Math.max(0, i - 1)]!;
    const b = points[Math.min(n - 1, i + 1)]!;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const length = Math.hypot(dx, dy) || 1e-9;
    return { x: dx / length, y: dy / length };
  });
}

/**
 * Outline of one piece of a stroke with round ends. Every outline runs the same way
 * round, so overlapping pieces fill as one shape under the nonzero rule instead of
 * cancelling each other out.
 */
function outlinePiece(points: readonly Point[], widths: readonly number[]): Point[] {
  const n = points.length;
  const t = tangents(points);
  const left: Point[] = [];
  const right: Point[] = [];
  for (let i = 0; i < n; i++) {
    const r = widths[i]! / 2;
    const p = points[i]!;
    // The normal is the tangent turned a quarter.
    left.push({ x: p.x - t[i]!.y * r, y: p.y + t[i]!.x * r });
    right.push({ x: p.x + t[i]!.y * r, y: p.y - t[i]!.x * r });
  }
  const cap = (center: Point, dir: Point, r: number): Point[] => {
    const angle = Math.atan2(dir.y, dir.x);
    return Array.from({ length: CAP_POINTS - 1 }, (_, k) => {
      const a = angle + Math.PI / 2 - (Math.PI * (k + 1)) / CAP_POINTS;
      return { x: center.x + Math.cos(a) * r, y: center.y + Math.sin(a) * r };
    });
  };
  const back = { x: -t[0]!.x, y: -t[0]!.y };
  return [
    ...left,
    ...cap(points[n - 1]!, t[n - 1]!, widths[n - 1]! / 2),
    ...right.reverse(),
    ...cap(points[0]!, back, widths[0]! / 2),
  ];
}

/** Width of the line at each point of one pen-down, before any corner splitting. */
function widthProfile(points: readonly Point[], width: number, pen: PenModel): number[] {
  const n = points.length;
  const along = [0];
  for (let i = 1; i < n; i++) {
    const p = points[i]!;
    const q = points[i - 1]!;
    along.push(along[i - 1]! + Math.hypot(p.x - q.x, p.y - q.y));
  }
  const length = along[n - 1]!;
  const landingZone = width * 1.6;
  const liftZone = Math.min(length * 0.4, width * 5);
  const nibAngle = ((pen.nibAngle ?? 40) * Math.PI) / 180;
  const cosNib = Math.cos(nibAngle);
  const sinNib = Math.sin(nibAngle);

  let nibFactor: number[] | undefined;
  if (pen.nib > 0) {
    // Page y runs down; the nib angle is measured the way a writer sees it, up from the
    // line. |sin(travel - nib)| with travel = atan2(-dy, dx), written without the angle.
    const direction = tangents(points).map((d) => {
      const across = Math.abs(-d.y * cosNib - d.x * sinNib);
      return 1 - pen.nib + (pen.nib * across) / MEAN_SIN;
    });
    // The nib turns smoothly through a curve; average out single-step jumps.
    nibFactor = direction.map(
      (v, i) => (direction[Math.max(0, i - 1)]! + 2 * v + direction[Math.min(n - 1, i + 1)]!) / 4,
    );
  }

  return along.map((s, i) => {
    const landing = 1 + pen.landing * Math.exp(-((s / landingZone) ** 2));
    const t = liftZone > 0 ? Math.max(0, Math.min(1, 1 - (length - s) / liftZone)) : 0;
    const lift = 1 - pen.taper * t * t * (3 - 2 * t);
    return Math.max(width * 0.12, width * landing * lift * (nibFactor?.[i] ?? 1));
  });
}

export interface PenOutline {
  /** Filled outline of every pen-down in the path. */
  path: PathCommand[];
  /** Thinnest and thickest the line gets, in mm. */
  min: number;
  max: number;
}

/**
 * Turns a centre-line path drawn with a pen of `width` mm into filled outlines whose
 * width follows the pen: heavier where it lands, thinning as it lifts, wider across a
 * broad nib. The result stays vector, so PDF output keeps it.
 */
export function outlineStroke(
  path: readonly PathCommand[],
  width: number,
  pen: PenModel,
): PenOutline {
  const out: PathCommand[] = [];
  let min = Infinity;
  let max = 0;
  for (const raw of flatten(path)) {
    // Points on a straight run add nothing but work; the outline is built from the rest.
    const points = simplify(raw);
    const length = raw
      .slice(1)
      .reduce((sum, p, i) => sum + Math.hypot(p.x - raw[i]!.x, p.y - raw[i]!.y), 0);
    if (points.length < 2 || length < width * 0.6) {
      // Too short to show direction: the pen just touches down.
      const r = (width / 2) * (1 + pen.landing * 0.6);
      out.push(...dab(points, r));
      min = Math.min(min, r * 2);
      max = Math.max(max, r * 2);
      continue;
    }
    const widths = widthProfile(points, width, pen);
    for (const w of widths) {
      min = Math.min(min, w);
      max = Math.max(max, w);
    }
    // A sharp corner gets its own round end on each side instead of a spike or a pinch.
    let from = 0;
    for (let i = 1; i < points.length - 1; i++) {
      const p = points[i - 1]!;
      const q = points[i]!;
      const r = points[i + 1]!;
      const ux = q.x - p.x;
      const uy = q.y - p.y;
      const vx = r.x - q.x;
      const vy = r.y - q.y;
      const cos = (ux * vx + uy * vy) / (Math.hypot(ux, uy) * Math.hypot(vx, vy) || 1e-9);
      if (cos < CORNER_COS) {
        out.push(...polygon(outlinePiece(points.slice(from, i + 1), widths.slice(from, i + 1))));
        from = i;
      }
    }
    out.push(...polygon(outlinePiece(points.slice(from), widths.slice(from))));
  }
  return { path: out, min: Number.isFinite(min) ? min : width, max: max || width };
}
