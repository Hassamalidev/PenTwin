import { DEFAULT_JITTER, type JitterParams } from './jitter';

export type PresetName = 'neat' | 'normal' | 'rushed';

/** Named bundles of jitter parameters. Pass one as `jitter` in the render options. */
export const PRESETS: Record<PresetName, JitterParams> = {
  /** Careful, slow writing: upright, even, close to the lines. */
  neat: {
    baselineDrift: 0.15,
    lineSlope: 0.2,
    rotation: 0.6,
    size: 0.025,
    wordSpacing: 0.12,
    letterSpacing: 0.03,
    slant: 2,
    slantVariation: 0.8,
    strokeWidth: 0.04,
    marginDrift: 0.3,
    warp: 0.03,
    tracking: 0,
    fatigue: 0,
  },

  normal: DEFAULT_JITTER,

  /** Fast writing: leaning forward, loose, uneven, wandering off the line. */
  rushed: {
    baselineDrift: 0.7,
    lineSlope: 1.2,
    rotation: 3,
    size: 0.1,
    wordSpacing: 0.45,
    letterSpacing: 0.12,
    slant: 11,
    slantVariation: 4,
    strokeWidth: 0.14,
    marginDrift: 2,
    warp: 0.1,
    tracking: 0.05,
    fatigue: 0,
  },
};
