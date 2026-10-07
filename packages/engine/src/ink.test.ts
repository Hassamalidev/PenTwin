import { PDFDict, PDFDocument, PDFName } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { inkFilter, INKS, type InkName } from './ink';
import { sceneToPixels } from './node/png';
import { scenesToPdf } from './pdf';
import { PRESETS } from './presets';
import { renderText } from './render';
import { sceneToSvg } from './svg';
import { loadSampleBank } from './testing';

const bank = loadSampleBank();
const text = 'The quick brown fox jumps over the lazy dog. '.repeat(6);
const names = Object.keys(INKS) as InkName[];
const render = (ink?: InkName) =>
  renderText(text, bank, { seed: 'ink', pageSize: 'A5', jitter: PRESETS.normal, ink }).pages[0]!;

/** How much ink is on the page and how dark it is, from the rendered pixels. */
const measure = (ink: InkName): { coverage: number; darkness: number } => {
  const { data } = sceneToPixels(render(ink), 100);
  let inked = 0;
  let dark = 0;
  for (let i = 0; i < data.length; i += 4) {
    const v = (data[i]! + data[i + 1]! + data[i + 2]!) / 3;
    if (v < 200) {
      inked++;
      dark += 255 - v;
    }
  }
  return { coverage: inked / (data.length / 4), darkness: dark / inked / 255 };
};

describe('inks', { timeout: 120_000 }, () => {
  it('gives every ink a different page', () => {
    expect(new Set(names.map((name) => sceneToSvg(render(name)))).size).toBe(names.length);
  });

  it('makes each ink look the way that pen does', () => {
    const m = Object.fromEntries(names.map((name) => [name, measure(name)]));
    // Gel and fountain lay down a broader line than a ballpoint.
    expect(m.gel!.coverage).toBeGreaterThan(m['ballpoint-blue']!.coverage * 1.1);
    expect(m.fountain!.coverage).toBeGreaterThan(m['ballpoint-blue']!.coverage * 1.1);
    // Pencil is the lightest; gel the densest.
    for (const name of names.filter((n) => n !== 'pencil')) {
      expect(m.pencil!.darkness).toBeLessThan(m[name]!.darkness);
    }
    expect(m.gel!.darkness).toBeGreaterThan(m['ballpoint-blue']!.darkness);
    // Blue and black ballpoint differ in colour only.
    expect(m['ballpoint-black']!.coverage).toBeCloseTo(m['ballpoint-blue']!.coverage, 2);
  });

  it('shades fountain pen writing: darkness rises and falls slowly', () => {
    const opacities = render('fountain').strokes.map((s) => s.opacity!);
    const range = Math.max(...opacities) - Math.min(...opacities);
    expect(range).toBeGreaterThan(0.2);
    // Slowly: neighbouring letters are far more alike than letters a line apart.
    const step = (gap: number): number => {
      let total = 0;
      for (let i = gap; i < opacities.length; i++)
        total += Math.abs(opacities[i]! - opacities[i - gap]!);
      return total / (opacities.length - gap);
    };
    expect(step(1)).toBeLessThan(step(40) * 0.4);
    // A ballpoint is nearly even.
    const ballpoint = render('ballpoint-blue').strokes.map((s) => s.opacity!);
    expect(Math.max(...ballpoint) - Math.min(...ballpoint)).toBeLessThan(range * 0.5);
  });

  it('adds grain to pencil and bleed to fountain pen in raster output only', () => {
    expect(sceneToSvg(render('pencil'))).toContain('feTurbulence');
    expect(sceneToSvg(render('pencil'))).not.toContain('feGaussianBlur');
    expect(sceneToSvg(render('fountain'))).toContain('feGaussianBlur');
    expect(inkFilter({ bleed: 0, grain: 0 }, 100, 100)).toBeUndefined();
    expect(sceneToSvg(render())).not.toContain('<filter');
  });

  it('leaves output unchanged when no ink is chosen', () => {
    const plain = render();
    expect(plain.inkEffects).toBeUndefined();
    expect(plain.strokes.every((s) => s.opacity === undefined && s.mode === undefined)).toBe(true);
    expect(plain.inkColor).toBe('#1b2a6b');
  });

  it('lets a colour override the ink and accepts custom inks', () => {
    const red = renderText(text, bank, { seed: 1, ink: 'gel', inkColor: '#aa0000' }).pages[0]!;
    expect(red.inkColor).toBe('#aa0000');
    const custom = renderText(text, bank, {
      seed: 1,
      ink: { ...INKS.gel, color: '#006600' },
    }).pages[0]!;
    expect(custom.inkColor).toBe('#006600');
  });

  it('carries opacity into the PDF', async () => {
    const hasOpacityState = async (ink?: InkName): Promise<boolean> => {
      const doc = await PDFDocument.load(await scenesToPdf([render(ink)]));
      const states = doc.getPage(0).node.Resources()?.lookupMaybe(PDFName.of('ExtGState'), PDFDict);
      return (states?.keys().length ?? 0) > 0;
    };
    expect(await hasOpacityState('fountain')).toBe(true);
    expect(await hasOpacityState()).toBe(false);
  });
});
