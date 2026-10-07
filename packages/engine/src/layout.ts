export interface Margins {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/** All lengths are in millimetres. */
export interface LayoutOptions {
  pageWidth: number;
  pageHeight: number;
  margins: Margins;
  lineHeight: number;
  /** Baseline of the first line on each page. Defaults to `margins.top + lineHeight`. */
  firstBaseline?: number;
  /** Baseline of the first line on the first page only, when it differs (a header). */
  firstPageBaseline?: number;
  /** Extra gap after each paragraph, in lines. Defaults to 0. */
  paragraphSpacing?: number;
  spaceWidth: number;
  /** Nominal advance of one character. */
  measure: (char: string) => number;
  /**
   * Only affects words too long for a whole line: when true, each forced break gets a
   * trailing hyphen. Words that fit on a line are never split. Defaults to false.
   */
  hyphenate?: boolean;
}

export interface LaidOutWord {
  text: string;
  /** Nominal left edge. The renderer may shift it when it applies spacing jitter. */
  x: number;
  width: number;
}

export interface LaidOutLine {
  baseline: number;
  words: LaidOutWord[];
}

export interface LaidOutPage {
  lines: LaidOutLine[];
}

const EPSILON = 1e-6;

/** Greedy word wrap and pagination. Runs of whitespace collapse to a single space. */
export function layoutText(text: string, options: LayoutOptions): LaidOutPage[] {
  const { margins, lineHeight, spaceWidth, measure } = options;
  const maxWidth = options.pageWidth - margins.left - margins.right;
  if (maxWidth <= 0 || lineHeight <= 0) throw new Error('Page has no room for text');

  const firstBaseline = options.firstBaseline ?? margins.top + lineHeight;
  const lastBaseline = options.pageHeight - margins.bottom;
  const paragraphGap = (options.paragraphSpacing ?? 0) * lineHeight;
  const widthOf = (s: string): number => [...s].reduce((sum, ch) => sum + measure(ch), 0);
  const hyphenWidth = options.hyphenate ? measure('-') : 0;

  const pages: LaidOutPage[] = [{ lines: [] }];
  let baseline = options.firstPageBaseline ?? firstBaseline;

  const emit = (words: LaidOutWord[]): void => {
    let page = pages.at(-1)!;
    if (baseline > lastBaseline + EPSILON && page.lines.length > 0) {
      page = { lines: [] };
      pages.push(page);
      baseline = firstBaseline;
    }
    page.lines.push({ baseline, words });
    baseline += lineHeight;
  };

  /** Splits a word wider than the line into pieces that each fit. */
  const breakLongWord = (word: string): string[] => {
    const pieces: string[] = [];
    let piece = '';
    let width = 0;
    for (const ch of word) {
      const w = measure(ch);
      if (piece && width + w + hyphenWidth > maxWidth + EPSILON) {
        pieces.push(options.hyphenate ? `${piece}-` : piece);
        piece = '';
        width = 0;
      }
      piece += ch;
      width += w;
    }
    pieces.push(piece);
    return pieces;
  };

  for (const paragraph of text.replace(/\r\n?/g, '\n').split('\n')) {
    let line: LaidOutWord[] = [];
    let cursor = 0;

    const flush = (): void => {
      emit(line);
      line = [];
      cursor = 0;
    };
    const place = (word: string): void => {
      const width = widthOf(word);
      const x = line.length > 0 ? cursor + spaceWidth : 0;
      if (line.length > 0 && x + width > maxWidth + EPSILON) {
        flush();
        place(word);
        return;
      }
      line.push({ text: word, x: margins.left + x, width });
      cursor = x + width;
    };

    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      if (widthOf(word) <= maxWidth + EPSILON) {
        place(word);
        continue;
      }
      if (line.length > 0) flush();
      const pieces = breakLongWord(word);
      pieces.forEach((piece, i) => {
        place(piece);
        if (i < pieces.length - 1) flush();
      });
    }

    // An empty paragraph still takes up a (blank) line.
    flush();
    baseline += paragraphGap;
  }

  return pages;
}
