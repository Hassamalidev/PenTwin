import { describe, expect, it, vi } from 'vitest';
import { OCR_ACCURACY_WARNING, OCR_PAGE_CAP, OcrNotAllowedError, runOcr } from './ocr';

const pages = (n: number): number[] => Array.from({ length: n }, (_, i) => i + 1);

describe('runOcr', () => {
  it('never runs without the user opting in', async () => {
    const recognize = vi.fn(async () => 'text');
    for (const optIn of [false, undefined, 'true', 1] as unknown as boolean[]) {
      await expect(runOcr([1, 2], { optIn, recognize })).rejects.toBeInstanceOf(OcrNotAllowedError);
    }
    expect(recognize).not.toHaveBeenCalled();
  });

  it('reads the pages in order and reports progress', async () => {
    const recognize = vi.fn(async (page: number) => `Page ${page} text.`);
    const progress: [number, number][] = [];
    const result = await runOcr([3, 5, 8], {
      optIn: true,
      recognize,
      onProgress: (done, total) => progress.push([done, total]),
    });
    expect(recognize.mock.calls.map(([page]) => page)).toEqual([3, 5, 8]);
    expect(progress).toEqual([
      [1, 3],
      [2, 3],
      [3, 3],
    ]);
    expect(result.pagesRead).toEqual([3, 5, 8]);
    expect(result.pagesSkipped).toEqual([]);
    expect(result.blocks).toEqual([
      { type: 'paragraph', text: 'Page 3 text.' },
      { type: 'paragraph', text: 'Page 5 text.' },
      { type: 'paragraph', text: 'Page 8 text.' },
    ]);
  });

  it('enforces the page cap, even when asked for more', async () => {
    const recognize = vi.fn(async () => 'x');
    const result = await runOcr(pages(25), { optIn: true, recognize, maxPages: 1000 });
    expect(recognize).toHaveBeenCalledTimes(OCR_PAGE_CAP);
    expect(result.pagesRead).toEqual(pages(OCR_PAGE_CAP));
    expect(result.pagesSkipped).toHaveLength(25 - OCR_PAGE_CAP);
    expect(result.warnings.at(-1)).toBe(
      'Only the first 10 scanned pages were read. 15 more were left out.',
    );
  });

  it('honours a lower limit', async () => {
    const recognize = vi.fn(async () => 'x');
    const result = await runOcr(pages(5), { optIn: true, recognize, maxPages: 2 });
    expect(recognize).toHaveBeenCalledTimes(2);
    expect(result.pagesSkipped).toEqual([3, 4, 5]);
  });

  it('always marks the result for review and warns about accuracy', async () => {
    const result = await runOcr([1], { optIn: true, recognize: async () => 'ok' });
    expect(result.needsReview).toBe(true);
    expect(result.warnings).toEqual([OCR_ACCURACY_WARNING]);
  });

  it('turns recognised lines back into paragraphs', async () => {
    const text =
      'The apparatus was cali-\nbrated before the\nexperiment.\n\n\nA second\r\nparagraph.\n';
    const result = await runOcr([1], { optIn: true, recognize: async () => text });
    expect(result.blocks).toEqual([
      { type: 'paragraph', text: 'The apparatus was calibrated before the experiment.' },
      { type: 'paragraph', text: 'A second paragraph.' },
    ]);
  });

  it('stops and reports if recognition fails part-way', async () => {
    const recognize = vi.fn(async (page: number) => {
      if (page === 2) throw new Error('recogniser crashed');
      return 'fine';
    });
    await expect(runOcr([1, 2, 3], { optIn: true, recognize })).rejects.toThrow(
      'recogniser crashed',
    );
    expect(recognize).toHaveBeenCalledTimes(2);
  });
});
