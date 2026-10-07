import type { resolvePage } from './render';
import type { PageWriter } from './writer';

/** One entry of the page header, e.g. `{ label: 'Name', value: 'Sara Khan' }`. */
export interface HeaderField {
  label?: string;
  value: string;
}

export interface FurnitureOptions {
  /**
   * Fields written at the top of the page in the same handwriting: name, roll number,
   * date and so on. Two share a row (one at each margin) when they fit side by side;
   * otherwise each gets its own row.
   */
  header?: HeaderField[];
  /** Repeat the header on every page instead of only the first. */
  headerOnEveryPage?: boolean;
  /** Write the page number at the bottom of each page. */
  pageNumbers?: boolean;
}

type Page = ReturnType<typeof resolvePage>;

export interface HeaderLayout {
  /** Baseline of each header row. */
  rows: number[];
  /** For every field: which row it is on, and whether it is pushed to the right margin. */
  fields: { text: string; row: number; alignRight: boolean }[];
  /** Where the body text starts on a page that carries the header. */
  bodyStart: number;
}

/** Keeps the header clear of the top edge of the sheet. */
const MIN_TOP = 9;
/** Written text runs a little wider than its nominal measure. */
const SLACK = 1.1;

/** Decides where the header fields go and where the body can start below them. */
export function layoutHeader(
  page: Page,
  header: readonly HeaderField[],
  measure: (text: string) => number,
): HeaderLayout {
  const width = page.width - page.margins.right - page.margins.left;
  const gap = page.xHeight * 3;
  const texts = header.map((f) => (f.label ? `${f.label}: ${f.value}` : f.value));

  const fields: HeaderLayout['fields'] = [];
  let row = 0;
  for (let i = 0; i < texts.length; i++) {
    const next = texts[i + 1];
    fields.push({ text: texts[i]!, row, alignRight: false });
    if (next !== undefined && (measure(texts[i]!) + measure(next)) * SLACK + gap <= width) {
      fields.push({ text: next, row, alignRight: true });
      i++;
    }
    row++;
  }

  const step = page.lineHeight;
  const ruled = page.paper.firstBaseline;
  if (ruled !== undefined) {
    // Lined paper: the header goes in the blank strip above the first line when it fits
    // there; otherwise everything moves down by whole lines so it all stays on the ruling.
    const top = ruled - row * step;
    const shift = top < MIN_TOP ? Math.ceil((MIN_TOP - top) / step) * step : 0;
    return {
      rows: Array.from({ length: row }, (_, k) => ruled - (row - k) * step + shift),
      fields,
      bodyStart: ruled + shift,
    };
  }
  const first = page.margins.top + step;
  return {
    rows: Array.from({ length: row }, (_, k) => first + k * step),
    fields,
    // Half a line of air between header and body.
    bodyStart: first + (row + 0.5) * step,
  };
}

/** Writes the header and page number onto one page. */
export function writeFurniture(
  writer: PageWriter,
  page: Page,
  options: FurnitureOptions,
  pageIndex: number,
  header: HeaderLayout | undefined,
): void {
  const left = page.margins.left;
  const right = page.width - page.margins.right;

  if (header && (pageIndex === 0 || options.headerOnEveryPage)) {
    for (const field of header.fields) {
      const tokens = field.text
        .split(/\s+/)
        .filter(Boolean)
        .map((word) => ({ text: word }));
      writer.writeLine(tokens, {
        baseline: header.rows[field.row]!,
        left: field.alignRight ? Math.max(left, right - writer.measure(field.text) * SLACK) : left,
        right,
        // Above the body: negative line numbers, so the body's own variation is unaffected.
        lineIndex: field.row - header.rows.length,
      });
    }
  }

  if (options.pageNumbers) {
    const text = String(pageIndex + 1);
    writer.writeLine([{ text }], {
      baseline: page.height - Math.max(8, page.margins.bottom * 0.5),
      left: (page.width - writer.measure(text)) / 2,
      right,
      lineIndex: 999,
    });
  }
}
