/**
 * Renders the sample images in docs/samples used for visual checks.
 *
 *   pnpm samples
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import {
  applyEffects,
  DEFAULT_JITTER,
  encodePng,
  NO_JITTER,
  presetOptions,
  PRESETS,
  renderDocument,
  renderText,
  type PaperSpec,
  type RenderOptions,
} from '../packages/engine/src/index';
import { loadGlyphBank, sceneToPixels, sceneToPng } from '../packages/engine/src/node/index';

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
  // The two bundled presets, with their own pen, paper and slips.
  'preset-exam': [`${sample}${sample}`, { ...base, ...presetOptions('exam') }],
  'preset-lecture': [`${sample}${sample}`, { ...base, ...presetOptions('lecture') }],
  ...Object.fromEntries(
    (['ballpoint-blue', 'ballpoint-black', 'gel', 'fountain', 'pencil'] as const).map(
      (ink): [string, [string, RenderOptions]] => [
        `ink-${ink}`,
        [sample, { ...base, jitter: PRESETS.normal, ink, lineHeight: 9, penWidth: 0.45 }],
      ],
    ),
  ),
  corrections: [
    'the weather was pleasant through most of that long afternoon, although several people wondered whether another storm might arrive before evening and spoil their carefully planned outing. Dr. Khan paid $1,250.75 on 03/14/2025.',
    { ...base, seed: 'fix', jitter: PRESETS.normal, corrections: 0.25, lineHeight: 10 },
  ],
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

// The same page clean, as a flatbed scan, and as a phone photo with a fold.
const { pages: effectPages } = renderText(sample, bank, {
  ...base,
  jitter: PRESETS.normal,
  ink: 'ballpoint-blue',
  paper: { kind: 'ruled', ruling: 'college', marginLine: true },
});
// A lower resolution than the other samples: noise makes these files large.
const cleanPage = sceneToPixels(effectPages[0]!, 80);
for (const [name, options] of [
  ['effect-scan', { mode: 'scan' }],
  ['effect-photo', { mode: 'photo', crease: true }],
] as const) {
  const image = applyEffects(cleanPage, { seed: 'samples', ...options });
  writeFileSync(`docs/samples/${name}.png`, await encodePng(image));
  console.log(`docs/samples/${name}.png`);
}

// Structured content: header fields, headings, bold, lists, a table and a picture.
const swatch = await encodePng({
  width: 60,
  height: 40,
  data: Uint8Array.from({ length: 60 * 40 * 4 }, (_, i) =>
    i % 4 === 3 ? 255 : i % 4 === 0 ? 90 + ((i / 4) % 60) * 2 : i % 4 === 1 ? 150 : 200,
  ),
});
const { pages: documentPages } = renderDocument(
  [
    { type: 'heading', text: 'Water cycle notes' },
    {
      type: 'paragraph',
      text: [
        { text: 'Water moves between the sea, the air and the land. The main driver is' },
        { text: 'heat from the sun,', bold: true },
        { text: 'which lifts water into the air.' },
      ],
    },
    { type: 'heading', text: 'Stages', level: 2 },
    {
      type: 'list',
      ordered: true,
      items: ['Evaporation from seas and lakes', 'Condensation into clouds', 'Rain or snow falls'],
    },
    {
      type: 'table',
      rows: [
        ['Stage', 'Where', 'State'],
        ['Evaporation', 'sea surface', 'gas'],
        ['Rainfall', 'over land and sea', 'liquid'],
      ],
    },
    {
      type: 'image',
      href: `data:image/png;base64,${Buffer.from(swatch).toString('base64')}`,
      width: 36,
      height: 24,
    },
    { type: 'list', items: ['rivers return it to the sea', 'then it starts again'] },
  ],
  bank,
  {
    ...base,
    jitter: PRESETS.normal,
    paper: { kind: 'ruled', ruling: 'college', marginLine: true },
    header: [
      { label: 'Name', value: 'Sara Khan' },
      { label: 'Date', value: '14/03/2025' },
      { label: 'Roll no', value: '2041' },
    ],
    pageNumbers: true,
  },
);
writeFileSync('docs/samples/document.png', sceneToPng(documentPages[0]!, 110));
console.log('docs/samples/document.png');
