import type { ImportResult } from './html';
import { pdfToBlocks, type PdfPage } from './pdf-layout';

export interface PdfImportResult extends ImportResult {
  pageCount: number;
  /**
   * Pages (numbered from 1) with no text layer: scans or photos. Their content was not
   * imported. Reading them needs text recognition, which the user must opt in to.
   */
  scannedPages: number[];
}

/**
 * Reads the text of a PDF into headings and paragraphs. Only the text layer is read;
 * pictures, tables and the original layout are not kept.
 */
export async function importPdf(data: Uint8Array): Promise<PdfImportResult> {
  // The "legacy" build runs in Node as well as in browsers.
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  // pdf.js takes ownership of the buffer it is given, so hand it a copy.
  const task = getDocument({ data: data.slice(), useSystemFonts: true, verbosity: 0 });
  const doc = await task.promise;

  const pages: PdfPage[] = [];
  const scannedPages: number[] = [];
  try {
    for (let number = 1; number <= doc.numPages; number++) {
      const page = await doc.getPage(number);
      const [x0 = 0, y0 = 0, x1 = 0, y1 = 0] = page.view;
      const content = await page.getTextContent();
      const items = content.items.flatMap((item) =>
        'str' in item
          ? [
              {
                text: item.str,
                x: (item.transform[4] as number) - x0,
                y: (item.transform[5] as number) - y0,
                width: item.width,
                height: item.height || Math.abs(item.transform[3] as number),
              },
            ]
          : [],
      );
      if (!items.some((item) => item.text.trim() !== '')) scannedPages.push(number);
      pages.push({ width: x1 - x0, height: y1 - y0, items });
    }
  } finally {
    await task.destroy();
  }

  const warnings: string[] = [];
  if (scannedPages.length > 0) {
    const all = scannedPages.length === pages.length;
    warnings.push(
      `${all ? 'This PDF has' : `${scannedPages.length} of ${pages.length} pages have`} no selectable text ` +
        '(scanned or photographed pages). They were skipped. Text recognition can read them, ' +
        'but it is slower, less accurate, and has to be switched on by you.',
    );
  }
  return { blocks: pdfToBlocks(pages), warnings, pageCount: pages.length, scannedPages };
}
