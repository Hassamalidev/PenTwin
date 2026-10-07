/** Absolute-coordinate path commands. Everything the engine draws is reduced to these. */
export type PathCommand =
  | { type: 'M'; x: number; y: number }
  | { type: 'L'; x: number; y: number }
  | { type: 'Q'; x1: number; y1: number; x: number; y: number }
  | { type: 'C'; x1: number; y1: number; x2: number; y2: number; x: number; y: number }
  | { type: 'Z' };

export type PointFn = (x: number, y: number) => readonly [number, number];

const TOKEN = /([a-zA-Z])|([-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?)/g;
const ARG_COUNT: Record<string, number> = { M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2, Z: 0 };

/** Parses SVG path data into absolute M/L/Q/C/Z commands. Arcs are not supported. */
export function parsePath(d: string): PathCommand[] {
  const out: PathCommand[] = [];
  let x = 0;
  let y = 0;
  let startX = 0;
  let startY = 0;
  // Previous control point, for the smooth S/T shorthands.
  let ctrlX = 0;
  let ctrlY = 0;
  let prev = '';

  let letter = '';
  let args: number[] = [];

  const flush = (): void => {
    if (!letter) return;
    const upper = letter.toUpperCase();
    const count = ARG_COUNT[upper];
    if (count === undefined) throw new Error(`Unsupported path command "${letter}"`);
    const relative = letter !== upper;

    if (count === 0) {
      out.push({ type: 'Z' });
      x = startX;
      y = startY;
      prev = 'Z';
      return;
    }
    if (args.length === 0 || args.length % count !== 0) {
      throw new Error(`Path command "${letter}" has ${args.length} arguments`);
    }

    for (let i = 0; i < args.length; i += count) {
      const a = args.slice(i, i + count) as [number, number, number, number, number, number];
      const ox = relative ? x : 0;
      const oy = relative ? y : 0;
      // Extra coordinate pairs after a moveto are implicit linetos.
      const op = upper === 'M' && i > 0 ? 'L' : upper;

      switch (op) {
        case 'M':
          x = startX = a[0] + ox;
          y = startY = a[1] + oy;
          out.push({ type: 'M', x, y });
          break;
        case 'L':
          x = a[0] + ox;
          y = a[1] + oy;
          out.push({ type: 'L', x, y });
          break;
        case 'H':
          x = a[0] + ox;
          out.push({ type: 'L', x, y });
          break;
        case 'V':
          y = a[0] + oy;
          out.push({ type: 'L', x, y });
          break;
        case 'C':
        case 'S': {
          const smooth = op === 'S';
          const reflect = prev === 'C' || prev === 'S';
          const x1 = smooth ? (reflect ? 2 * x - ctrlX : x) : a[0] + ox;
          const y1 = smooth ? (reflect ? 2 * y - ctrlY : y) : a[1] + oy;
          const k = smooth ? 0 : 2;
          ctrlX = a[k] + ox;
          ctrlY = a[k + 1]! + oy;
          x = a[k + 2]! + ox;
          y = a[k + 3]! + oy;
          out.push({ type: 'C', x1, y1, x2: ctrlX, y2: ctrlY, x, y });
          break;
        }
        case 'Q':
        case 'T': {
          const smooth = op === 'T';
          const reflect = prev === 'Q' || prev === 'T';
          ctrlX = smooth ? (reflect ? 2 * x - ctrlX : x) : a[0] + ox;
          ctrlY = smooth ? (reflect ? 2 * y - ctrlY : y) : a[1] + oy;
          const k = smooth ? 0 : 2;
          x = a[k] + ox;
          y = a[k + 1]! + oy;
          out.push({ type: 'Q', x1: ctrlX, y1: ctrlY, x, y });
          break;
        }
      }
      prev = op;
    }
  };

  for (const match of d.matchAll(TOKEN)) {
    if (match[1]) {
      flush();
      letter = match[1];
      args = [];
    } else {
      if (!letter) throw new Error('Path data must start with a command');
      args.push(Number(match[2]));
    }
  }
  flush();
  return out;
}

/** Maps every point (including control points) through `fn`. */
export function transformPath(path: readonly PathCommand[], fn: PointFn): PathCommand[] {
  return path.map((c): PathCommand => {
    switch (c.type) {
      case 'Z':
        return c;
      case 'M':
      case 'L': {
        const [x, y] = fn(c.x, c.y);
        return { type: c.type, x, y };
      }
      case 'Q': {
        const [x1, y1] = fn(c.x1, c.y1);
        const [x, y] = fn(c.x, c.y);
        return { type: 'Q', x1, y1, x, y };
      }
      case 'C': {
        const [x1, y1] = fn(c.x1, c.y1);
        const [x2, y2] = fn(c.x2, c.y2);
        const [x, y] = fn(c.x, c.y);
        return { type: 'C', x1, y1, x2, y2, x, y };
      }
    }
  });
}

export function serializePath(path: readonly PathCommand[], decimals = 2): string {
  const n = (v: number): string => {
    const s = v.toFixed(decimals);
    return s.includes('.') ? s.replace(/\.?0+$/, '') || '0' : s;
  };
  return path
    .map((c) => {
      switch (c.type) {
        case 'Z':
          return 'Z';
        case 'M':
        case 'L':
          return `${c.type}${n(c.x)} ${n(c.y)}`;
        case 'Q':
          return `Q${n(c.x1)} ${n(c.y1)} ${n(c.x)} ${n(c.y)}`;
        case 'C':
          return `C${n(c.x1)} ${n(c.y1)} ${n(c.x2)} ${n(c.y2)} ${n(c.x)} ${n(c.y)}`;
      }
    })
    .join('');
}

export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** Bounding box of all points, control points included (a safe over-estimate for curves). */
export function pathBounds(path: readonly PathCommand[]): Bounds {
  const b: Bounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  transformPath(path, (x, y) => {
    b.minX = Math.min(b.minX, x);
    b.minY = Math.min(b.minY, y);
    b.maxX = Math.max(b.maxX, x);
    b.maxY = Math.max(b.maxY, y);
    return [x, y];
  });
  return b;
}
