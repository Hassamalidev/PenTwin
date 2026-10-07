import type { PathCommand } from '@pentwin/engine';
import type { BinaryImage } from './image';

type Point = readonly [number, number];

/**
 * Walks the boundary between ink and paper and returns it as closed polygons whose
 * corners lie on pixel corners. Outlines run one way and holes (the inside of an "o")
 * the other, so filling the result with the non-zero rule leaves the holes open.
 */
function traceOutlines({ width, height, data }: BinaryImage): Point[][] {
  const ink = (x: number, y: number): boolean =>
    x >= 0 && y >= 0 && x < width && y < height && data[y * width + x] === 1;
  const stride = width + 1;
  // For every pixel corner, the corners its boundary edges lead to (at most two).
  const next = new Map<number, number[]>();
  const edge = (x0: number, y0: number, x1: number, y1: number): void => {
    const from = y0 * stride + x0;
    const list = next.get(from);
    if (list) list.push(y1 * stride + x1);
    else next.set(from, [y1 * stride + x1]);
  };
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!ink(x, y)) continue;
      if (!ink(x, y - 1)) edge(x, y, x + 1, y);
      if (!ink(x + 1, y)) edge(x + 1, y, x + 1, y + 1);
      if (!ink(x, y + 1)) edge(x + 1, y + 1, x, y + 1);
      if (!ink(x - 1, y)) edge(x, y + 1, x, y);
    }
  }

  const loops: Point[][] = [];
  for (const [start, targets] of next) {
    while (targets.length > 0) {
      const loop: Point[] = [];
      let at = start;
      do {
        loop.push([at % stride, Math.floor(at / stride)]);
        at = next.get(at)!.pop()!;
      } while (at !== start);
      loops.push(loop);
    }
  }
  return loops;
}

const distanceToSegment = (p: Point, a: Point, b: Point): number => {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const length = dx * dx + dy * dy;
  const t =
    length === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / length));
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
};

/** Douglas-Peucker: drops points that lie within `tolerance` of the simplified line. */
function simplifyOpen(points: readonly Point[], tolerance: number): Point[] {
  if (points.length < 3) return [...points];
  const first = points[0]!;
  const last = points.at(-1)!;
  let worst = 0;
  let index = 0;
  for (let i = 1; i < points.length - 1; i++) {
    const d = distanceToSegment(points[i]!, first, last);
    if (d > worst) {
      worst = d;
      index = i;
    }
  }
  if (worst <= tolerance) return [first, last];
  return [
    ...simplifyOpen(points.slice(0, index + 1), tolerance).slice(0, -1),
    ...simplifyOpen(points.slice(index), tolerance),
  ];
}

function simplifyClosed(loop: readonly Point[], tolerance: number): Point[] {
  // Split the ring at its two most distant points, then simplify each half.
  let far = 0;
  let farDistance = -1;
  loop.forEach((p, i) => {
    const d = Math.hypot(p[0] - loop[0]![0], p[1] - loop[0]![1]);
    if (d > farDistance) {
      farDistance = d;
      far = i;
    }
  });
  const a = simplifyOpen(loop.slice(0, far + 1), tolerance);
  const b = simplifyOpen([...loop.slice(far), loop[0]!], tolerance);
  return [...a.slice(0, -1), ...b.slice(0, -1)];
}

const area = (loop: readonly Point[]): number =>
  loop.reduce((sum, p, i) => {
    const q = loop[(i + 1) % loop.length]!;
    return sum + p[0] * q[1] - q[0] * p[1];
  }, 0) / 2;

/**
 * Turns a glyph bitmap into a smooth filled outline.
 *
 * The pixel staircase is simplified to a polygon and then rounded: each polygon corner
 * becomes the control point of a curve running between the midpoints of its two sides.
 * `tolerance` is in pixels; higher means fewer points and a smaller, smoother path.
 */
export function vectorize(bitmap: BinaryImage, tolerance = 0.9): PathCommand[] {
  const path: PathCommand[] = [];
  for (const outline of traceOutlines(bitmap)) {
    const loop = simplifyClosed(outline, tolerance);
    // Specks and slivers add size, not shape.
    if (loop.length < 3 || Math.abs(area(loop)) < 3) continue;

    const mid = (i: number): Point => {
      const p = loop[i % loop.length]!;
      const q = loop[(i + 1) % loop.length]!;
      return [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
    };
    const [startX, startY] = mid(loop.length - 1);
    path.push({ type: 'M', x: startX, y: startY });
    loop.forEach((corner, i) => {
      const [x, y] = mid(i);
      path.push({ type: 'Q', x1: corner[0], y1: corner[1], x, y });
    });
    path.push({ type: 'Z' });
  }
  return path;
}
