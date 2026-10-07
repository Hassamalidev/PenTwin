import type { Rng } from '@pentwin/shared';
import type { Styler } from './style';
import { createWarp } from './warp';

/** How far the writing strays from the ideal. All zeros means perfectly mechanical output. */
export interface JitterParams {
  /** mm. Amplitude of the baseline's smooth wander along a line. */
  baselineDrift: number;
  /** Degrees. Largest tilt of a whole line. */
  lineSlope: number;
  /** Degrees. Per-glyph rotation. */
  rotation: number;
  /** Fraction. Glyph size variation (0.05 = up to 5% bigger or smaller). */
  size: number;
  /** Fraction. Variation of the gap between words. */
  wordSpacing: number;
  /** Fraction of the x-height. Variation of the gap between letters. */
  letterSpacing: number;
  /** Degrees. Average lean of the writing; positive leans right. */
  slant: number;
  /** Degrees. How much the lean varies around the average. */
  slantVariation: number;
  /** Fraction. Pen width variation. */
  strokeWidth: number;
  /** mm. How far the left edge of the text wanders from line to line. */
  marginDrift: number;
  /** Fraction of the x-height. How much each placed glyph's shape is bent. */
  warp: number;
  /** Fraction of the x-height. Constant extra gap between letters; loose, hurried writing. */
  tracking: number;
  /**
   * 0 to 1. How much the writing loosens from the top of a page to the bottom: more
   * drift, a little more lean, slightly wider gaps. Keep it low; a tired hand is only
   * a little worse, and overdone it looks fake.
   */
  fatigue: number;
}

export const NO_JITTER: JitterParams = {
  baselineDrift: 0,
  lineSlope: 0,
  rotation: 0,
  size: 0,
  wordSpacing: 0,
  letterSpacing: 0,
  slant: 0,
  slantVariation: 0,
  strokeWidth: 0,
  marginDrift: 0,
  warp: 0,
  tracking: 0,
  fatigue: 0,
};

export const DEFAULT_JITTER: JitterParams = {
  baselineDrift: 0.35,
  lineSlope: 0.5,
  rotation: 1.5,
  size: 0.05,
  wordSpacing: 0.25,
  letterSpacing: 0.06,
  slant: 4,
  slantVariation: 2,
  strokeWidth: 0.08,
  marginDrift: 0.8,
  warp: 0.05,
  tracking: 0,
  fatigue: 0,
};

const DEG = Math.PI / 180;

const hash = (n: number): number => {
  let h = Math.imul(n, 0x9e3779b1);
  h ^= h >>> 15;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return ((h >>> 0) / 0xffffffff) * 2 - 1;
};

/**
 * Smooth 1D noise in [-1, 1] that changes gradually over a distance of about 1.
 * A hand drifts, it does not jump: neighbouring samples are correlated, unlike `rng.next()`.
 */
export function createNoise(rng: Rng): (t: number) => number {
  const seed = rng.int(0, 0x7fffffff);
  return (t) => {
    const i = Math.floor(t);
    const f = t - i;
    const u = f * f * (3 - 2 * f);
    return hash(i ^ seed) * (1 - u) + hash((i + 1) ^ seed) * u;
  };
}

/**
 * A writer's habitual spacing for a letter pair, in [-1, 1]. It depends only on the pair,
 * so "th" is always a little tight (or loose) throughout a document instead of varying
 * at random each time.
 */
export const pairBias = (prev: string, char: string): number =>
  hash((prev.codePointAt(0) ?? 0) * 0x10001 + (char.codePointAt(0) ?? 0));

export interface StyleMetrics {
  /** x-height on the page, in mm. */
  xHeight: number;
  /** x-height of the bank's glyphs, in glyph units. */
  glyphXHeight: number;
  /** Lines of writing on the page, so fatigue knows how far down a line is. */
  lineCount?: number;
}

/** Builds the styler for one page. */
export function createJitterStyler(
  params: JitterParams,
  rng: Rng,
  { xHeight, glyphXHeight, lineCount = 1 }: StyleMetrics,
): Styler {
  // How tired the hand is on the line being written: 0 at the top of the page, rising
  // to `fatigue` at the bottom, slowly at first.
  let tired = 0;
  const tiredAt = (lineIndex: number): number => {
    const progress = Math.max(0, Math.min(1, lineIndex / Math.max(1, lineCount - 1)));
    return params.fatigue * progress ** 1.5;
  };

  // Sum of two uniforms: mostly small values, occasionally a larger one.
  const wobble = (): number => rng.next() + rng.next() - 1;

  const baseline = createNoise(rng);
  const ripple = createNoise(rng);
  const slope = createNoise(rng);
  const margin = createNoise(rng);
  const size = createNoise(rng);
  const slant = createNoise(rng);
  const stroke = createNoise(rng);
  const gap = createNoise(rng);
  let glyphIndex = 0;
  let wordIndex = 0;

  return {
    line: (lineIndex) => {
      const t = tiredAt(lineIndex);
      tired = t;
      return {
        offsetX: params.marginDrift * margin(lineIndex / 5),
        slope: params.lineSlope * (1 + 0.8 * t) * DEG * slope(lineIndex / 4),
        // A slow wander across the page plus a much smaller, quicker ripple.
        baselineShift: (x) =>
          params.baselineDrift *
          (1 + t) *
          (0.8 * baseline(x / 50 + lineIndex * 7.31) + 0.2 * ripple(x / 8 + lineIndex * 3.17)),
      };
    },

    glyph: () => {
      const t = glyphIndex++;
      return {
        scale: 1 + params.size * (1 + 0.6 * tired) * (0.7 * size(t / 20) + 0.3 * wobble()),
        rotation: params.rotation * (1 + 0.5 * tired) * DEG * wobble(),
        slant:
          (params.slant +
            3 * tired +
            params.slantVariation * (0.7 * slant(t / 30) + 0.3 * wobble())) *
          DEG,
        strokeScale: 1 + params.strokeWidth * (0.6 * stroke(t / 12) + 0.4 * wobble()),
        warp:
          params.warp > 0
            ? createWarp(rng, params.warp * (1 + 0.5 * tired), glyphXHeight)
            : undefined,
      };
    },

    wordGap: () =>
      Math.max(
        0.4,
        1 + 0.1 * tired + params.wordSpacing * (0.5 * gap(wordIndex++ / 6) + 0.5 * wobble()),
      ),

    letterGap: (prev, char) =>
      xHeight *
      (params.tracking +
        0.02 * tired +
        params.letterSpacing * (0.6 * pairBias(prev, char) + 0.4 * wobble())),
  };
}
