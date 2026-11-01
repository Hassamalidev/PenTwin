/**
 * The learning loop: tunes each writing style against measurements of real handwriting.
 *
 * It changes a few settings at random, writes real pages with them, measures those pages
 * with the same code that measured the real ones, and keeps the change only if the pages
 * land closer to the real range. No images are kept, and nothing here learns from users:
 * the input is packages/engine/src/real-ranges.json (numbers only), from `pnpm real:measure`.
 *
 *   pnpm learn [--steps 60] [--style normal]   prints what it found
 *   pnpm learn --write                         updates learned-styles.json and the log
 *
 * A result only reaches users through a commit that passes `pnpm test` and `pnpm tells`.
 * See docs/learning-loop.md.
 */
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createRng } from '../packages/shared/src/rng';
import {
  buildGlyphBank,
  HAND_SET_PRESETS,
  PRESETS,
  renderText,
  type JitterParams,
  type PresetName,
} from '../packages/engine/src/index';
import { sceneToPixels } from '../packages/engine/src/node/index';
import {
  cleanImage,
  distanceFromReal,
  measurePage,
  type MeasureRange,
  type MeasureSummary,
  type PageMeasure,
} from '../packages/extractor/src/index';
import { buildDemoHand } from './demo-hand';

const LEARNED_FILE = 'packages/engine/src/learned-styles.json';
const REAL_FILE = 'packages/engine/src/real-ranges.json';

const TEXT =
  'Within a short time she was walking briskly toward the Emerald City, her silver shoes ' +
  'tinkling merrily on the hard, yellow roadbed. The sun shone bright and the birds sang ' +
  'sweet and Dorothy did not feel nearly as bad as you might think a little girl would who ' +
  'had been suddenly whisked away from her own country and set down in the midst of a ' +
  'strange land.';

/**
 * The settings the loop may move, each with its limits. Bounded, so it cannot run away. The
 * limits on size, letter spacing, rotation and tilt come from looking at the pages: beyond
 * them words jump in size and letters drift apart, which no measure here sees.
 */
const TUNABLE: [keyof JitterParams, number, number][] = [
  ['baselineDrift', 0.1, 2.5],
  ['lineSlope', 0.2, 4],
  ['rotation', 0.5, 3.5],
  ['size', 0.02, 0.12],
  ['wordSpacing', 0.1, 0.9],
  ['letterSpacing', 0.02, 0.12],
  ['slantVariation', 0.8, 7],
  ['marginDrift', 0.3, 5.5],
  ['wordBounce', 0.03, 0.4],
  ['lineRide', 0.03, 0.55],
  ['wordTilt', 1, 4.5],
  ['wordGapScale', 0.9, 2.6],
];

/** A neat writer sits in the lower part of the real range, a hurried one in the upper. */
const TARGET: Record<PresetName, [low: number, high: number]> = {
  neat: [0, 0.5],
  normal: [0.2, 0.8],
  lecture: [0.3, 0.9],
  exam: [0.4, 1],
  rushed: [0.5, 1],
};

const flag = (name: string): string | undefined =>
  process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined;
const steps = Number(flag('--steps') ?? 60);
const only = flag('--style') as PresetName | undefined;
const write = process.argv.includes('--write');

const { ranges, pages, writers } = JSON.parse(readFileSync(REAL_FILE, 'utf8')) as {
  ranges: MeasureSummary;
  pages: number;
  writers: number;
};

const hand = buildDemoHand();
const bank = buildGlyphBank(hand.metadata, (file) => hand.files[file]!);

/** The part of the real range this style aims for. */
const aimFor = (style: PresetName): MeasureSummary => {
  const [from, to] = TARGET[style];
  const narrow = ({ low, high }: MeasureRange): MeasureRange => ({
    low: low + (high - low) * from,
    median: low + ((high - low) * (from + to)) / 2,
    high: low + (high - low) * to,
  });
  return Object.fromEntries(
    Object.entries(ranges).map(([name, range]) => [name, narrow(range)]),
  ) as MeasureSummary;
};

const measure = (jitter: JitterParams, seed: string): PageMeasure | undefined => {
  const { pages: written } = renderText(TEXT, bank, {
    seed,
    pageSize: 'Letter',
    jitter,
    paper: { kind: 'plain' },
    lineHeight: 11,
  });
  // Enough to read the shape of a page, and four times quicker than print resolution.
  const pixels = sceneToPixels({ ...written[0]!, inkEffects: undefined }, 110);
  return measurePage(cleanImage(pixels).binary);
};

