import { describe, expect, it } from 'vitest';
import { DEFAULT_JITTER } from './jitter';
import { createPaper, RULING_SPACING, type PaperSpec } from './paper';
import { pathBounds } from './path';
import { renderText } from './render';
import { sceneToSvg } from './svg';
import { loadSampleBank } from './testing';

const bank = loadSampleBank();
// No ascenders or descenders, so the bottom of every glyph is on its baseline.
const text = 'xxxx vvvv zzzz xxxx vvvv zzzz '.repeat(20);

const ruleYs = (spec: PaperSpec): number[] =>
  [...createPaper(spec, 210, 297).layers[0]!.d.matchAll(/M0 ([\d.]+)H/g)].map((m) => Number(m[1]));

describe('createPaper', () => {
  it('plain paper has no pattern and imposes nothing', () => {
    expect(createPaper({ kind: 'plain' }, 210, 297)).toEqual({
      background: '#ffffff',
      layers: [],
      driftScale: 1,
    });
  });

  it.each(['narrow', 'college', 'wide'] as const)('rules %s paper at its spacing', (ruling) => {
    const ys = ruleYs({ kind: 'ruled', ruling });
    expect(ys.length).toBeGreaterThan(25);
    for (let i = 1; i < ys.length; i++) {
      expect(ys[i]! - ys[i - 1]!).toBeCloseTo(RULING_SPACING[ruling], 1);
    }
    expect(ys.at(-1)!).toBeLessThanOrEqual(297 - 12);
    expect(createPaper({ kind: 'ruled', ruling }, 210, 297).lineHeight).toBe(
      RULING_SPACING[ruling],
    );
  });

  it('adds a margin line that pushes the text right', () => {
    const paper = createPaper({ kind: 'ruled', marginLine: true }, 210, 297);
    expect(paper.layers).toHaveLength(2);
    expect(paper.minLeft).toBe(35);
    expect(createPaper({ kind: 'plain', marginLine: true }, 210, 297).layers).toHaveLength(1);
  });

  it('draws graph and dotted grids across the page', () => {
    const graph = createPaper({ kind: 'graph' }, 210, 297);
    expect(graph.layers[0]!.d.match(/H/g)).toHaveLength(59);
    expect(graph.layers[0]!.d.match(/V/g)).toHaveLength(41);
    const dotted = createPaper({ kind: 'dotted' }, 210, 297);
    expect(dotted.layers[0]!.d.match(/h0\.01/g)).toHaveLength(59 * 41);
    expect(graph.lineHeight).toBe(10);
    expect(dotted.lineHeight).toBe(10);
  });
});

describe('writing on ruled paper', () => {
  const spec: PaperSpec = { kind: 'ruled', ruling: 'college', marginLine: true };
  const { pages } = renderText(text, bank, { seed: 'ruled', jitter: DEFAULT_JITTER, paper: spec });
  const rules = ruleYs(spec);
  const page = pages[0]!;

  it('puts every baseline just above a rule', () => {
    expect(page.baselines.length).toBeGreaterThan(5);
    page.baselines.forEach((baseline, i) => expect(rules[i]! - baseline).toBeCloseTo(0.2, 5));
  });

  it('keeps the actual ink tracking the ruling, imperfectly', () => {
    const offsets = page.strokes.map((stroke) => {
      const bottom = pathBounds(stroke.path).maxY;
      const nearest = rules.reduce((a, b) => (Math.abs(b - bottom) < Math.abs(a - bottom) ? b : a));
      return bottom - nearest;
    });
    // Never far from a line...
    for (const offset of offsets) expect(Math.abs(offset)).toBeLessThan(0.9);
    // ...but not mechanically on it either.
    const mean = offsets.reduce((a, b) => a + b, 0) / offsets.length;
    const spread = Math.sqrt(offsets.reduce((a, b) => a + (b - mean) ** 2, 0) / offsets.length);
    expect(spread).toBeGreaterThan(0.03);
  });

  it('starts the text to the right of the margin line', () => {
    for (const stroke of page.strokes) expect(pathBounds(stroke.path).minX).toBeGreaterThan(32);
  });

  it('wanders less than on plain paper', () => {
    const drift = (paper: PaperSpec): number => {
      const scene = renderText(text, bank, {
        seed: 'd',
        jitter: DEFAULT_JITTER,
        paper,
        lineHeight: 7.1,
      }).pages[0]!;
      const errors = scene.strokes.map((stroke) => {
        const bottom = pathBounds(stroke.path).maxY;
        return Math.min(...scene.baselines.map((b) => Math.abs(b - bottom)));
      });
      return errors.reduce((a, b) => a + b, 0) / errors.length;
    };
    expect(drift({ kind: 'ruled', ruling: 'college' })).toBeLessThan(drift({ kind: 'plain' }));
  });

  it('draws the paper underneath the ink', () => {
    const svg = sceneToSvg(page);
    expect(svg.indexOf('#a9c1e0')).toBeGreaterThan(0);
    expect(svg.indexOf('#a9c1e0')).toBeLessThan(svg.indexOf('#1b2a6b'));
  });
});
