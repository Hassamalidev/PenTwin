/**
 * Renders the sample images in docs/samples used for visual checks.
 *
 *   pnpm samples
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import {
  DEFAULT_JITTER,
  NO_JITTER,
  PRESETS,
  renderText,
  type PaperSpec,
  type RenderOptions,
} from '../packages/engine/src/index';
import { loadGlyphBank, sceneToPng } from '../packages/engine/src/node/index';

const { bank } = loadGlyphBank('tests/fixtures/glyphs/sample-user');
const sample = readFileSync('tests/sample.txt', 'utf8');
const base: RenderOptions = { seed: 'samples', pageSize: 'A5' };
const RULED: PaperSpec = { kind: 'ruled', ruling: 'wide' };

const samples: Record<string, [text: string, options: RenderOptions]> = {
  'jitter-off': [sample, base],
  'jitter-on': [sample, { ...base, jitter: DEFAULT_JITTER }],
  'paper-ruled': [
    sample,
    {
      ...base,
      jitter: DEFAULT_JITTER,
      paper: { kind: 'ruled', ruling: 'college', marginLine: true },
    },
  ],
  'paper-graph': [sample, { ...base, jitter: DEFAULT_JITTER, paper: { kind: 'graph' } }],
  'paper-dotted': [sample, { ...base, jitter: DEFAULT_JITTER, paper: { kind: 'dotted' } }],
  'preset-neat': [sample, { ...base, jitter: PRESETS.neat, paper: RULED }],
  'preset-normal': [sample, { ...base, jitter: PRESETS.normal, paper: RULED }],
  'preset-rushed': [sample, { ...base, jitter: PRESETS.rushed, paper: RULED }],
  ...Object.fromEntries(
    (['ballpoint-blue', 'ballpoint-black', 'gel', 'fountain', 'pencil'] as const).map(
      (ink): [string, [string, RenderOptions]] => [
        `ink-${ink}`,
        [sample, { ...base, jitter: PRESETS.normal, ink, lineHeight: 9, penWidth: 0.45 }],
      ],
    ),
  ),
  // Top of the page against the bottom: the hand tires as it goes.
  fatigue: [
    `${sample}${sample}`,
    {
      ...base,
      jitter: { ...PRESETS.normal, fatigue: 0.6 },
      lineHeight: 8.2,
      margins: { top: 12, bottom: 10 },
    },
  ],
  // Only the warp is on, so every difference between two letters comes from it.
  'warp-e': [
    'eeee eeee eeee eeee eeee eeee eeee eeee eeee eeee eeee eeee eeee eeee',
    { ...base, lineHeight: 14, jitter: { ...NO_JITTER, warp: 0.05 } },
  ],
};

mkdirSync('docs/samples', { recursive: true });
for (const [name, [text, options]] of Object.entries(samples)) {
  const { pages } = renderText(text, bank, options);
  writeFileSync(`docs/samples/${name}.png`, sceneToPng(pages[0]!, 110));
  console.log(`docs/samples/${name}.png`);
}
