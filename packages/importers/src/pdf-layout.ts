import type { Block } from '@pentwin/engine';

/** One piece of text as a PDF stores it: a string at a position. Units are PDF points. */
export interface PdfTextItem {
  text: string;
  /** Left edge. */
  x: number;
  /** Baseline, measured up from the bottom of the page. */
  y: number;
  width: number;
  /** Font height. */
  height: number;
}

export interface PdfPage {
  width: number;
  height: number;
  items: PdfTextItem[];
}

interface Line {
  text: string;
  x0: number;
  x1: number;
  y: number;
  height: number;
}

const median = (values: number[]): number => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)]!;
};

/** Items on the same baseline become rows; a wide gap inside a row splits it (two columns). */
function toLines(page: PdfPage): Line[] {
  const items = page.items
    .filter((item) => item.text.trim() !== '')
    .sort((a, b) => b.y - a.y || a.x - b.x);
  const rows: PdfTextItem[][] = [];
  for (const item of items) {
    const row = rows.at(-1);
    if (row && Math.abs(row[0]!.y - item.y) < Math.max(row[0]!.height, item.height) * 0.5) {
      row.push(item);
    } else {
      rows.push([item]);
    }
  }

  const lines: Line[] = [];
  for (const row of rows) {
    row.sort((a, b) => a.x - b.x);
    let current: Line | undefined;
    for (const item of row) {
      const gap = current ? item.x - current.x1 : 0;
      if (current && gap < item.height * 2.5) {
        const spaced =
          gap > item.height * 0.2 && !current.text.endsWith(' ') && !item.text.startsWith(' ');
        current.text += (spaced ? ' ' : '') + item.text;
        current.x1 = item.x + item.width;
        current.height = Math.max(current.height, item.height);
      } else {
        current = {
          text: item.text,
          x0: item.x,
          x1: item.x + item.width,
          y: item.y,
          height: item.height,
        };
        lines.push(current);
      }
    }
  }
  for (const line of lines) line.text = line.text.replace(/\s+/g, ' ').trim();
  return lines;
}

const PAGE_NUMBER = /^(page\s+)?\d+(\s*(of|\/)\s*\d+)?$/i;

/**
 * Finds running headers and footers: page numbers, and lines near the top or bottom
 * edge whose text repeats from page to page.
 */
function findFurniture(pages: { page: PdfPage; lines: Line[] }[]): Set<Line> {
  const edge = (page: PdfPage, line: Line): 'top' | 'bottom' | undefined =>
    line.y > page.height * 0.9 ? 'top' : line.y < page.height * 0.1 ? 'bottom' : undefined;
  // Digits are masked, so "Page 3" and "Page 4" count as the same line.
  const key = (where: string, line: Line): string => `${where}:${line.text.replace(/\d+/g, '#')}`;

  const seen = new Map<string, number>();
  for (const { page, lines } of pages) {
    for (const line of lines) {
      const where = edge(page, line);
      if (where) seen.set(key(where, line), (seen.get(key(where, line)) ?? 0) + 1);
    }
  }
  const repeated = Math.max(2, Math.ceil(pages.length / 2));
  const furniture = new Set<Line>();
  for (const { page, lines } of pages) {
    for (const line of lines) {
      const where = edge(page, line);
      if (!where) continue;
      if (PAGE_NUMBER.test(line.text) || (seen.get(key(where, line)) ?? 0) >= repeated) {
        furniture.add(line);
      }
    }
  }
  return furniture;
}

/**
 * Puts a page's lines in reading order. With two columns that means the whole left
 * column, then the right; a line spanning both (a title) keeps its place between them.
 */
function inReadingOrder(page: PdfPage, lines: Line[]): Line[][] {
  const middle = page.width / 2;
  const left = lines.filter((l) => l.x1 <= middle + 2);
  const right = lines.filter((l) => l.x0 >= middle - 2);
  const spanning = lines.filter((l) => !left.includes(l) && !right.includes(l));
  // Two columns only if both sides hold real text and little crosses the middle.
  const twoColumns =
    left.length >= 3 && right.length >= 3 && spanning.length <= lines.length * 0.25;
  const byHeight = (a: Line, b: Line): number => b.y - a.y;
  if (!twoColumns) return [[...lines].sort(byHeight)];

  const blocks: Line[][] = [];
  let top = Infinity;
  for (const span of [...spanning.sort(byHeight), undefined]) {
    const bottom = span?.y ?? -Infinity;
    const within = (l: Line): boolean => l.y < top && l.y > bottom;
    for (const side of [left, right]) {
      const column = side.filter(within).sort(byHeight);
      if (column.length > 0) blocks.push(column);
    }
    if (span) blocks.push([span]);
    top = bottom;
  }
  return blocks;
}

const ENDS_SENTENCE = /[.!?:;"')\]]$/;

/**
 * Rebuilds flowing text from the positioned fragments of a PDF: reading order, columns,
 * running headers and footers removed, lines joined back into paragraphs, and words
 * that were hyphenated across a line break made whole again.
 */
export function pdfToBlocks(pages: PdfPage[]): Block[] {
  const perPage = pages.map((page) => ({ page, lines: toLines(page) }));
  const furniture = findFurniture(perPage);
  const columns = perPage.flatMap(({ page, lines }) =>
    inReadingOrder(
      page,
      lines.filter((l) => !furniture.has(l)),
    ),
  );

  const all = columns.flat();
  const bodyHeight = median(all.flatMap((l) => Array<number>(l.text.length).fill(l.height)));
  const blocks: Block[] = [];
  let paragraph = '';
  const flush = (): void => {
    if (paragraph) blocks.push({ type: 'paragraph', text: paragraph });
    paragraph = '';
  };
  const append = (text: string): void => {
    if (!paragraph) paragraph = text;
    // "exam-" + "ple" was one word, split to fit the line.
    else if (/[a-z]-$/.test(paragraph) && /^[a-z]/.test(text))
      paragraph = paragraph.slice(0, -1) + text;
    else paragraph += ` ${text}`;
  };

  // Normal distance between two lines: a low quartile of all the gaps in the document.
  // Paragraph gaps are larger and can be nearly as common as line gaps in short
  // paragraphs, so a median would not do.
  const gaps = columns
    .flatMap((column) => column.slice(1).map((l, i) => column[i]!.y - l.y))
    .filter((gap) => gap > 0)
    .sort((x, y) => x - y);
  const spacing = gaps[Math.floor(gaps.length / 4)] ?? bodyHeight * 1.2;

  for (const column of columns) {
    const columnLeft = Math.min(...column.map((l) => l.x0));
    const columnRight = Math.max(...column.map((l) => l.x1));

    column.forEach((line, i) => {
      if (line.height >= bodyHeight * 1.25 && line.text.length < 90) {
        flush();
        blocks.push({
          type: 'heading',
          text: line.text,
          level: line.height >= bodyHeight * 1.6 ? 1 : 2,
        });
        return;
      }
      const previous = column[i - 1];
      if (previous && paragraph) {
        const gap = previous.y - line.y > spacing * 1.5;
        const indented = line.x0 > columnLeft + line.height * 1.2;
        const previousShort =
          previous.x1 < columnLeft + (columnRight - columnLeft) * 0.8 &&
          ENDS_SENTENCE.test(previous.text);
        if (gap || indented || previousShort) flush();
      }
      append(line.text);
    });
    // A paragraph can run on into the next column or page: keep it open if it clearly
    // stops mid-sentence, and close it otherwise.
    if (ENDS_SENTENCE.test(paragraph)) flush();
  }
  flush();
  return blocks;
}
