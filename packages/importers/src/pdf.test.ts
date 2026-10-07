import { PDFDocument, StandardFonts, type PDFFont, type PDFPage as LibPage } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { importPdf } from './pdf';
import { pdfToBlocks, type PdfPage } from './pdf-layout';

const FIRST =
  'The experiment was repeated three times and the results were recorded in a table for later comparison with the expected values.';
const SECOND =
  'Each reading was taken after the liquid had settled, because an early reading gave a value that was too high to be trusted.';
const THIRD = 'The average was then compared with the expected value. The difference was small.';

/** Breaks text into lines of at most `width`, hyphenating one long word where asked. */
const wrap = (text: string, font: PDFFont, size: number, width: number): string[] => {
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(' ')) {
    const next = line ? `${line} ${word}` : word;
    if (line && font.widthOfTextAtSize(next, size) > width) {
      lines.push(line);
      line = word;
    } else line = next;
  }
  return [...lines, line];
};

const drawLines = (
  page: LibPage,
  lines: string[],
  font: PDFFont,
  x: number,
  top: number,
  size = 11,
): number => {
  let y = top;
  for (const line of lines) {
    page.drawText(line, { x, y, size, font });
    y -= size * 1.3;
  }
  return y;
};

async function singleColumn(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bodies = [
    [FIRST, SECOND],
    [THIRD, FIRST],
    [SECOND, THIRD],
  ];
  bodies.forEach((paragraphs, i) => {
    const page = doc.addPage([595, 842]);
    page.drawText('Physics Notes - Chapter 4', { x: 72, y: 800, size: 9, font });
    page.drawText(`Page ${i + 1} of 3`, { x: 270, y: 30, size: 9, font });
    let y = 740;
    if (i === 0) {
      page.drawText('Measuring density', { x: 72, y: 770, size: 18, font });
    }
    for (const paragraph of paragraphs) {
      y = drawLines(page, wrap(paragraph, font, 11, 451), font, 72, y) - 11 * 1.3;
    }
  });
  return doc.save();
}

async function twoColumns(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([595, 842]);
  page.drawText('A title across both columns', { x: 72, y: 780, size: 18, font });
  drawLines(page, wrap(`${FIRST} ${SECOND}`, font, 11, 210), font, 72, 740);
  drawLines(page, wrap(`${THIRD} ${FIRST}`, font, 11, 210), font, 315, 740);
  return doc.save();
}

const textOf = (blocks: { type: string; text?: unknown }[]): string[] =>
  blocks.map((b) => `${b.type}: ${String(b.text)}`);

describe('importPdf', { timeout: 60_000 }, () => {
  it('rebuilds clean paragraphs from a text PDF, without headers or footers', async () => {
    const result = await importPdf(await singleColumn());
    expect(result.pageCount).toBe(3);
    expect(result.scannedPages).toEqual([]);
    expect(result.warnings).toEqual([]);
    expect(textOf(result.blocks)).toEqual([
      'heading: Measuring density',
      `paragraph: ${FIRST}`,
      `paragraph: ${SECOND}`,
      `paragraph: ${THIRD}`,
      `paragraph: ${FIRST}`,
      `paragraph: ${SECOND}`,
      `paragraph: ${THIRD}`,
    ]);
    const everything = JSON.stringify(result.blocks);
    expect(everything).not.toContain('Physics Notes');
    expect(everything).not.toContain('Page 1');
  });

  it('reads two columns left then right, with a spanning title first', async () => {
    const { blocks } = await importPdf(await twoColumns());
    expect(textOf(blocks)).toEqual([
      'heading: A title across both columns',
      `paragraph: ${FIRST} ${SECOND}`,
      `paragraph: ${THIRD} ${FIRST}`,
    ]);
  });

  it('reports pages with no text layer instead of returning nothing silently', async () => {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    doc.addPage([595, 842]).drawText('Real text here.', { x: 72, y: 700, size: 11, font });
    doc.addPage([595, 842]).drawRectangle({ x: 50, y: 50, width: 400, height: 600 });
    const result = await importPdf(await doc.save());
    expect(result.scannedPages).toEqual([2]);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('1 of 2 pages have no selectable text');
    expect(result.blocks).toEqual([{ type: 'paragraph', text: 'Real text here.' }]);
  });

  it('rejects a file that is not a PDF', async () => {
    await expect(importPdf(new TextEncoder().encode('not a pdf'))).rejects.toThrow();
  });
});

describe('pdfToBlocks', () => {
  const page = (lines: [text: string, x: number, y: number, height?: number][]): PdfPage => ({
    width: 595,
    height: 842,
    items: lines.map(([text, x, y, height = 11]) => ({
      text,
      x,
      y,
      height,
      width: text.length * 5.5,
    })),
  });

  it('rejoins words hyphenated across a line break', () => {
    const blocks = pdfToBlocks([
      page([
        ['The apparatus was cali-', 72, 700],
        ['brated before the experi-', 72, 686],
        ['ment began.', 72, 672],
      ]),
    ]);
    expect(blocks).toEqual([
      { type: 'paragraph', text: 'The apparatus was calibrated before the experiment began.' },
    ]);
  });

  it('keeps a hyphen that is not a line-break hyphen', () => {
    const blocks = pdfToBlocks([
      page([
        ['Values ranged from 10 -', 72, 700],
        ['20 units in the well-', 72, 686],
        ['Known cases.', 72, 672],
      ]),
    ]);
    expect(blocks).toEqual([
      { type: 'paragraph', text: 'Values ranged from 10 - 20 units in the well- Known cases.' },
    ]);
  });

  it('starts a new paragraph at a gap, an indent, or after a short last line', () => {
    const wide = 'x'.repeat(80);
    const blocks = pdfToBlocks([
      page([
        [`${wide}`, 72, 700],
        ['ends here.', 72, 686],
        [`Next ${wide}`, 72, 672],
        [`same paragraph ${wide}`, 72, 658],
        [`Indented start ${wide}`, 100, 644],
        [`After a gap ${wide}`, 72, 600],
      ]),
    ]);
    expect(blocks.map((b) => (b as { text: string }).text.split(' ')[0])).toEqual([
      wide,
      'Next',
      'Indented',
      'After',
    ]);
  });

  it('joins fragments on one line and carries a sentence across pages', () => {
    const blocks = pdfToBlocks([
      page([
        ['The', 72, 700],
        ['quick', 92, 700],
        ['fox ran over the hill and', 126, 700],
      ]),
      page([['into the wood.', 72, 780]]),
    ]);
    expect(blocks).toEqual([
      { type: 'paragraph', text: 'The quick fox ran over the hill and into the wood.' },
    ]);
  });

  it('removes bare page numbers and returns nothing for empty pages', () => {
    expect(
      pdfToBlocks([
        page([
          ['7', 290, 30],
          ['Body text.', 72, 400],
        ]),
      ]),
    ).toEqual([{ type: 'paragraph', text: 'Body text.' }]);
    expect(pdfToBlocks([page([])])).toEqual([]);
  });
});
