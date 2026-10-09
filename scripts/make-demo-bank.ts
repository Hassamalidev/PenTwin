/**
 * Packs the demo handwriting into one JSON file the web app serves, for trying the
 * editor before making a sample of your own. The letters come from scripts/demo-hand.ts.
 * Runs automatically before `dev` and `build` of the web app.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDemoHand } from './demo-hand';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const target = join(root, 'apps/web/public/demo-bank.json');

const bank = buildDemoHand();
mkdirSync(dirname(target), { recursive: true });
writeFileSync(target, JSON.stringify(bank));
console.log(`demo bank: ${Object.keys(bank.files).length} glyph files`);
