/**
 * Builds the synthetic test glyph set in tests/fixtures/glyphs/sample-user.
 *
 * Source shapes are the public Hershey "futural" single-stroke font. Each character is
 * smoothed and then perturbed three different ways so the set behaves like a (very neat)
 * handwriting sample with three variants per character. It is a stand-in for a real
 * extracted bank, good enough to develop and test the engine against.
 *
 *   pnpm fixtures:glyphs
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { REQUIRED_CHARS, type GlyphMetadata } from '../packages/engine/src/glyphs';
import { pathBounds, serializePath, type PathCommand } from '../packages/engine/src/path';
import { createRng, type Rng } from '../packages/shared/src/rng';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'tests/fixtures/glyphs/sample-user');

const VARIANTS = 3;
const SCALE = 10; // Hershey units -> glyph units
const BASELINE = 9; // Hershey y of the baseline
const X_HEIGHT = 14;
const CAP_HEIGHT = 21;
const DESCENDER = 7;
const CORNER_DEG = 60;

type Point = [number, number];

interface HersheyGlyph {
  left: number;
  right: number;
  strokes: Point[][];
}

/** One glyph per line: 5-char id, 3-char vertex count, then coordinate pairs relative to 'R'. */
function parseJhf(source: string): HersheyGlyph[] {
  const R = 'R'.charCodeAt(0);
  return source
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => {
      const data = line.slice(8);
      const left = data.charCodeAt(0) - R;
      const right = data.charCodeAt(1) - R;
      const strokes: Point[][] = [[]];
      for (let i = 2; i + 1 < data.length; i += 2) {
        const pair = data.slice(i, i + 2);
        if (pair === ' R') strokes.push([]);
        else strokes.at(-1)!.push([pair.charCodeAt(0) - R, pair.charCodeAt(1) - R]);
      }
      return { left, right, strokes: strokes.filter((s) => s.length > 0) };
    });
}

/** A smooth per-variant distortion: small affine plus two low-frequency waves. */
function createDistortion(rng: Rng): (p: Point) => Point {
  const scaleX = 1 + rng.float(-0.05, 0.05);
  const scaleY = 1 + rng.float(-0.05, 0.05);
  const shear = rng.float(-0.06, 0.06);
  const wave = () => ({
    kx: rng.float(-0.25, 0.25),
    ky: rng.float(-0.25, 0.25),
    phase: rng.float(0, Math.PI * 2),
    amp: rng.float(0.25, 0.6),
  });
  const wx = wave();
  const wy = wave();
  return ([x, y]) => {
    const yb = y - BASELINE;
    const dx = wx.amp * Math.sin(wx.kx * x + wx.ky * y + wx.phase);
    const dy = wy.amp * Math.sin(wy.kx * x + wy.ky * y + wy.phase);
    return [x * scaleX - yb * shear + dx, BASELINE + yb * scaleY + dy];
  };
}

const turnDeg = (a: Point, b: Point, c: Point): number => {
  const angle = Math.atan2(c[1] - b[1], c[0] - b[0]) - Math.atan2(b[1] - a[1], b[0] - a[0]);
  return Math.abs((((angle * 180) / Math.PI + 540) % 360) - 180);
};

/** Catmull-Rom smoothing that keeps sharp corners sharp. */
function smoothStroke(points: Point[]): PathCommand[] {
  const first = points[0]!;
  const out: PathCommand[] = [{ type: 'M', x: first[0], y: first[1] }];
  if (points.length === 1) {
    out.push({ type: 'L', x: first[0] + 0.1, y: first[1] });
    return out;
  }
  const isCorner = (i: number): boolean =>
    i <= 0 ||
    i >= points.length - 1 ||
    turnDeg(points[i - 1]!, points[i]!, points[i + 1]!) > CORNER_DEG;

  for (let i = 0; i < points.length - 1; i++) {
    const p1 = points[i]!;
    const p2 = points[i + 1]!;
    const p0 = isCorner(i) ? p1 : points[i - 1]!;
    const p3 = isCorner(i + 1) ? p2 : points[i + 2]!;
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

const font = parseJhf(readFileSync(join(root, 'scripts/data/futural.jhf'), 'utf8'));

rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

const metadata: GlyphMetadata = {
  version: 1,
  name: 'sample-user',
  xHeight: X_HEIGHT * SCALE,
  capHeight: CAP_HEIGHT * SCALE,
  descender: DESCENDER * SCALE,
  spaceAdvance: 13 * SCALE,
  paint: 'stroke',
  glyphs: {},
};

const round = (v: number): number => Math.round(v * 10) / 10;

for (const char of REQUIRED_CHARS) {
  const source = font[char.charCodeAt(0) - 32];
  if (!source || source.strokes.length === 0) throw new Error(`No Hershey glyph for "${char}"`);
  const code = char.charCodeAt(0).toString(16).padStart(4, '0');

  metadata.glyphs[char] = Array.from({ length: VARIANTS }, (_, v) => {
    const distort = createDistortion(createRng(`fixture:${char}:${v}`));
    const path = source.strokes.flatMap((stroke) => smoothStroke(stroke.map(distort)));
    const ink = pathBounds(path);

    // Shift so the viewBox is tight around the ink, then scale to glyph units.
    const local = path.map((c): PathCommand => {
      const fx = (x: number): number => (x - ink.minX) * SCALE;
      const fy = (y: number): number => (y - ink.minY) * SCALE;
      if (c.type === 'Z') return c;
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
      if (c.type === 'Q') return { ...c, x1: fx(c.x1), y1: fy(c.y1), x: fx(c.x), y: fy(c.y) };
      return { ...c, x: fx(c.x), y: fy(c.y) };
    });

    const width = round((ink.maxX - ink.minX) * SCALE);
    const height = round((ink.maxY - ink.minY) * SCALE);
    const file = `u${code}-${v + 1}.svg`;
    writeFileSync(
      join(outDir, file),
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}">` +
        `<path d="${serializePath(local, 1)}" fill="none" stroke="#000" stroke-width="12" ` +
        `stroke-linecap="round" stroke-linejoin="round"/></svg>\n`,
    );

    return {
      file,
      advance: (source.right - source.left) * SCALE,
      lsb: round((ink.minX - source.left) * SCALE),
      rsb: round((source.right - ink.maxX) * SCALE),
      baseline: round((BASELINE - ink.minY) * SCALE),
    };
  });
}

writeFileSync(join(outDir, 'metadata.json'), JSON.stringify(metadata, null, 2) + '\n');
writeFileSync(
  join(outDir, 'README.md'),
  `# sample-user (synthetic test glyph set)

Generated by \`pnpm fixtures:glyphs\` (scripts/build-test-glyphs.ts). Do not edit by hand.

This is **not** real handwriting. The shapes come from the Hershey "futural" single-stroke
font, smoothed and perturbed into ${VARIANTS} variants per character. No user data is involved.

## Acknowledgements

- The Hershey Fonts were originally created by Dr. A. V. Hershey while working at the
  U. S. National Bureau of Standards.
- The format of the font data used here was originally created by James Hurt, Cognition, Inc.
`,
);

console.log(`Wrote ${REQUIRED_CHARS.length * VARIANTS} glyphs to ${outDir}`);
