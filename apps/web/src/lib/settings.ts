import {
  presetOptions,
  RULING_SPACING,
  type InkName,
  type JitterParams,
  type PaperSpec,
  type PresetName,
  type RenderOptions,
  type Ruling,
} from '@pentwin/engine';
import type { PageSizeName } from '@pentwin/shared';

/** What the user can set in the editor. Everything else follows from these. */
export interface Settings {
  preset: PresetName;
  /** `preset` keeps the pen that comes with the preset. */
  ink: InkName | 'preset';
  paper: PaperSpec['kind'];
  ruling: Ruling;
  marginLine: boolean;
  pageSize: PageSizeName;
  /** Size of the writing, as the share of a line taken by a small letter. */
  size: number;
  /** 0.4 to 1.6: scales how uneven the hand is. 1 is the preset as designed. */
  unevenness: number;
  fatigue: number;
  corrections: number;
  pageNumbers: boolean;
  /** Changing it rewrites the page with different random choices: "reroll the look". */
  seed: number;
}

export const DEFAULT_SETTINGS: Settings = {
  preset: 'normal',
  ink: 'preset',
  paper: 'ruled',
  ruling: 'college',
  marginLine: false,
  pageSize: 'A4',
  size: 0.35,
  unevenness: 1,
  fatigue: 0,
  corrections: 0,
  pageNumbers: false,
  seed: 1,
};

export const PRESET_LABELS: Record<PresetName, string> = {
  neat: 'Neat',
  normal: 'Normal',
  rushed: 'Rushed',
  exam: 'Exam hall',
  lecture: 'Lecture notes',
};

export const INK_LABELS: Record<InkName | 'preset', string> = {
  preset: 'Same as style',
  'ballpoint-blue': 'Blue ballpoint',
  'ballpoint-black': 'Black ballpoint',
  gel: 'Gel pen',
  fountain: 'Fountain pen',
  pencil: 'Pencil',
};

export const PAPER_LABELS: Record<PaperSpec['kind'], string> = {
  ruled: 'Lined',
  plain: 'Plain',
  graph: 'Squared',
  dotted: 'Dotted',
};

/** Jitter fields that grow and shrink together with the unevenness slider, with their limits. */
const SCALED: [keyof JitterParams, max: number][] = [
  ['baselineDrift', 3],
  ['lineSlope', 5],
  ['rotation', 10],
  ['size', 0.5],
  ['wordSpacing', 1],
  ['letterSpacing', 0.5],
  ['slantVariation', 15],
  ['strokeWidth', 0.5],
  ['marginDrift', 6],
  ['warp', 0.3],
  ['wordBounce', 0.6],
  ['lineRide', 0.6],
  ['pressure', 0.6],
];

/** Choosing a preset also sets the paper, pen and slips that belong to it. */
export function applyPreset(settings: Settings, preset: PresetName): Settings {
  const bundle = presetOptions(preset);
  return {
    ...settings,
    preset,
    ink: 'preset',
    paper: bundle.paper.kind,
    ruling: bundle.paper.ruling ?? settings.ruling,
    marginLine: bundle.paper.marginLine ?? false,
    corrections: bundle.corrections,
    fatigue: bundle.jitter.fatigue,
  };
}

/** The render options for these settings. The preview and the export both use exactly these. */
export function toRenderOptions(settings: Settings): RenderOptions {
  const bundle = presetOptions(settings.preset);
  const jitter: JitterParams = { ...bundle.jitter, fatigue: settings.fatigue };
  for (const [key, max] of SCALED) {
    jitter[key] = Math.min(max, (jitter[key] ?? 0) * settings.unevenness);
  }

  const paper: PaperSpec =
    settings.paper === 'ruled'
      ? { kind: 'ruled', ruling: settings.ruling, marginLine: settings.marginLine }
      : { kind: settings.paper, marginLine: settings.marginLine };
  const lineHeight =
    settings.paper === 'ruled'
      ? RULING_SPACING[settings.ruling]
      : settings.paper === 'plain'
        ? 8
        : 10;

  return {
    seed: `look-${settings.seed}`,
    pageSize: settings.pageSize,
    paper,
    ink: settings.ink === 'preset' ? bundle.ink : settings.ink,
    jitter,
    corrections: settings.corrections,
    pageNumbers: settings.pageNumbers,
    xHeight: Math.round(lineHeight * settings.size * 100) / 100,
    ...(settings.paper === 'plain' ? { lineHeight } : {}),
  };
}
