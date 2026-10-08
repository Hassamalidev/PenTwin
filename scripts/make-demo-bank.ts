/**
 * Packs the synthetic test glyph set into one JSON file the web app serves as the
 * "demo handwriting", for trying the editor before making a sample of your own.
 * Runs automatically before `dev` and `build` of the web app.
 */
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const source = join(root, 'tests/fixtures/glyphs/sample-user');
const target = join(root, 'apps/web/public/demo-bank.json');

const bank = {
  metadata: JSON.parse(readFileSync(join(source, 'metadata.json'), 'utf8')) as unknown,
  files: Object.fromEntries(
    readdirSync(source)
      .filter((name) => name.endsWith('.svg'))
      .map((name) => [name, readFileSync(join(source, name), 'utf8')]),
  ),
};
mkdirSync(dirname(target), { recursive: true });
writeFileSync(target, JSON.stringify(bank));
console.log(`demo bank: ${Object.keys(bank.files).length} glyph files`);
