import { wholeLetters } from '@pentwin/engine';
import {
  buildGlyphBank,
  pathBounds,
  PRESETS,
  renderText,
  sceneToSvg,
  tuneJitter,
  type JitterParams,
} from '@pentwin/engine';
import type { StyleFeatures } from '@pentwin/shared';
import { describe, expect, it } from 'vitest';
import { extractGlyphBank } from './extract';
import { renderSamplePage, SAMPLE_TEXT, toRgba } from './testing';

/** A writer's profile: the bank and style extracted from one sample page. */
const profileOf = (preset: 'neat' | 'rushed') => {
  const photo = renderSamplePage({ seed: preset, jitter: PRESETS[preset] });
  const { bank, style } = extractGlyphBank(toRgba(photo.gray), SAMPLE_TEXT);
  return {
    bank: buildGlyphBank(bank!.metadata, (file) => bank!.files[file]!),
    style: style!,
  };
};

const X_HEIGHT = 2.8;
const text = 'xxxx vvvv zzzz xxxx vvvv zzzz '.repeat(30);

describe('tuneJitter', { timeout: 240_000 }, () => {
  const neat = profileOf('neat');
  const rushed = profileOf('rushed');
  const neatJitter = tuneJitter(neat.style, X_HEIGHT);
  const rushedJitter = tuneJitter(rushed.style, X_HEIGHT);

  it('measures a neat writer as steadier than a rushed one', () => {
    for (const key of [
      'slantVariation',
      'sizeVariation',
      'baselineWobble',
      'spacingVariation',
    ] as const) {
      expect(neat.style[key]).toBeLessThan(rushed.style[key]);
    }
  });

  it('gives the two profiles clearly different settings', () => {
    const steady: (keyof JitterParams)[] = [
      'baselineDrift',
      'lineSlope',
      'rotation',
      'size',
      'wordSpacing',
      'letterSpacing',
      'slantVariation',
      'marginDrift',
      'warp',
    ];
    for (const key of steady) expect(neatJitter[key]!).toBeLessThan(rushedJitter[key]!);
    expect(rushedJitter.baselineDrift).toBeGreaterThan(neatJitter.baselineDrift * 1.8);
  });

  it('adds no slant of its own: the glyphs already lean the way the writer does', () => {
    expect(rushed.style.slant).toBeGreaterThan(6);
    expect(rushedJitter.slant).toBe(0);
    expect(neatJitter.slant).toBe(0);
  });

  it('makes the same text visibly steadier for the neat writer', () => {
    // Same bank and seed for both, so only the tuning differs.
    const wander = (jitter: JitterParams): number => {
      const scene = renderText(text, neat.bank, { seed: 'tune', xHeight: X_HEIGHT, jitter })
        .pages[0]!;
      const errors = wholeLetters(scene.strokes).map((stroke) => {
        const bottom = pathBounds(stroke.path).maxY;
        return Math.min(...scene.baselines.map((b) => Math.abs(b - bottom)));
      });
      return errors.reduce((a, b) => a + b, 0) / errors.length;
    };
    expect(wander(rushedJitter)).toBeGreaterThan(wander(neatJitter) * 1.5);
    const svg = (jitter: JitterParams) =>
      sceneToSvg(renderText(text, neat.bank, { seed: 'tune', jitter }).pages[0]!);
    expect(svg(neatJitter)).not.toBe(svg(rushedJitter));
  });

  it('stays within sane limits for extreme measurements', () => {
    const style = (v: number): StyleFeatures => ({
      slant: 0,
      strokeWidth: 0.15,
      xHeightRatio: 0.7,
      roundness: 0.9,
      letterWidth: 0.9,
      slantVariation: v * 100,
      sizeVariation: v,
      baselineWobble: v,
      spacingVariation: v,
    });
    const calm = tuneJitter(style(0), X_HEIGHT);
    const wild = tuneJitter(style(5), X_HEIGHT);
    expect(calm.baselineDrift).toBeGreaterThan(0);
    expect(calm.size).toBeGreaterThan(0);
    expect(wild.size).toBeLessThanOrEqual(0.12);
    expect(wild.baselineDrift).toBeLessThanOrEqual(1);
    expect(wild.lineSlope).toBeLessThanOrEqual(1.4);
    expect(wild.rotation).toBeLessThanOrEqual(3.5);
  });
});
