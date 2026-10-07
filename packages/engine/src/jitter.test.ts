import { createRng } from '@pentwin/shared';
import { describe, expect, it } from 'vitest';
import {
  createJitterStyler,
  createNoise,
  DEFAULT_JITTER,
  NO_JITTER,
  pairBias,
  type JitterParams,
} from './jitter';
import { pathBounds } from './path';
import { renderText } from './render';
import { sceneToSvg } from './svg';
import { loadSampleBank } from './testing';

const bank = loadSampleBank();
const text = 'The quick brown fox jumps over the lazy dog. '.repeat(12);
const svg = (jitter: JitterParams | undefined, seed = 'j'): string =>
  sceneToSvg(renderText(text, bank, { seed, jitter }).pages[0]!);

describe('createNoise', () => {
  it('stays in [-1, 1] and is reproducible', () => {
    const a = createNoise(createRng(1));
    const b = createNoise(createRng(1));
    for (let t = -20; t < 20; t += 0.37) {
      expect(Math.abs(a(t))).toBeLessThanOrEqual(1);
      expect(a(t)).toBe(b(t));
    }
  });

  it('is correlated: nearby samples differ far less than distant ones', () => {
    const noise = createNoise(createRng(2));
    let near = 0;
    let far = 0;
    const n = 2000;
    for (let i = 0; i < n; i++) {
      const t = i * 0.731;
      near += Math.abs(noise(t + 0.05) - noise(t));
      far += Math.abs(noise(t + 5.5) - noise(t));
    }
    expect(near / n).toBeLessThan(0.1);
    expect(far / n).toBeGreaterThan(0.4);
  });
});

describe('jitter', () => {
  it('reproduces exactly for the same seed and differs for another', () => {
    expect(svg(DEFAULT_JITTER, 'a')).toBe(svg(DEFAULT_JITTER, 'a'));
    expect(svg(DEFAULT_JITTER, 'a')).not.toBe(svg(DEFAULT_JITTER, 'b'));
  });

  it('changes nothing when every parameter is zero', () => {
    expect(svg(NO_JITTER)).toBe(svg(undefined));
    expect(svg(DEFAULT_JITTER)).not.toBe(svg(undefined));
  });

  it('keeps baseline drift within its amplitude and makes it smooth', () => {
    const styler = createJitterStyler({ ...NO_JITTER, baselineDrift: 0.5 }, createRng(4), 3);
    const line = styler.line(3);
    let previous = line.baselineShift(20);
    let moved = false;
    for (let x = 20.5; x < 190; x += 0.5) {
      const shift = line.baselineShift(x);
      expect(Math.abs(shift)).toBeLessThanOrEqual(0.5);
      expect(Math.abs(shift - previous)).toBeLessThan(0.05);
      moved ||= Math.abs(shift) > 0.1;
      previous = shift;
    }
    expect(moved).toBe(true);
  });

  it('leans letters to the right for a positive slant', () => {
    const top = (slant: number): number => {
      const { pages } = renderText('l', bank, { seed: 1, jitter: { ...NO_JITTER, slant } });
      return pathBounds(pages[0]!.strokes[0]!.path).maxX;
    };
    expect(top(15)).toBeGreaterThan(top(0) + 0.3);
  });

  it('gives each letter pair a stable spacing habit', () => {
    expect(pairBias('t', 'h')).toBe(pairBias('t', 'h'));
    expect(pairBias('t', 'h')).not.toBe(pairBias('h', 't'));
    const biases = [...'abcdefghij'].map((c) => pairBias('a', c));
    expect(new Set(biases).size).toBe(10);
    for (const b of biases) expect(Math.abs(b)).toBeLessThanOrEqual(1);
  });

  it('varies size, pen width and word gaps within their limits', () => {
    const styler = createJitterStyler(DEFAULT_JITTER, createRng(8), 3);
    for (let i = 0; i < 2000; i++) {
      const g = styler.glyph('a');
      expect(Math.abs(g.scale - 1)).toBeLessThanOrEqual(DEFAULT_JITTER.size + 1e-9);
      expect(Math.abs(g.strokeScale - 1)).toBeLessThanOrEqual(DEFAULT_JITTER.strokeWidth + 1e-9);
      expect(Math.abs(styler.wordGap() - 1)).toBeLessThanOrEqual(DEFAULT_JITTER.wordSpacing + 1e-9);
    }
  });
});