const SEEDS = ['learn-a', 'learn-b'];
const score = (jitter: JitterParams, aim: MeasureSummary): number => {
  const scores = SEEDS.map((seed) => {
    const measured = measure(jitter, seed);
    return measured ? distanceFromReal(measured, aim) : 10;
  });
  return scores.reduce((sum, value) => sum + value, 0) / scores.length;
};

const round = (value: number): number => Math.round(value * 1000) / 1000;

function train(style: PresetName): { best: JitterParams; before: number; after: number } {
  const rng = createRng(`learn/${style}/${pages}`);
  const aim = aimFor(style);
  // From the hand-set style each time, so a run depends only on the real measurements.
  let best: JitterParams = { ...HAND_SET_PRESETS[style] };
  const before = score(best, aim);
  let bestScore = before;
  // First a big jump: the gap to real writing is too wide for small steps to cross.
  for (const factor of [1.5, 2, 3, 4]) {
    const candidate = { ...HAND_SET_PRESETS[style] };
    for (const [key, low, high] of TUNABLE) {
      const now = (candidate[key] as number | undefined) ?? low;
      const moved = key === 'wordGapScale' ? 1 + (factor - 1) * 0.4 : now * factor;
      candidate[key] = round(Math.max(low, Math.min(high, moved))) as never;
    }
    const candidateScore = score(candidate, aim);
    console.log(`  ${style} scale ${factor}: ${candidateScore.toFixed(3)}`);
    if (candidateScore < bestScore) {
      best = candidate;
      bestScore = candidateScore;
    }
  }
  for (let step = 0; step < steps; step++) {
    const candidate = { ...best };
    // A few settings at a time: moving one alone rarely shows, moving all rarely helps.
    for (let i = 0; i < 3; i++) {
      const [key, low, high] = TUNABLE[rng.int(0, TUNABLE.length - 1)]!;
      const now = (candidate[key] as number | undefined) ?? (key === 'wordGapScale' ? 1 : low);
      const change = Math.exp((rng.next() + rng.next() - 1) * 0.7);
      candidate[key] = round(Math.max(low, Math.min(high, now * change))) as never;
    }
    const candidateScore = score(candidate, aim);
    if (candidateScore < bestScore) {
      best = candidate;
      bestScore = candidateScore;
      console.log(`  ${style} step ${step}: ${bestScore.toFixed(3)}`);
    }
  }
  return { best, before, after: bestScore };
}

const styles = only ? [only] : (Object.keys(PRESETS) as PresetName[]);
const learned = existsSync(LEARNED_FILE)
  ? (JSON.parse(readFileSync(LEARNED_FILE, 'utf8')) as {
      styles: Partial<Record<PresetName, Partial<JitterParams>>>;
    })
  : { styles: {} };
const log: string[] = [];
for (const style of styles) {
  const { best, before, after } = train(style);
  console.log(`${style}: distance from real ${before.toFixed(3)} -> ${after.toFixed(3)}`);
  log.push(`| ${style} | ${before.toFixed(3)} | ${after.toFixed(3)} |`);
  learned.styles[style] = Object.fromEntries(
    TUNABLE.map(([key]) => [key, best[key]]).filter(([, value]) => value !== undefined),
  );
}

// Whatever the search found, a style must keep its place, steadiest first. Each setting is
// sorted along the chain, with neat kept clearly apart and each step a little above the last.
const CHAIN: PresetName[] = ['neat', 'normal', 'lecture', 'exam', 'rushed'];
if (CHAIN.every((style) => learned.styles[style])) {
  for (const [key] of TUNABLE) {
    const values = CHAIN.map((style) => learned.styles[style]![key] as number).sort(
      (x, y) => x - y,
    );
    values[0] = Math.min(values[0]!, round(values[1]! * 0.7));
    for (let i = 2; i < values.length; i++) {
      values[i] = Math.max(values[i]!, round(values[i - 1]! * 1.04));
    }
    CHAIN.forEach((style, i) => {
      (learned.styles[style]![key] as number) = values[i]!;
    });
  }
}

if (write) {
  writeFileSync(
    LEARNED_FILE,
    `${JSON.stringify({ trainedOn: { pages, writers }, styles: learned.styles }, null, 2)}\n`,
  );
  appendFileSync(
    'docs/learning-log.md',
    `\n## Run: ${pages} real pages, ${writers} writers, ${steps} steps\n\n` +
      `| Style | Distance before | After |\n| --- | --- | --- |\n${log.join('\n')}\n`,
  );
  console.log(LEARNED_FILE);
}
