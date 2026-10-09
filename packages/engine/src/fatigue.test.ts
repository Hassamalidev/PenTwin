import { wholeLetters } from './writer';
import { describe, expect, it } from 'vitest';
import { DEFAULT_JITTER, NO_JITTER, type JitterParams } from './jitter';
import { pathBounds } from './path';
import { renderText } from './render';
import { sceneToSvg } from './svg';
import { loadSampleBank } from './testing';

const bank = loadSampleBank();
// No ascenders or descenders: the bottom edge of each glyph shows where its baseline went.
const text = 'xxxx vvvv zzzz xxxx vvvv zzzz '.repeat(70);
const page = (fatigue: number, seed = 'f') =>
  renderText(text, bank, { seed, jitter: { ...DEFAULT_JITTER, fatigue } }).pages[0]!;

/** Average distance from the baseline, for the first and the last quarter of the lines. */
const wander = (scene: ReturnType<typeof page>): { top: number; bottom: number } => {
  const lines = scene.baselines.length;
  const sums = { top: [0, 0], bottom: [0, 0] };
  for (const stroke of wholeLetters(scene.strokes)) {
    const y = pathBounds(stroke.path).maxY;
    let line = 0;
    scene.baselines.forEach((b, i) => {
      if (Math.abs(b - y) < Math.abs(scene.baselines[line]! - y)) line = i;
    });
    const part = line < lines / 4 ? sums.top : line >= (lines * 3) / 4 ? sums.bottom : undefined;
    if (part) {
      part[0]! += Math.abs(scene.baselines[line]! - y);
      part[1]!++;
    }
  }
  return { top: sums.top[0]! / sums.top[1]!, bottom: sums.bottom[0]! / sums.bottom[1]! };
};

/** Mean of a ratio over several seeds, so one lucky page does not decide the test. */
const average = (measure: (seed: string) => number): number =>
  ['a', 'b', 'c', 'd', 'e', 'f'].reduce((sum, seed) => sum + measure(seed), 0) / 6;

describe('fatigue', { timeout: 120_000 }, () => {
  it('changes nothing when it is off', () => {
    const plain = renderText(text, bank, { seed: 'f', jitter: DEFAULT_JITTER }).pages[0]!;
    expect(sceneToSvg(page(0))).toBe(sceneToSvg(plain));
  });

  it('leaves the top of the page alone and loosens the bottom', () => {
    const growth = (fatigue: number): number =>
      average((seed) => {
        const w = wander(page(fatigue, seed));
        return w.bottom / w.top;
      });
    const rested = growth(0);
    const tired = growth(1);
    expect(tired).toBeGreaterThan(rested * 1.3);
    // The first lines are written the same with and without it.
    const firstLine = (fatigue: number): string =>
      JSON.stringify(
        page(fatigue)
          .strokes.slice(0, 20)
          .map((s) => s.path),
      );
    expect(firstLine(1)).toBe(firstLine(0));
  });

  it('builds up gradually down the page', () => {
    // The same letter on every line, with everything but fatigue off. Each line uses the
    // same glyph variant with and without fatigue, so any shift of its top is the added lean.
    const tops = (fatigue: number): number[] => {
      const params: JitterParams = { ...NO_JITTER, fatigue };
      const { pages } = renderText('l\n'.repeat(30), bank, { seed: 1, jitter: params });
      return pages[0]!.strokes.map((s) => pathBounds(s.path).maxX);
    };
    const rested = tops(0);
    const lean = tops(1).map((x, i) => x - rested[i]!);
    expect(lean[0]).toBe(0);
    expect(lean[15]).toBeGreaterThan(0);
    expect(lean[29]).toBeGreaterThan(lean[15]!);
    // Slow start: the first half adds less than the second half.
    expect(lean[15]!).toBeLessThan(lean[29]! - lean[15]!);
  });

  it('stays subtle at a realistic setting', () => {
    const rested = wander(page(0));
    const tired = wander(page(0.4));
    // Noticeable only on comparison: the bottom is at most about half again as loose.
    expect(tired.bottom / rested.bottom).toBeLessThan(1.6);
    expect(tired.bottom).toBeLessThan(1); // mm
  });

  it('keeps wider gaps from pushing text past the right margin', () => {
    const scene = page(1);
    for (const stroke of wholeLetters(scene.strokes)) {
      expect(pathBounds(stroke.path).maxX).toBeLessThanOrEqual(scene.width - 20 + 2.5);
    }
  });
});
