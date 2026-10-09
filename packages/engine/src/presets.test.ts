import { wholeLetters } from './writer';
import { describe, expect, it } from 'vitest';
import { NO_JITTER } from './jitter';
import { pathBounds } from './path';
import { PRESETS, type PresetName } from './presets';
import { renderText } from './render';
import { sceneToSvg } from './svg';
import { loadSampleBank } from './testing';

const bank = loadSampleBank();
// No ascenders or descenders, so each glyph's bottom edge shows where its baseline went.
const text = 'xxxx vvvv zzzz xxxx vvvv zzzz '.repeat(30);
const names: PresetName[] = ['neat', 'normal', 'rushed'];

const render = (name: PresetName) =>
  renderText(text, bank, { seed: 'presets', jitter: PRESETS[name] });

/** Average distance of the ink's bottom edge from its ideal baseline, in mm. */
const baselineError = (name: PresetName): number => {
  const scene = render(name).pages[0]!;
  const errors = wholeLetters(scene.strokes).map((stroke) => {
    const bottom = pathBounds(stroke.path).maxY;
    return Math.min(...scene.baselines.map((b) => Math.abs(b - bottom)));
  });
  return errors.reduce((a, b) => a + b, 0) / errors.length;
};

/** Spread of the pen widths used on the page. */
const penSpread = (name: PresetName): number => {
  const widths = render(name).pages[0]!.strokes.map((s) => s.width);
  return Math.max(...widths) - Math.min(...widths);
};

describe('presets', () => {
  it('gives three different outputs for the same text and seed', () => {
    const svgs = names.map((name) => sceneToSvg(render(name).pages[0]!));
    expect(new Set(svgs).size).toBe(3);
  });

  it('is reproducible', () => {
    for (const name of names) {
      expect(sceneToSvg(render(name).pages[0]!)).toBe(sceneToSvg(render(name).pages[0]!));
    }
  });

  it('gets visibly less regular from neat to normal to rushed', () => {
    const [neat, normal, rushed] = names.map(baselineError);
    expect(neat!).toBeLessThan(normal!);
    expect(normal!).toBeLessThan(rushed!);
    // Not just different in the third decimal: rushed strays several times further.
    expect(rushed!).toBeGreaterThan(neat! * 2.5);

    const [neatPen, normalPen, rushedPen] = names.map(penSpread);
    expect(neatPen!).toBeLessThan(normalPen!);
    expect(normalPen!).toBeLessThan(rushedPen!);
  });

  it('spaces letters further apart with tracking', () => {
    const lastX = (tracking: number): number => {
      const { pages } = renderText('nnnnn', bank, {
        seed: 1,
        xHeight: 3,
        jitter: { ...NO_JITTER, tracking },
      });
      return pathBounds(pages[0]!.strokes.at(-1)!.path).minX;
    };
    // Four gaps, each 10% of the 3mm x-height.
    expect(lastX(0.1) - lastX(0)).toBeCloseTo(4 * 0.3, 5);
  });
});
