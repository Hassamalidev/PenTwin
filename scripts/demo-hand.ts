/**
 * The demo handwriting: what the site writes with before a visitor has made a sample of
 * their own.
 *
 * It is NOT anyone's real handwriting and it is not cut from a photo. Every letter below
 * was drawn for this file as the pen strokes a person makes when printing casually: a
 * bowl that starts at the top right and does not quite close, a stem with a flick at the
 * foot, humps that branch from part-way up the stem. Each letter is then written four
 * times with a different, smooth unsteadiness, so no two are the same.
 *
 * Kept apart from the test letters in tests/fixtures (which stay a plain geometric set,
 * so tests and recorded measurements do not move when this file is tuned).
 *
 * Coordinates: x to the right, y UP, 0 on the baseline, 100 at the top of a small letter.
 * Strokes are separated by "|", points by spaces.
 */
import { REQUIRED_CHARS, type GlyphMetadata } from '../packages/engine/src/glyphs';
import { pathBounds, serializePath, type PathCommand } from '../packages/engine/src/path';
import { createRng, type Rng } from '../packages/shared/src/rng';

export const DEMO_VARIANTS = 4;
const X_HEIGHT = 100;
const CAP_HEIGHT = 158;
const DESCENDER = 68;
/** The letters were drawn narrow and tall; this is how they are proportioned for use. */
const WIDEN = 1.16;
const TALL = 0.86;
const DEEP = 0.9;
const CORNER_DEG = 70;

