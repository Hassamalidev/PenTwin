/**
 * Pushes 50-page exports through a running worker and checks what comes back.
 * Used to prove a memory-limited container survives them (Phase 7.3):
 *
 *   docker build -t pentwin-worker .
 *   docker run -d --name pentwin-check --memory=512m --memory-swap=512m -p 8797:8787 pentwin-worker
 *   pnpm exec tsx scripts/container-check.ts http://localhost:8797 6
 *
 * The second argument is how many different 50-page exports to send at the same time.
 * `--hand demo` writes with the demo handwriting (pen strokes) instead of the test letters,
 * and `--ink <name>` adds a pen, so strokes are drawn as pen outlines:
 *
 *   pnpm exec tsx scripts/container-check.ts http://localhost:8797 1 --hand demo --ink ballpoint-blue
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PDFDocument } from 'pdf-lib';
import {
  buildGlyphBank,
  INKS,
  renderDocument,
  type Block,
  type InkName,
} from '../packages/engine/src/index';
import { loadGlyphBank } from '../packages/engine/src/node/index';
import { buildDemoHand } from './demo-hand';

const PAGES = 50;
const base = (process.argv[2] ?? 'http://localhost:8787').replace(/\/$/, '');
const together = Number(process.argv[3] ?? 1);
const flag = (name: string): string | undefined =>
  process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined;
const demo = flag('--hand') === 'demo';
const ink = flag('--ink') as InkName | undefined;
if (ink && !INKS[ink]) throw new Error(`Unknown ink ${ink}`);

const glyphDir = 'tests/fixtures/glyphs/sample-user';
const hand = demo ? buildDemoHand() : undefined;
const bank = hand ?? {
  metadata: JSON.parse(readFileSync(join(glyphDir, 'metadata.json'), 'utf8')) as unknown,
  files: Object.fromEntries(
    readdirSync(glyphDir)
      .filter((name) => name.endsWith('.svg'))
      .map((name) => [name, readFileSync(join(glyphDir, name), 'utf8')]),
  ),
};
const options = {
  pageSize: 'A4',
  paper: { kind: 'ruled', ruling: 'college' },
  ...(ink ? { ink } : {}),
} as const;

// Add paragraphs until the document is at least 50 pages long.
const paragraph = readFileSync('tests/sample.txt', 'utf8').trim();
const local = hand
  ? buildGlyphBank(hand.metadata, (file) => hand.files[file]!)
  : loadGlyphBank(glyphDir).bank;
const blocks: Block[] = [];
let pages = 0;
while (pages < PAGES) {
  for (let i = 0; i < 10; i++) blocks.push({ type: 'paragraph', text: paragraph });
  pages = renderDocument(blocks, local, { ...options, seed: 'size' }).pages.length;
}
console.log(
  `document: ${blocks.length} paragraphs, ${pages} pages; sending ${together} at once` +
    `${demo ? ', demo hand' : ''}${ink ? `, ink ${ink}` : ''}`,
);

interface Outcome {
  status: number;
  seconds: number;
  pages?: number;
  megabytes?: number;
}

const exportOnce = async (seed: string): Promise<Outcome> => {
  const start = performance.now();
  const response = await fetch(`${base}/export`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ blocks, bank, options: { ...options, seed } }),
  });
  if (!response.ok) {
    return { status: response.status, seconds: (performance.now() - start) / 1000 };
  }
  const result = (await response.json()) as { downloadPath: string; pageCount: number };
  const file = await fetch(`${base}${result.downloadPath}`);
  const bytes = new Uint8Array(await file.arrayBuffer());
  // Open the file for real: a truncated or broken PDF must not count as a pass.
  const pdf = await PDFDocument.load(bytes);
  return {
    status: file.status,
    seconds: (performance.now() - start) / 1000,
    pages: pdf.getPageCount(),
    megabytes: bytes.length / 1048576,
  };
};

// A different seed each time, so nothing is answered from the cache.
const run = Date.now().toString(36);
const outcomes = await Promise.all(
  Array.from({ length: together }, (_, index) => exportOnce(`check-${run}-${index}`)),
);

let failed = false;
for (const [index, outcome] of outcomes.entries()) {
  const good = outcome.status === 200 && outcome.pages === pages;
  failed ||= !good;
  console.log(
    `  export ${index + 1}: ${good ? 'ok' : 'FAILED'} status=${outcome.status}` +
      ` pages=${outcome.pages ?? '-'} size=${outcome.megabytes?.toFixed(1) ?? '-'}MB` +
      ` time=${outcome.seconds.toFixed(1)}s`,
  );
}
const health = await fetch(`${base}/health`).then(
  (response) => response.status,
  () => 0,
);
console.log(`worker health afterwards: ${health === 200 ? 'ok' : `FAILED (${health})`}`);
if (failed || health !== 200) process.exit(1);
