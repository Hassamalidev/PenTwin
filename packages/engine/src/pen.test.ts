import { describe, expect, it } from 'vitest';
import { INKS } from './ink';
import { PRESETS } from './presets';
import { parsePath, pathBounds, type PathCommand } from './path';
import { flatten, outlineStroke, type PenModel } from './pen';
import { renderText } from './render';
import { scenesToPdf } from './pdf';
import { sceneToSvg } from './svg';
import { loadSampleBank } from './testing';

const ROUND: PenModel = { taper: 0, landing: 0, nib: 0 };

/** Signed area of each closed polygon in an outline. */
const areas = (path: readonly PathCommand[]): number[] =>
  flatten(path).map((points) =>
    points.reduce((sum, p, i) => {
      const q = points[(i + 1) % points.length]!;
      return sum + (p.x * q.y - q.x * p.y) / 2;
    }, 0),
  );

/** Width of a horizontal stroke's outline at x, measured across it. */
const thicknessAt = (path: readonly PathCommand[], x: number): number => {
  const ys: number[] = [];
  for (const points of flatten(path)) {
    points.forEach((p, i) => {
      const q = points[(i + 1) % points.length]!;
      if ((p.x - x) * (q.x - x) <= 0 && p.x !== q.x) {
        ys.push(p.y + ((x - p.x) / (q.x - p.x)) * (q.y - p.y));
      }
    });
  }
  return Math.max(...ys) - Math.min(...ys);
};

describe('pen outlines', () => {
  const line = parsePath('M0 0 L10 0');

  it('keeps a plain round pen at its own width all along', () => {
    const { path, min, max } = outlineStroke(line, 0.5, ROUND);
    expect(min).toBeCloseTo(0.5);
    expect(max).toBeCloseTo(0.5);
    expect(thicknessAt(path, 5)).toBeCloseTo(0.5, 2);
  });

  it('lands heavier and lifts off thinner', () => {
    const { path } = outlineStroke(line, 0.5, { taper: 0.6, landing: 0.3, nib: 0 });
    const start = thicknessAt(path, 0.05);
    const middle = thicknessAt(path, 5);
    const end = thicknessAt(path, 9.9);
    expect(start).toBeGreaterThan(middle * 1.15);
    expect(end).toBeLessThan(middle * 0.6);
  });

  it('draws a broad nib wide across its edge and thin along it', () => {
    const nib: PenModel = { taper: 0, landing: 0, nib: 0.5, nibAngle: 40 };
    const a = (40 * Math.PI) / 180;
    // Page y runs down: "up and to the right at 40 degrees" has a negative y.
    const along = outlineStroke(
      [
        { type: 'M', x: 0, y: 0 },
        { type: 'L', x: 10 * Math.cos(a), y: -10 * Math.sin(a) },
      ],
      0.5,
      nib,
    );
    const across = outlineStroke(
      [
        { type: 'M', x: 0, y: 0 },
        { type: 'L', x: 10 * Math.sin(a), y: 10 * Math.cos(a) },
      ],
      0.5,
      nib,
    );
    expect(across.max).toBeGreaterThan(along.max * 2);
  });

  it('keeps a closed loop, such as an o, the size it was drawn', () => {
    const circle = parsePath(
      'M5 0 C7.8 0 10 2.2 10 5 C10 7.8 7.8 10 5 10 C2.2 10 0 7.8 0 5 C0 2.2 2.2 0 5 0',
    );
    const b = pathBounds(outlineStroke(circle, 0.4, INKS['ballpoint-blue'].pen!).path);
    expect(b.maxX - b.minX).toBeGreaterThan(10);
    expect(b.maxY - b.minY).toBeGreaterThan(10);
  });

  it('turns a dot into a small dab instead of nothing', () => {
    const { path } = outlineStroke(parsePath('M3 3 L3.05 3'), 0.5, INKS['ballpoint-blue'].pen!);
    const b = pathBounds(path);
    expect(b.maxX - b.minX).toBeGreaterThan(0.45);
    expect(b.maxY - b.minY).toBeGreaterThan(0.45);
  });

  it('winds every piece the same way, so overlaps fill instead of cancelling', () => {
    // A sharp V (split into two pieces at the corner) and a curve.
    const { path } = outlineStroke(
      parsePath('M0 0 L2 5 L4 0 M6 0 C6 4 10 4 10 0'),
      0.4,
      INKS.fountain.pen!,
    );
    const signs = areas(path).map(Math.sign);
    expect(signs.length).toBeGreaterThanOrEqual(3);
    expect(new Set(signs).size).toBe(1);
  });
});

describe('pen model in rendering', () => {
  const bank = loadSampleBank();
  const text = 'A quick test of the pen, with dots on i and j.';
  const base = { seed: 'pen', pageSize: 'A5', jitter: PRESETS.normal } as const;

  it('gives named inks a pen, and draws those strokes as filled outlines', () => {
    const { pages } = renderText(text, bank, { ...base, ink: 'ballpoint-blue' });
    const letters = pages[0]!.strokes.filter((s) => s.char !== '');
    expect(letters.length).toBeGreaterThan(20);
    for (const stroke of letters) expect(stroke.pen).toEqual(INKS['ballpoint-blue'].pen);
    // The scene keeps the centre line; the page is drawn filled, with no pen width.
    const svg = sceneToSvg(pages[0]!);
    expect(svg).toContain('<g fill="#1b2a6b" stroke="none">');
    expect(svg).not.toContain('stroke-width="0.4"');
  });

  it('leaves the page unchanged when there is no ink, as before', () => {
    const { pages } = renderText(text, bank, base);
    expect(pages[0]!.strokes.every((s) => s.mode === undefined && !s.pen)).toBe(true);
  });

  it('stays vector in PDF output', async () => {
    const { pages } = renderText(text, bank, { ...base, ink: 'fountain' });
    const pdf = await scenesToPdf(pages);
    expect(pdf.length).toBeGreaterThan(1000);
    expect(sceneToSvg(pages[0]!)).toContain('<g fill="#14213d" stroke="none">');
  });
});