const LETTERS: Record<string, string> = {
  a: '55,84 42,98 24,95 9,73 5,41 13,12 29,1 44,11 54,44 57,94 56,40 59,11 68,1 76,8',
  b: '11,186 9,92 10,3 | 10,54 22,84 39,98 55,86 62,54 55,20 37,2 19,6 9,21',
  c: '57,78 45,96 27,98 11,78 5,46 12,17 28,2 46,6 59,22',
  d: '54,83 41,98 23,94 9,71 5,41 13,11 29,1 45,12 55,44 | 58,188 56,92 57,30 60,9 69,1 77,8',
  e: '8,50 30,51 51,58 56,76 45,96 27,97 11,78 5,46 12,16 28,2 46,5 59,20',
  f: '51,174 41,188 28,184 21,164 20,90 21,0 | 2,95 22,99 43,102',
  g: '55,85 41,99 23,95 9,72 5,41 14,11 30,2 45,13 54,45 57,96 57,20 55,-38 44,-68 25,-76 8,-60',
  h: '11,186 10,92 10,0 | 10,52 23,85 40,98 53,85 56,50 57,11 65,1',
  i: '13,97 12,42 14,9 23,0 31,6 | 12,138 14,140',
  j: '23,97 23,12 20,-44 9,-70 -7,-66 | 23,138 25,140',
  k: '11,186 10,92 10,0 | 52,97 31,66 11,43 | 23,58 41,27 58,1',
  l: '13,186 12,82 14,14 23,0 33,6',
  m: '8,97 9,50 9,0 | 9,60 20,87 33,98 43,85 45,46 45,0 | 45,61 56,87 69,98 79,85 82,46 83,9 91,1',
  n: '8,97 9,50 9,0 | 9,57 22,87 38,98 51,85 54,48 55,11 63,1',
  o: '35,98 17,88 5,58 8,25 24,3 42,5 57,28 60,61 49,89 31,100',
  p: '9,97 9,20 10,-76 | 9,57 20,86 38,98 54,86 60,55 54,21 38,3 20,6 9,22',
  q: '55,85 41,99 23,95 9,72 5,41 14,11 30,2 45,13 54,45 | 57,97 56,20 57,-76 67,-58',
  r: '8,97 9,50 9,0 | 9,55 20,83 35,97 50,91',
  s: '51,83 39,97 21,96 10,80 16,60 34,48 48,34 50,16 38,3 20,2 6,16',
  t: '22,158 22,60 24,15 34,1 46,8 | 2,96 24,99 46,102',
  u: '8,97 8,46 12,15 26,2 40,10 52,42 55,98 54,40 57,11 66,1',
  v: '4,97 16,50 28,1 42,50 54,99',
  w: '4,97 12,50 21,1 32,48 40,80 50,42 60,1 70,50 80,99',
  x: '6,97 30,50 56,1 | 54,98 30,50 4,0',
  y: '6,97 16,50 30,7 | 56,98 40,40 26,-20 12,-64 -4,-72',
  z: '6,95 28,98 54,97 30,50 4,3 28,1 56,4',

  A: '4,0 21,82 40,168 | 40,168 58,82 76,0 | 15,58 40,60 65,61',
  B: '12,168 11,85 12,0 | 12,166 40,168 61,150 60,112 40,91 14,88 | 14,88 46,86 68,62 66,24 44,2 12,0',
  C: '78,136 60,162 36,168 14,146 5,100 8,50 24,12 46,0 68,10 80,34',
  D: '12,168 11,85 12,0 | 12,166 40,166 69,140 81,90 74,40 48,6 12,1',
  E: '62,166 12,168 11,85 12,0 62,3 | 12,88 34,89 52,91',
  F: '64,166 12,168 11,85 12,0 | 12,90 34,91 50,93',
  G: '78,136 60,162 36,168 14,146 5,100 8,50 24,12 46,0 68,8 80,36 80,74 62,75 46,73',
  H: '12,168 11,85 12,0 | 70,168 70,85 71,0 | 12,88 40,90 70,91',
  I: '21,168 20,85 21,0 | 4,166 20,168 38,167 | 4,1 21,0 38,2',
  J: '50,168 50,60 44,18 28,0 12,8 4,30 | 26,166 50,168 70,167',
  K: '12,168 11,85 12,0 | 68,168 40,120 13,82 | 30,98 50,50 72,0',
  L: '12,168 11,85 12,2 36,0 64,4',
  M: '8,0 10,90 12,168 30,110 48,58 66,110 84,168 86,90 88,0',
  N: '10,0 11,90 12,168 32,110 52,56 72,0 73,90 74,168',
  O: '43,168 20,152 6,104 8,50 24,10 46,0 68,14 82,60 80,116 64,156 40,170',
  P: '12,168 11,85 12,0 | 12,166 42,168 64,150 66,116 46,93 12,88',
  Q: '43,168 20,152 6,104 8,50 24,10 46,0 68,14 82,60 80,116 64,156 40,170 | 52,36 68,14 86,-10',
  R: '12,168 11,85 12,0 | 12,166 42,168 64,150 64,116 44,93 12,88 | 34,90 54,44 74,0',
  S: '70,142 54,164 32,168 14,152 16,118 40,92 62,72 70,40 58,10 36,0 14,8 4,30',
  T: '4,166 40,168 78,170 | 41,168 40,85 41,0',
  U: '10,168 10,70 16,24 36,2 56,8 68,40 70,168',
  V: '4,168 22,84 40,0 58,84 76,169',
  W: '4,168 14,84 26,0 40,70 52,130 64,70 78,0 90,84 100,169',
  X: '8,168 40,86 74,0 | 72,168 40,86 6,0',
  Y: '6,168 22,128 40,90 | 74,168 56,128 40,90 40,45 41,0',
  Z: '8,164 40,168 74,167 42,86 8,3 42,1 78,5',

  '0': '40,164 20,148 8,100 10,48 24,10 44,0 62,16 72,64 70,118 58,152 38,166',
  '1': '14,128 30,146 42,164 42,84 43,0',
  '2': '10,128 22,154 42,166 62,152 66,122 50,90 26,50 8,2 40,1 72,4',
  '3': '10,148 30,164 52,158 62,132 50,104 30,90 54,82 68,54 62,20 42,2 22,4 8,22',
  '4': '52,164 30,110 6,52 40,50 78,53 | 56,120 56,60 57,0',
  '5': '64,165 22,164 17,96 34,104 54,98 68,70 66,34 50,8 30,0 10,12',
  '6': '60,158 40,130 18,84 10,44 20,12 40,0 60,12 68,42 58,72 38,82 18,68',
  '7': '8,162 40,164 72,163 52,110 36,54 26,0',
  '8': '42,90 20,108 16,138 30,160 50,164 62,146 58,116 40,90 18,66 12,34 24,8 44,0 62,12 68,40 58,70 38,92',
  '9': '64,112 50,88 30,84 14,104 14,138 30,162 50,164 64,144 66,100 60,50 50,0',

  '.': '10,4 12,6',
  ',': '14,8 13,-8 5,-24',
  ';': '14,66 16,68 | 15,8 14,-8 6,-24',
  ':': '10,66 12,68 | 10,4 12,6',
  '!': '14,166 13,90 14,44 | 14,4 16,6',
  '?': '8,134 20,158 40,166 58,150 58,122 42,96 32,70 32,44 | 32,4 34,6',
  "'": '12,170 10,146 8,124',
  '"': '10,170 9,146 7,124 | 30,170 29,146 27,124',
  '-': '6,58 26,60 46,61',
  '(': '34,182 16,140 8,84 14,28 32,-18',
  ')': '6,182 24,140 32,84 26,28 8,-18',
  '/': '56,180 32,84 6,-14',
  '&': '74,0 44,48 20,100 18,138 34,162 52,152 54,124 34,98 14,70 6,36 18,8 40,0 62,14 76,48',
  $: '62,134 48,156 28,156 12,138 16,110 38,90 58,70 62,40 48,14 26,10 8,28 | 36,180 35,84 36,-12',
  '%': '22,164 8,146 10,116 26,106 40,124 38,154 22,164 | 78,166 44,84 8,0 | 66,58 52,40 54,10 70,0 84,18 82,48 66,58',
  '+': '6,70 34,71 62,73 | 34,112 34,71 35,30',
  '=': '6,90 32,91 60,93 | 6,50 32,51 60,53',
  '@': '82,54 70,88 48,92 32,70 36,40 54,32 72,48 82,92 80,48 92,34 108,52 108,96 88,134 54,146 22,128 6,84 14,34 40,6 76,2 100,14',
  '#': '34,150 28,76 22,4 | 66,152 60,78 54,6 | 4,104 44,106 86,109 | 2,48 42,50 84,53',
  '*': '32,150 32,118 33,88 | 6,136 32,118 58,102 | 58,138 32,118 6,100',
};

