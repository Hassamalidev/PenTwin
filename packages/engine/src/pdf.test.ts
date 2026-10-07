import { readFileSync } from 'node:fs';
import { PDFDocument } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { DEFAULT_JITTER } from './jitter';
import { sceneToPng } from './node/png';
import { scenesToPdf } from './pdf';
import { renderText } from './render';
import { loadSampleBank, repoPath } from './testing';

const bank = loadSampleBank();
const sample = readFileSync(repoPath('tests/sample.txt'), 'utf8');

describe('scenesToPdf', () => {
  it('writes a 10-page A4 PDF of a reasonable size', { timeout: 60_000 }, async () => {
    // About 36 lines of writing per ruled A4 page.
    const { pages } = renderText(`${sample}\n`.repeat(60), bank, {
      seed: 'pdf',
      jitter: DEFAULT_JITTER,
      paper: { kind: 'ruled', ruling: 'college', marginLine: true },
    });
    const scenes = pages.slice(0, 10);
    expect(scenes).toHaveLength(10);

    const bytes = await scenesToPdf(scenes);
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe('%PDF-');

    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(10);
    const { width, height } = doc.getPage(0).getSize();
    expect(width).toBeCloseTo(595.28, 1);
    expect(height).toBeCloseTo(841.89, 1);

    // Recorded in docs/perf.md; fails if output size regresses badly.
    expect(bytes.length).toBeLessThan(6 * 1024 * 1024);
  });

  it('is reproducible apart from the embedded timestamps', async () => {
    const { pages } = renderText(sample, bank, { seed: 1, pageSize: 'A5' });
    const [a, b] = await Promise.all([scenesToPdf(pages), scenesToPdf(pages)]);
    expect(a.length).toBe(b.length);
  });
});

describe('sceneToPng', () => {
  it('rasterizes a page at the requested resolution', () => {
    const { pages } = renderText(sample, bank, { seed: 1, pageSize: 'A5' });
    const png = sceneToPng(pages[0]!, 72);
    expect([...png.slice(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
    // Width and height are big-endian at bytes 16 and 20 of the IHDR chunk.
    const view = new DataView(png.buffer, png.byteOffset);
    expect(view.getUint32(16)).toBe(420); // 148mm at 72dpi
    expect(view.getUint32(20)).toBeGreaterThanOrEqual(595);
    expect(view.getUint32(20)).toBeLessThanOrEqual(597);
  });
});
