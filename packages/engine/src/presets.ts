import type { InkName } from './ink';
import { DEFAULT_JITTER, type JitterParams } from './jitter';
import type { PaperSpec } from './paper';

export type PresetName = 'neat' | 'normal' | 'rushed' | 'exam' | 'lecture';

/** How steady the hand is in each preset. Pass one as `jitter` in the render options. */
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

  /**
   * Exam hall: quick but controlled, because it has to be read. Starts close to normal
   * and tires clearly as the page fills.
   */
  exam: {
    baselineDrift: 0.45,
    lineSlope: 0.7,
    rotation: 2,
    size: 0.065,
    wordSpacing: 0.32,
    letterSpacing: 0.08,
    slant: 7,
    slantVariation: 2.6,
    strokeWidth: 0.1,
    marginDrift: 1.1,
    warp: 0.065,
    tracking: 0.02,
    fatigue: 0.7,
  },

  /**
   * Lecture notes: written for oneself while listening. Small and tight to save space,
   * fairly even, a steady forward lean, not much care about the margin.
   */
  lecture: {
    baselineDrift: 0.3,
    lineSlope: 0.6,
    rotation: 1.8,
    size: 0.06,
    wordSpacing: 0.3,
    letterSpacing: 0.07,
    slant: 9,
    slantVariation: 2.2,
    strokeWidth: 0.07,
    marginDrift: 1.6,
    warp: 0.06,
    tracking: -0.02,
    fatigue: 0.3,
  },
};

/** Everything a preset decides: the hand, plus the pen, paper and slips that go with it. */
export interface PresetOptions {
  jitter: JitterParams;
  ink: InkName;
  paper: PaperSpec;
  /** Chance per eligible word of a correction. */
  corrections: number;
}

const BUNDLES: Record<PresetName, Omit<PresetOptions, 'jitter'>> = {
  neat: { ink: 'gel', paper: { kind: 'ruled', ruling: 'college' }, corrections: 0 },
  normal: { ink: 'ballpoint-blue', paper: { kind: 'ruled', ruling: 'college' }, corrections: 0.01 },
  rushed: { ink: 'ballpoint-blue', paper: { kind: 'ruled', ruling: 'wide' }, corrections: 0.03 },
  exam: {
    ink: 'ballpoint-black',
    paper: { kind: 'ruled', ruling: 'wide', marginLine: true },
    corrections: 0.025,
  },
  lecture: {
    ink: 'pencil',
    paper: { kind: 'ruled', ruling: 'narrow', marginLine: true },
    corrections: 0.015,
  },
};

/**
 * The full set of render options for a preset. Spread it into the options and override
 * whatever the user has chosen themselves:
 * `renderText(text, bank, { seed, ...presetOptions('exam'), ink: 'gel' })`.
 */
export function presetOptions(name: PresetName): PresetOptions {
  return { jitter: PRESETS[name], ...BUNDLES[name] };
}
