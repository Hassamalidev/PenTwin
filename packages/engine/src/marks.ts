import type { Rng } from '@pentwin/shared';
import type { Glyph } from './glyphs';
import { pathBounds, transformPath, type Bounds, type PathCommand } from './path';

/**
 * Dots and crossbars: the parts of a letter a writer adds after the word is done. The
 * pen comes back to them, so they never land exactly where the letter's shape says:
 * dots fall a little to the right and high, crossbars tilt and drift. A dot sitting
 * dead centre over every stem is one of the plainest signs of a template.
 */
interface Marks {
  /** The glyph's path split at each pen-down. */
  parts: PathCommand[][];
  /** Indexes into `parts`. */
  dots: number[];
  bars: number[];
}

const DOTTED = new Set(['i', 'j']);
const CROSSED = new Set(['t', 'f']);

const cache = new WeakMap<Glyph, Marks | null>();

function split(path: readonly PathCommand[]): PathCommand[][] {
  const parts: PathCommand[][] = [];
  for (const command of path) {
    if (command.type === 'M' || parts.length === 0) parts.push([]);
    parts.at(-1)!.push(command);
  }
  return parts;
}

const inside = (a: Bounds, b: Bounds): boolean =>
  a.minX >= b.minX && a.maxX <= b.maxX && a.minY >= b.minY && a.maxY <= b.maxY;

/**
 * Finds a glyph's dots (i, j) and, for pen-stroke banks, its crossbars (t, f). On a
 * filled bank a crossbar is part of the same outline as the stem and cannot be moved on
 * its own, so only dots are found there. `xHeight` is in glyph units.
 */
function findMarks(glyph: Glyph, xHeight: number, paint: 'stroke' | 'fill'): Marks | null {
  const dotted = DOTTED.has(glyph.char);
  const crossed = paint === 'stroke' && CROSSED.has(glyph.char);
  if (!dotted && !crossed) return null;
  const parts = split(glyph.path);
  if (parts.length < 2) return null;
  const bounds = parts.map((part) => pathBounds(part));
  const dots: number[] = [];
  const bars: number[] = [];
  bounds.forEach((b, i) => {
    // Holes in a filled letter sit inside another outline; they are not marks.
    if (paint === 'fill' && bounds.some((other, j) => j !== i && inside(b, other))) return;
    const w = b.maxX - b.minX;
    const h = b.maxY - b.minY;
    // y = 0 is the baseline and y grows downward, so "above the small letters" is
    // below -xHeight.
    if (dotted && w < xHeight * 0.45 && h < xHeight * 0.45 && b.maxY < -xHeight * 0.85) {
      dots.push(i);
    } else if (crossed && h < xHeight * 0.25 && w > xHeight * 0.3) {
      bars.push(i);
    }
  });
  // Something has to be left that is the letter itself.
  if (dots.length + bars.length >= parts.length) return null;
  return dots.length || bars.length ? { parts, dots, bars } : null;
}

/**
 * The glyph's path with its dots and crossbars put down again by hand. `amount` is a
 * fraction of the x-height; 0.2 is a normal writer, 0.4 a careless one. Returns the
 * glyph's own path when it has no such marks.
 */
export function placeMarks(
  glyph: Glyph,
  xHeight: number,
  paint: 'stroke' | 'fill',
  amount: number,
  rng: Rng,
): readonly PathCommand[] {
  if (amount <= 0) return glyph.path;
  let marks = cache.get(glyph);
  if (marks === undefined) {
    marks = findMarks(glyph, xHeight, paint);
    cache.set(glyph, marks);
  }
  if (!marks) return glyph.path;

  const unit = amount * xHeight;
  const parts = marks.parts.map((part, i) => {
    const isDot = marks.dots.includes(i);
    const isBar = marks.bars.includes(i);
    if (!isDot && !isBar) return part;
    const b = pathBounds(part);
    const cx = (b.minX + b.maxX) / 2;
    const cy = (b.minY + b.maxY) / 2;
    if (isDot) {
      // Mostly to the right, where the hand already is, and a little high.
      const dx = unit * rng.float(-0.35, 1);
      const dy = -unit * rng.float(-0.25, 0.7);
      const size = 1 + Math.min(0.5, amount) * rng.float(-0.6, 1);
      return transformPath(part, (x, y) => [cx + (x - cx) * size + dx, cy + (y - cy) * size + dy]);
    }
    // A crossbar is a quick flick: usually rising to the right, never quite level.
    const tilt = -Math.min(0.35, amount * 0.9) * rng.float(-0.3, 1);
    const stretch = 1 + Math.min(0.6, amount) * rng.float(-0.4, 1);
    const dx = unit * rng.float(-0.3, 0.6);
    const dy = unit * rng.float(-0.4, 0.3);
    const cos = Math.cos(tilt);
    const sin = Math.sin(tilt);
    return transformPath(part, (x, y) => {
      const sx = (x - cx) * stretch;
      const sy = y - cy;
      return [cx + sx * cos - sy * sin + dx, cy + sx * sin + sy * cos + dy];
    });
  });
  return parts.flat();
}
