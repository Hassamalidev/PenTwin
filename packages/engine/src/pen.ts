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

/** How far, in mm, a flattened curve may stray from the true one. */
const FLATNESS = 0.02;
/** Longest straight piece along a curve, in mm, so the pen's width can change smoothly. */
const MAX_PIECE = 0.6;
/** Cosine of the turn (75 degrees) between two steps that starts a new piece of outline. */
const CORNER_COS = Math.cos((75 * Math.PI) / 180);
/** How far, in mm, a simplified outline may stray from the exact one. Far below a printed pixel. */
const TOLERANCE = 0.025;
/** Points on each round end of a piece. */
const CAP_POINTS = 4;
/** Mean of |sin| over a full turn, so a broad nib averages out to the pen's own width. */
const MEAN_SIN = 2 / Math.PI;

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/** Pieces for one curve: enough for its bend, short enough for the pen, never absurd. */
const pieces = (forBend: number, length: number): number =>
  Math.max(1, Math.min(32, Math.ceil(Math.max(forBend, length / MAX_PIECE))));

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
        // As many pieces as the bend needs to stay within FLATNESS of the curve.
        const bend = Math.hypot(x - 2 * c.x1 + c.x, y - 2 * c.y1 + c.y);
        const steps = pieces(Math.sqrt(bend / (4 * FLATNESS)), length);
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
        const bend = Math.max(
          Math.hypot(x - 2 * c.x1 + c.x2, y - 2 * c.y1 + c.y2),
          Math.hypot(c.x1 - 2 * c.x2 + c.x, c.y1 - 2 * c.y2 + c.y),
        );
        const steps = pieces(Math.sqrt((3 * bend) / (4 * FLATNESS)), length);
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

/**
 * A pen dab: what a dot or a very short stroke leaves. It is drawn out along the tiny
 * movement the pen made, so no two full stops are the same round blob.
 */
function dab(points: readonly Point[], radius: number, out: PathCommand[]): void {
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
  for (let i = 0; i < 10; i++) {
    // The same way round as every outline below.
    const a = -(i / 10) * Math.PI * 2;
    const x = Math.cos(a) * rx;
    const y = Math.sin(a) * ry;
    out.push({ type: i === 0 ? 'M' : 'L', x: cx + x * cos - y * sin, y: cy + x * sin + y * cos });
  }
  out.push({ type: 'Z' });
}

/** Drops points that lie within `TOLERANCE` of the line through their neighbours. */
function simplify(points: readonly Point[]): Point[] {
  if (points.length < 3) return [...points];
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const stack: number[] = [0, points.length - 1];
  while (stack.length) {
    const b = stack.pop()!;
    const a = stack.pop()!;
    const p = points[a]!;
    const q = points[b]!;
    const dx = q.x - p.x;
    const dy = q.y - p.y;
    const length = Math.hypot(dx, dy);
    let worst = -1;
    let far = TOLERANCE;
    for (let i = a + 1; i < b; i++) {
      const r = points[i]!;
      // A closed loop starts and ends on the same point: measure from that point instead.
      const d =
        length > 1e-9
          ? Math.abs((r.x - p.x) * dy - (r.y - p.y) * dx) / length
          : Math.hypot(r.x - p.x, r.y - p.y);
      if (d > far) {
        far = d;
        worst = i;
      }
    }
    if (worst >= 0) {
      keep[worst] = 1;
      stack.push(a, worst, worst, b);
    }
  }
  const kept: Point[] = [];
  for (let i = 0; i < points.length; i++) if (keep[i]) kept.push(points[i]!);
  return kept;
}

/**
 * Appends the outline of points `from`..`to` (inclusive) of a stroke, with round ends.
 * Every outline runs the same way round, so overlapping pieces fill as one shape under
 * the nonzero rule instead of cancelling each other out.
 */
