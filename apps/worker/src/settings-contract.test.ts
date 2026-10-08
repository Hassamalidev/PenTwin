import { PRESETS, type PresetName } from '@pentwin/engine';
import { describe, expect, it } from 'vitest';
import {
  applyPreset,
  DEFAULT_SETTINGS,
  toRenderOptions,
  type Settings,
} from '../../web/src/lib/settings';
import { exportRequestSchema } from './schema';

/**
 * The editor builds render options from its settings; the worker validates them
 * strictly. This checks the two agree, so no setting in the editor can produce an
 * export the worker refuses.
 */
const optionsSchema = exportRequestSchema.shape.options;

const extremes: Partial<Settings>[] = [
  {},
  { unevenness: 0.4, size: 0.28, fatigue: 0, corrections: 0 },
  {
    unevenness: 1.6,
    size: 0.42,
    fatigue: 1,
    corrections: 0.05,
    pageNumbers: true,
    marginLine: true,
  },
  { paper: 'plain', pageSize: 'A5', ink: 'fountain' },
  { paper: 'graph', pageSize: 'Letter', ink: 'pencil', marginLine: true },
  { paper: 'dotted', ruling: 'narrow', ink: 'gel', seed: 987654 },
  { paper: 'ruled', ruling: 'wide', ink: 'ballpoint-black' },
];

describe('editor settings and worker schema', () => {
  it.each(Object.keys(PRESETS) as PresetName[])(
    'accepts every setting under the %s style',
    (preset) => {
      for (const extreme of extremes) {
        const settings = { ...applyPreset(DEFAULT_SETTINGS, preset), ...extreme };
        const result = optionsSchema.safeParse(toRenderOptions(settings));
        expect(result.error?.issues ?? []).toEqual([]);
      }
    },
  );

  it('changes the seed, and nothing else, when the look is rerolled', () => {
    const a = toRenderOptions(DEFAULT_SETTINGS);
    const b = toRenderOptions({ ...DEFAULT_SETTINGS, seed: DEFAULT_SETTINGS.seed + 1 });
    expect(b.seed).not.toBe(a.seed);
    expect({ ...b, seed: a.seed }).toEqual(a);
  });

  it('takes the pen, paper and slips from a style when it is chosen', () => {
    const exam = toRenderOptions(applyPreset(DEFAULT_SETTINGS, 'exam'));
    expect(exam.ink).toBe('ballpoint-black');
    expect(exam.paper).toEqual({ kind: 'ruled', ruling: 'wide', marginLine: true });
    expect(exam.corrections).toBe(0.025);
    expect(exam.jitter?.fatigue).toBe(PRESETS.exam.fatigue);
    // The user's own choice of pen then wins over the style's.
    const gel = toRenderOptions({ ...applyPreset(DEFAULT_SETTINGS, 'exam'), ink: 'gel' });
    expect(gel.ink).toBe('gel');
  });

  it('keeps the writing size in proportion to the line spacing', () => {
    const narrow = toRenderOptions({ ...DEFAULT_SETTINGS, ruling: 'narrow' });
    const wide = toRenderOptions({ ...DEFAULT_SETTINGS, ruling: 'wide' });
    expect(wide.xHeight!).toBeGreaterThan(narrow.xHeight!);
    expect(wide.xHeight! / 8.7).toBeCloseTo(narrow.xHeight! / 6.4, 1);
  });
});
