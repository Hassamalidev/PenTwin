import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PDFDocument } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import type { SampleText } from './sample-text';
import { buildSampleSheet } from './sheet';

const sample = JSON.parse(
  readFileSync(fileURLToPath(new URL('../../../docs/sample-text.json', import.meta.url)), 'utf8'),
) as SampleText;

describe('buildSampleSheet', () => {
  it('produces a single A4 page', async () => {
    const doc = await PDFDocument.load(await buildSampleSheet(sample));
    expect(doc.getPageCount()).toBe(1);
    const { width, height } = doc.getPage(0).getSize();
    expect(width).toBeCloseTo(595.28, 1);
    expect(height).toBeCloseTo(841.89, 1);
  });

  it('refuses text that would run off the page', async () => {
    const long = { ...sample, paragraphs: Array<string>(12).fill(sample.paragraphs.join(' ')) };
    await expect(buildSampleSheet(long)).rejects.toThrow(/does not fit/);
  });
});
