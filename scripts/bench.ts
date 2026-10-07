/**
 * Performance baseline for the engine: renders and exports a 50-page document.
 *
 *   pnpm bench
 */
import { readFileSync } from 'node:fs';
import { cpus } from 'node:os';
import { DEFAULT_JITTER, renderText, scenesToPdf } from '../packages/engine/src/index';
import { loadGlyphBank, sceneToPng } from '../packages/engine/src/node/index';

const PAGES = 50;
const { bank } = loadGlyphBank('tests/fixtures/glyphs/sample-user');
const text = `${readFileSync('tests/sample.txt', 'utf8')}\n`.repeat(172);

const time = async <T>(fn: () => T | Promise<T>): Promise<[T, number]> => {
  const start = performance.now();
  const result = await fn();
  return [result, performance.now() - start];
};

const [rendered, renderMs] = await time(() =>
  renderText(text, bank, {
    seed: 'bench',
    jitter: DEFAULT_JITTER,
    paper: { kind: 'ruled', ruling: 'college', marginLine: true },
  }),
);
const pages = rendered.pages.slice(0, PAGES);
if (pages.length < PAGES) throw new Error(`Only ${pages.length} pages rendered`);
const glyphs = Math.round((rendered.report.glyphCount / rendered.report.pageCount) * PAGES);
// The input runs slightly past PAGES pages, so scale the time down to exactly PAGES.
const layoutMs = (renderMs / rendered.report.pageCount) * PAGES;

const [pdf, pdfMs] = await time(() => scenesToPdf(pages));
const [png, pngMs] = await time(() => sceneToPng(pages[0]!, 150));
const memory = process.memoryUsage();

const row = (label: string, value: string): void => console.log(`| ${label} | ${value} |`);
console.log(`Node ${process.version}, ${cpus()[0]?.model.trim()}, ${cpus().length} threads\n`);
console.log('| Measure | Result |\n| --- | --- |');
row('Pages', String(PAGES));
row('Glyphs placed', `${glyphs} (${Math.round(glyphs / PAGES)} per page)`);
row('Layout + placement', `${layoutMs.toFixed(0)} ms (${(layoutMs / PAGES).toFixed(1)} ms/page)`);
row('PDF export', `${pdfMs.toFixed(0)} ms (${(pdfMs / PAGES).toFixed(1)} ms/page)`);
row(
  'Total to PDF',
  `${((layoutMs + pdfMs) / PAGES).toFixed(1)} ms/page, ${((PAGES * 1000) / (layoutMs + pdfMs)).toFixed(0)} pages/s`,
);
row(
  'PDF size',
  `${(pdf.length / 1048576).toFixed(2)} MB (${(pdf.length / 1024 / PAGES).toFixed(0)} KB/page)`,
);
row('PNG, one page at 150 dpi', `${pngMs.toFixed(0)} ms, ${(png.length / 1024).toFixed(0)} KB`);
row('Peak memory (RSS)', `${(memory.rss / 1048576).toFixed(0)} MB`);
row('Heap used', `${(memory.heapUsed / 1048576).toFixed(0)} MB`);
