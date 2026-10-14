/**
 * Close-up crops of the demo handwriting, for judging the pen and the placement at the
 * size a reader holds a page. Writes to the given folder (default: test-results/closeup).
 *
 *   pnpm closeup [folder]
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  buildGlyphBank,
  presetOptions,
  renderText,
  type PresetName,
  type RenderOptions,
} from '../packages/engine/src/index';
import { sceneToPng } from '../packages/engine/src/node/index';
import { buildDemoHand } from './demo-hand';

const out = process.argv[2] ?? 'test-results/closeup';
mkdirSync(out, { recursive: true });

const hand = buildDemoHand();
const bank = buildGlyphBank(hand.metadata, (file) => hand.files[file]!);
const text =
  'The experiment was repeated three times and the results were recorded in a table. ' +
  'Each reading was taken after the liquid had settled, and the first trial was discarded ' +
  'because the timer started late. It is quite likely that the final value is within ' +
  'two percent of the true figure, which is fine for this kind of quick initial test.';

const plain = (options: RenderOptions): RenderOptions => {
  // The same preset as before this review: no pen model, dots, tilt or joins.
  const jitter = options.jitter && { ...options.jitter, dotDrift: 0, wordTilt: 0, joins: 0 };
  const ink = typeof options.ink === 'string' ? options.ink : undefined;
  return { ...options, ...(jitter ? { jitter } : {}), ...(ink ? { inkColor: undefined } : {}) };
};

for (const preset of ['normal', 'rushed', 'exam'] as PresetName[]) {
  const options: RenderOptions = { seed: 'closeup', pageSize: 'A5', ...presetOptions(preset) };
  const { pages } = renderText(text, bank, options);
  writeFileSync(join(out, `${preset}-after.png`), sceneToPng(pages[0]!, 300));
  const before = plain(options);
  const { pages: old } = renderText(text, bank, {
    ...before,
    // Without the pen model: the same colour as the ink, one width per stroke.
    ink: undefined,
    inkColor: preset === 'exam' ? '#1d1d1f' : '#1b2a6b',
  });
  writeFileSync(join(out, `${preset}-before.png`), sceneToPng(old[0]!, 300));
  console.log(join(out, preset));
}
const { pages: fountain } = renderText(text, bank, {
  seed: 'closeup',
  pageSize: 'A5',
  ...presetOptions('normal'),
  ink: 'fountain',
});
writeFileSync(join(out, 'fountain-after.png'), sceneToPng(fountain[0]!, 300));