function outlinePiece(
  points: readonly Point[],
  widths: Float64Array,
  from: number,
  to: number,
  out: PathCommand[],
): void {
  const count = to - from + 1;
  const tx = new Float64Array(count);
  const ty = new Float64Array(count);
  for (let k = 0; k < count; k++) {
    // Direction of travel from the neighbours inside this piece only, so a corner's two
    // sides each end square to their own stroke.
    const a = points[from + Math.max(0, k - 1)]!;
    const b = points[from + Math.min(count - 1, k + 1)]!;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const length = Math.hypot(dx, dy) || 1e-9;
    tx[k] = dx / length;
    ty[k] = dy / length;
  }
  // Left side forward (the normal is the tangent turned a quarter).
  for (let k = 0; k < count; k++) {
    const p = points[from + k]!;
    const r = widths[from + k]! / 2;
    out.push({ type: k === 0 ? 'M' : 'L', x: p.x - ty[k]! * r, y: p.y + tx[k]! * r });
  }
  const cap = (p: Point, dx: number, dy: number, r: number): void => {
    const angle = Math.atan2(dy, dx);
    for (let k = 1; k < CAP_POINTS; k++) {
      const a = angle + Math.PI / 2 - (Math.PI * k) / CAP_POINTS;
      out.push({ type: 'L', x: p.x + Math.cos(a) * r, y: p.y + Math.sin(a) * r });
    }
  };
  cap(points[to]!, tx[count - 1]!, ty[count - 1]!, widths[to]! / 2);
  // Right side back.
  for (let k = count - 1; k >= 0; k--) {
    const p = points[from + k]!;
    const r = widths[from + k]! / 2;
    out.push({ type: 'L', x: p.x + ty[k]! * r, y: p.y - tx[k]! * r });
  }
  cap(points[from]!, -tx[0]!, -ty[0]!, widths[from]! / 2);
  out.push({ type: 'Z' });
}

/** Width of the line at each point of one pen-down, before any corner splitting. */
function widthProfile(points: readonly Point[], width: number, pen: PenModel): Float64Array {
  const n = points.length;
  const along = new Float64Array(n);
  for (let i = 1; i < n; i++) {
    const p = points[i]!;
    const q = points[i - 1]!;
    along[i] = along[i - 1]! + Math.hypot(p.x - q.x, p.y - q.y);
  }
  const length = along[n - 1]!;
  const landingZone = width * 1.6;
  const liftZone = Math.min(length * 0.4, width * 5);

  let nibFactor: Float64Array | undefined;
  if (pen.nib > 0) {
    const nibAngle = ((pen.nibAngle ?? 40) * Math.PI) / 180;
    const cosNib = Math.cos(nibAngle);
    const sinNib = Math.sin(nibAngle);
    // Page y runs down; the nib angle is measured the way a writer sees it, up from the
    // line. |sin(travel - nib)| with travel = atan2(-dy, dx), written without the angle.
    const direction = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const a = points[Math.max(0, i - 1)]!;
      const b = points[Math.min(n - 1, i + 1)]!;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const d = Math.hypot(dx, dy) || 1e-9;
      const across = Math.abs((-dy / d) * cosNib - (dx / d) * sinNib);
      direction[i] = 1 - pen.nib + (pen.nib * across) / MEAN_SIN;
    }
    // The nib turns smoothly through a curve; average out single-step jumps.
    nibFactor = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      nibFactor[i] =
        (direction[Math.max(0, i - 1)]! + 2 * direction[i]! + direction[Math.min(n - 1, i + 1)]!) /
        4;
    }
  }

  const widths = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const s = along[i]!;
    const landing = 1 + pen.landing * Math.exp(-((s / landingZone) ** 2));
    const t = liftZone > 0 ? Math.max(0, Math.min(1, 1 - (length - s) / liftZone)) : 0;
    const lift = 1 - pen.taper * t * t * (3 - 2 * t);
    widths[i] = Math.max(width * 0.12, width * landing * lift * (nibFactor ? nibFactor[i]! : 1));
  }
  return widths;
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
    let length = 0;
    for (let i = 1; i < raw.length; i++) {
      length += Math.hypot(raw[i]!.x - raw[i - 1]!.x, raw[i]!.y - raw[i - 1]!.y);
    }
    // Points on a straight run add nothing but work; the outline is built from the rest.
    const points = simplify(raw);
    if (points.length < 2 || length < width * 0.6) {
      // Too short to show direction: the pen just touches down.
      const r = (width / 2) * (1 + pen.landing * 0.6);
      dab(points, r, out);
      min = Math.min(min, r * 2);
      max = Math.max(max, r * 2);
      continue;
    }
    const widths = widthProfile(points, width, pen);
    for (let i = 0; i < widths.length; i++) {
      if (widths[i]! < min) min = widths[i]!;
      if (widths[i]! > max) max = widths[i]!;
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
        outlinePiece(points, widths, from, i, out);
        from = i;
      }
    }
    outlinePiece(points, widths, from, points.length - 1, out);
  }
  return { path: out, min: Number.isFinite(min) ? min : width, max: max || width };
}