type Point = [number, number];

const parse = (source: string): Point[][] =>
  source.split('|').map((stroke) =>
    stroke
      .trim()
      .split(/\s+/)
      .map((pair) => {
        const [x, y] = pair.split(',').map(Number) as Point;
        // Wider, with shorter ascenders and tails than drawn.
        return [x * WIDEN, y > 100 ? 100 + (y - 100) * TALL : y < 0 ? y * DEEP : y] as Point;
      }),
  );

const turnDeg = (a: Point, b: Point, c: Point): number => {
  const angle = Math.atan2(c[1] - b[1], c[0] - b[0]) - Math.atan2(b[1] - a[1], b[0] - a[0]);
  return Math.abs((((angle * 180) / Math.PI + 540) % 360) - 180);
};

/** A smooth curve through the points that keeps a sharp corner sharp. */
function smooth(points: Point[]): PathCommand[] {
  const first = points[0]!;
  const out: PathCommand[] = [{ type: 'M', x: first[0], y: first[1] }];
  const corner = (i: number): boolean =>
    i <= 0 ||
    i >= points.length - 1 ||
    turnDeg(points[i - 1]!, points[i]!, points[i + 1]!) > CORNER_DEG;
  for (let i = 0; i < points.length - 1; i++) {
    const p1 = points[i]!;
    const p2 = points[i + 1]!;
    const p0 = corner(i) ? p1 : points[i - 1]!;
    const p3 = corner(i + 1) ? p2 : points[i + 2]!;
    out.push({
      type: 'C',
      x1: p1[0] + (p2[0] - p0[0]) / 6,
      y1: p1[1] + (p2[1] - p0[1]) / 6,
      x2: p2[0] - (p3[0] - p1[0]) / 6,
      y2: p2[1] - (p3[1] - p1[1]) / 6,
      x: p2[0],
      y: p2[1],
    });
  }
  return out;
}

/**
 * One writing of a letter: the whole letter leans, stretches and tilts a little, the
 * page "gives" smoothly under it, and each stroke starts and stops slightly early or
 * late. All of it is slow and correlated, the way a hand is, never point-by-point noise.
 */
