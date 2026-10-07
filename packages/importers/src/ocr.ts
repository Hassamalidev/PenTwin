import type { Block } from '@pentwin/engine';

/** Most pages text recognition will read in one go, whatever the caller asks for. */
export const OCR_PAGE_CAP = 10;

export const OCR_ACCURACY_WARNING =
  'This text was read from scanned pages by text recognition. It will contain mistakes. ' +
  'Check it against the original before you export.';

export class OcrNotAllowedError extends Error {
  constructor() {
    super('Text recognition was not switched on by the user.');
    this.name = 'OcrNotAllowedError';
  }
}

export interface OcrOptions {
  /**
   * Must be exactly `true`, and must come from an explicit choice by the user for this
   * document. Text recognition is slow and inaccurate, so it never runs by default.
   */
  optIn: boolean;
  /** Reads the text of one page (numbered from 1). Supplied by the app. */
  recognize: (pageNumber: number) => Promise<string>;
  /** Pages to read at most. Capped at `OCR_PAGE_CAP` regardless. */
  maxPages?: number;
  /** Called after each page, for a progress indicator. */
  onProgress?: (done: number, total: number) => void;
}

export interface OcrResult {
  blocks: Block[];
  pagesRead: number[];
  /** Pages left unread because of the page cap. */
  pagesSkipped: number[];
  /** Always true: recognised text has to be reviewed before it may be exported. */
  needsReview: true;
  warnings: string[];
}

/**
 * Reads scanned pages with text recognition, under the rules that keep it safe to offer:
 * only with the user's explicit opt-in, only up to a fixed number of pages, with
 * progress reported, and with the result marked as needing review.
 *
 * The recognition itself is supplied by the caller, so this holds the rules only.
 */
export async function runOcr(pages: readonly number[], options: OcrOptions): Promise<OcrResult> {
  if (options.optIn !== true) throw new OcrNotAllowedError();

  const limit = Math.max(0, Math.min(options.maxPages ?? OCR_PAGE_CAP, OCR_PAGE_CAP));
  const toRead = pages.slice(0, limit);
  const pagesSkipped = pages.slice(limit);

  const blocks: Block[] = [];
  let done = 0;
  for (const page of toRead) {
    const text = await options.recognize(page);
    // A blank line separates paragraphs; single line breaks are just the scan's line ends.
    for (const paragraph of text.replace(/\r\n?/g, '\n').split(/\n\s*\n/)) {
      const joined = paragraph
        .replace(/-\n(?=[a-z])/g, '')
        .replace(/\s+/g, ' ')
        .trim();
      if (joined) blocks.push({ type: 'paragraph', text: joined });
    }
    options.onProgress?.(++done, toRead.length);
  }

  const warnings = [OCR_ACCURACY_WARNING];
  if (pagesSkipped.length > 0) {
    warnings.push(
      `Only the first ${toRead.length} scanned pages were read. ` +
        `${pagesSkipped.length} more ${pagesSkipped.length === 1 ? 'was' : 'were'} left out.`,
    );
  }
  return {
    blocks,
    pagesRead: [...toRead],
    pagesSkipped: [...pagesSkipped],
    needsReview: true,
    warnings,
  };
}
