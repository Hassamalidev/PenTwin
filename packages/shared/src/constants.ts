import type { PageSize, PageSizeName } from './types';

/** Millimetres to PDF points (1pt = 1/72in). */
export const MM_TO_PT = 72 / 25.4;

export const PAGE_SIZES: Record<PageSizeName, PageSize> = {
  A4: { widthMm: 210, heightMm: 297 },
  Letter: { widthMm: 215.9, heightMm: 279.4 },
  A5: { widthMm: 148, heightMm: 210 },
};

export const DEFAULT_PAGE_SIZE: PageSizeName = 'A4';