function writeOnce(strokes: Point[][], rng: Rng): Point[][] {
  const scaleX = 1 + rng.float(-0.075, 0.075);
  const scaleY = 1 + rng.float(-0.06, 0.06);
  const shear = rng.float(-0.07, 0.09);
  const tilt = rng.float(-0.035, 0.035);
  const wave = () => ({
    kx: rng.float(0.018, 0.05) * (rng.next() < 0.5 ? -1 : 1),
    ky: rng.float(0.014, 0.04) * (rng.next() < 0.5 ? -1 : 1),
    phase: rng.float(0, Math.PI * 2),
    amp: rng.float(2.2, 5),
  });
  const wx = wave();
  const wy = wave();
  const place = ([x, y]: Point): Point => {
    const sx = x * scaleX + y * shear;
    const sy = y * scaleY;
    const rx = sx * Math.cos(tilt) - sy * Math.sin(tilt);
    const ry = sx * Math.sin(tilt) + sy * Math.cos(tilt);
    return [
      rx + wx.amp * Math.sin(wx.kx * x + wx.ky * y + wx.phase),
      ry + wy.amp * Math.sin(wy.kx * x + wy.ky * y + wy.phase),
    ];
  };

  return strokes.map((stroke) => {
    // Each pen-down lands a little off from where the last stroke would suggest.
    const dx = rng.float(-2.2, 2.2);
    const dy = rng.float(-2, 2);
    const moved = stroke.map(place).map(([x, y]): Point => [x + dx, y + dy]);
    if (moved.length < 3) return moved;
    // Start and finish early or late along the direction of travel.
    const stretch = (end: Point, next: Point, amount: number): Point => {
      const length = Math.hypot(end[0] - next[0], end[1] - next[1]) || 1;
      return [
        end[0] + ((end[0] - next[0]) / length) * amount,
        end[1] + ((end[1] - next[1]) / length) * amount,
      ];
    };
    moved[0] = stretch(moved[0]!, moved[1]!, rng.float(-5, 6));
    moved[moved.length - 1] = stretch(moved.at(-1)!, moved.at(-2)!, rng.float(-5, 7));
    return moved;
  });
}

export interface DemoHand {
  metadata: GlyphMetadata;
  files: Record<string, string>;
}

/** Builds the demo handwriting. The same every time: it is seeded, not random. */
export function buildDemoHand(): DemoHand {
  const metadata: GlyphMetadata = {
    version: 1,
    name: 'demo-hand',
    xHeight: X_HEIGHT,
    capHeight: CAP_HEIGHT,
    descender: DESCENDER,
    spaceAdvance: 74,
    paint: 'stroke',
    glyphs: {},
  };
  const files: Record<string, string> = {};
  const round = (value: number): number => Math.round(value * 10) / 10;

  for (const char of REQUIRED_CHARS) {
    const source = LETTERS[char];
    if (!source) throw new Error(`The demo handwriting has no "${char}"`);
    const drawn = parse(source);
    const code = char.codePointAt(0)!.toString(16).padStart(4, '0');

    metadata.glyphs[char] = Array.from({ length: DEMO_VARIANTS }, (_, variant) => {
      const strokes = writeOnce(drawn, createRng(`demo-hand:${char}:${variant}`));
      const path = strokes.flatMap(smooth);
      const ink = pathBounds(path);
      // Spacing follows the part of the letter that sits on the line, so the tail of a
      // "y" or "j" can hang under its neighbour as it does in real writing.
      const body = strokes.flat().filter(([, y]) => y > -6);
      const bodyLeft = Math.min(...body.map(([x]) => x));
      const bodyRight = Math.max(...body.map(([x]) => x));
      const pen = bodyLeft - 11;
      const advance = bodyRight + 15 - pen;

      // Files are y-down with the view box tight around the ink.
      const fx = (x: number): number => x - ink.minX;
      const fy = (y: number): number => ink.maxY - y;
      const local = path.map((c): PathCommand => {
        if (c.type === 'C') {
          return {
            ...c,
            x1: fx(c.x1),
            y1: fy(c.y1),
            x2: fx(c.x2),
            y2: fy(c.y2),
            x: fx(c.x),
            y: fy(c.y),
          };
        }
        if (c.type === 'Z') return c;
        if (c.type === 'Q') return { ...c, x1: fx(c.x1), y1: fy(c.y1), x: fx(c.x), y: fy(c.y) };
        return { ...c, x: fx(c.x), y: fy(c.y) };
      });

      const file = `u${code}-${variant + 1}.svg`;
      const width = round(ink.maxX - ink.minX);
      const height = round(ink.maxY - ink.minY);
      files[file] =
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}">` +
        `<path d="${serializePath(local, 1)}" fill="none" stroke="#000" stroke-width="8.5" ` +
        `stroke-linecap="round" stroke-linejoin="round"/></svg>\n`;
      return {
        file,
        advance: round(advance),
        lsb: round(ink.minX - pen),
        rsb: round(advance - (ink.minX - pen) - (ink.maxX - ink.minX)),
        baseline: round(ink.maxY),
      };
    });
  }
  return { metadata, files };
}
