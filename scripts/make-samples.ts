/**
 * Renders the sample images in docs/samples used for visual checks.
 *
 *   pnpm samples
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { DEFAULT_JITTER, renderText, type RenderOptions } from '../packages/engine/src/index';
import { loadGlyphBank, sceneToPng } from '../packages/engine/src/node/index';

const { bank } = loadGlyphBank('tests/fixtures/glyphs/sample-user');
const sample = readFileSync('tests/sample.txt', 'utf8');
const base: RenderOptions = { seed: 'samples', pageSize: 'A5' };

const samples: Record<string, [text: string, options: RenderOptions]> = {
  'jitter-off': [sample, base],
  'jitter-on': [sample, { ...base, jitter: DEFAULT_JITTER }],
};

mkdirSync('docs/samples', { recursive: true });
for (const [name, [text, options]] of Object.entries(samples)) {
  const { pages } = renderText(text, bank, options);
  writeFileSync(`docs/samples/${name}.png`, sceneToPng(pages[0]!, 110));
  console.log(`docs/samples/${name}.png`);
}
