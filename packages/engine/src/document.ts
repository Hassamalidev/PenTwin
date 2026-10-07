import { createRng } from '@pentwin/shared';
import { addCorrections, readMarkers, type CorrectionCounts } from './corrections';
import { layoutHeader, writeFurniture } from './furniture';
import type { GlyphBank } from './glyphs';
import {
  resolvePage,
  type PageScene,
  type RenderOptions,
  type RenderResult,
  type SceneImage,
} from './render';
import { createPageWriter, type PageWriter, type RenderReport, type Token } from './writer';

/** A stretch of text with one style. */
export interface Run {
  text: string;
  bold?: boolean;
  /** Written with extra lean, the way emphasis is shown by hand. */
  italic?: boolean;
}

export type Block =
  | { type: 'heading'; text: string; level?: 1 | 2 }
  | { type: 'paragraph'; text: string | Run[] }
  | { type: 'list'; ordered?: boolean; items: (string | Run[])[] }
  | { type: 'table'; rows: string[][] }
  /** `href` is a data URL (PNG or JPEG) or a link. Size in mm; scaled down if too wide. */
  | { type: 'image'; href: string; width: number; height: number }
  | { type: 'pageBreak' };

const HEADING_SCALE = { 1: 1.35, 2: 1.15 } as const;
/** Space between a table cell's border and its text, in mm. */
const CELL_PADDING = 1.5;
/** Share of a line above the baseline, used to place boxes around lines of text. */
const ASCENT = 0.72;

/**
 * Renders structured content: headings, paragraphs with bold, lists, tables and images.
 *
 * Everything is placed on one line grid, so on ruled paper every kind of block still
 * sits on the printed lines. Takes the same options as `renderText`.
 */
export function renderDocument(
  blocks: readonly Block[],
  bank: GlyphBank,
  options: RenderOptions,
): RenderResult {
  const page = resolvePage(bank, options);
  const report: RenderReport = { pageCount: 0, glyphCount: 0, unknownChars: {}, bigramCount: 0 };
  const corrections: CorrectionCounts = { struck: 0, retraced: 0 };
  const correctionRng = createRng(`${options.seed}/corrections`);

  const left = page.margins.left;
  const right = page.width - page.margins.right;
  const step = page.lineHeight;
  const ruler = createPageWriter({
    bank,
    xHeight: page.xHeight,
    penWidth: page.penWidth,
    report: { pageCount: 0, glyphCount: 0, unknownChars: {}, bigramCount: 0 },
    pageSeed: `${options.seed}/ruler`,
  });
  const header = options.header?.length
    ? layoutHeader(page, options.header, (text) => ruler.measure(text))
    : undefined;
  const firstBaseline = (pageIndex: number): number =>
    header && (pageIndex === 0 || options.headerOnEveryPage)
      ? header.bodyStart
      : (page.paper.firstBaseline ?? page.margins.top + step);
  const capacity = (pageIndex: number): number =>
    Math.max(
      1,
      Math.floor((page.height - page.margins.bottom - firstBaseline(pageIndex)) / step + 1e-6) + 1,
    );

  interface Sheet {
    writer: PageWriter;
    baselines: number[];
    images: SceneImage[];
    /** Next free line. */
    line: number;
  }
  const sheets: Sheet[] = [];
  const newSheet = (): Sheet => {
    const index = sheets.length;
    const sheet: Sheet = {
      writer: createPageWriter({
        bank,
        xHeight: page.xHeight,
        penWidth: page.penWidth,
        jitter: page.jitter,
        ink: page.ink,
        bigramRate: options.bigrams,
        report,
        pageSeed: `${options.seed}/page${index}`,
        lineCount: capacity(index),
      }),
      baselines: [],
      images: [],
      line: 0,
    };
    sheets.push(sheet);
    return sheet;
  };
  let sheet = newSheet();
  const room = (): number => capacity(sheets.length - 1) - sheet.line;
  /** Makes sure `lines` more lines fit on the current page, starting a new one if not. */
  const need = (lines: number): void => {
    if (room() < lines && sheet.line > 0) sheet = newSheet();
  };
  const baselineOf = (line: number): number => firstBaseline(sheets.length - 1) + line * step;
  /** Leaves blank lines, but never at the top of a page. */
  const skip = (lines: number): void => {
    if (sheet.line > 0) sheet.line = Math.min(capacity(sheets.length - 1), sheet.line + lines);
  };
  /** Claims the next line and returns its baseline. */
  const nextLine = (): { baseline: number; lineIndex: number } => {
    need(1);
    const lineIndex = sheet.line++;
    const baseline = baselineOf(lineIndex);
    sheet.baselines.push(baseline);
    return { baseline, lineIndex };
  };

  const toTokens = (
    content: string | Run[],
    style: { bold?: boolean; correct?: boolean },
  ): Token[] =>
    (typeof content === 'string' ? [{ text: content }] : content).flatMap((run) => {
      let text = run.text;
      if (style.correct) {
        const result = addCorrections(text, options.corrections ?? 0, correctionRng);
        text = result.text;
        corrections.struck += result.counts.struck;
        corrections.retraced += result.counts.retraced;
      }
      return text
        .split(/\s+/)
        .filter(Boolean)
        .map((word) => ({
          ...readMarkers(word),
          bold: style.bold ?? run.bold,
          italic: run.italic,
        }));
    });

  /** Greedy word wrap of tokens into lines no wider than `width`. */
  const wrap = (tokens: Token[], width: number, scale = 1): Token[][] => {
    const lines: Token[][] = [[]];
    let used = 0;
    for (const token of tokens) {
      const w = sheet.writer.measure(token.text, scale);
      const gap = lines.at(-1)!.length > 0 ? sheet.writer.spaceWidth * scale : 0;
      if (used + gap + w > width && lines.at(-1)!.length > 0) {
        lines.push([token]);
        used = w;
      } else {
        lines.at(-1)!.push(token);
        used += gap + w;
      }
    }
    return lines;
  };

  const writeFlow = (tokens: Token[], indent = 0, marker?: string): void => {
    wrap(tokens, right - left - indent).forEach((line, i) => {
      const at = nextLine();
      if (i === 0 && marker) {
        sheet.writer.writeLine([{ text: marker }], { ...at, left, right });
      }
      sheet.writer.writeLine(line, { ...at, left: left + indent, right });
    });
  };

  for (const block of blocks) {
    switch (block.type) {
      case 'pageBreak':
        if (sheet.line > 0) sheet = newSheet();
        break;

      case 'heading': {
        const level = block.level ?? 1;
        const scale = HEADING_SCALE[level];
        const lines = wrap(toTokens(block.text, { bold: true }), right - left, scale);
        skip(1);
        // Keep a heading together with at least one line of what follows.
        need(lines.length + 1);
        for (const line of lines) {
          const at = nextLine();
          const end = sheet.writer.writeLine(line, { ...at, left, right, scale });
          if (level === 1) {
            const y = at.baseline + page.xHeight * 0.5;
            sheet.writer.drawLine(left, y, end, y);
          }
        }
        break;
      }

      case 'paragraph':
        writeFlow(toTokens(block.text, { correct: true }));
        skip(Math.round(options.paragraphSpacing ?? 0));
        break;

      case 'list': {
        const widest = block.ordered ? `${block.items.length}.` : '-';
        const indent = sheet.writer.measure(widest) + sheet.writer.spaceWidth;
        block.items.forEach((item, i) => {
          writeFlow(toTokens(item, { correct: true }), indent, block.ordered ? `${i + 1}.` : '-');
        });
        skip(Math.round(options.paragraphSpacing ?? 0));
        break;
      }

      case 'table': {
        const columns = Math.max(1, ...block.rows.map((row) => row.length));
        const columnWidth = (right - left) / columns;
        skip(1);

        // Borders are drawn per page, once the rows on that page are known.
        let edges: number[] = [];
        const closeSegment = (): void => {
          if (edges.length < 2) return;
          for (const y of edges) sheet.writer.drawLine(left, y, right, y);
          for (let c = 0; c <= columns; c++) {
            const x = left + c * columnWidth;
            sheet.writer.drawLine(x, edges[0]!, x, edges.at(-1)!);
          }
          edges = [];
        };

        for (const row of block.rows) {
          const cells = Array.from({ length: columns }, (_, c) =>
            wrap(toTokens(row[c] ?? '', {}), columnWidth - 2 * CELL_PADDING),
          );
          const height = Math.max(1, ...cells.map((lines) => lines.length));
          if (room() < height && sheet.line > 0) {
            closeSegment();
            sheet = newSheet();
          }
          if (edges.length === 0) edges.push(baselineOf(sheet.line) - ASCENT * step);
          for (let i = 0; i < height; i++) {
            const at = nextLine();
            cells.forEach((lines, c) => {
              const tokens = lines[i];
              if (!tokens?.length) return;
              const cellLeft = left + c * columnWidth + CELL_PADDING;
              sheet.writer.writeLine(tokens, {
                ...at,
                left: cellLeft,
                right: cellLeft + columnWidth - 2 * CELL_PADDING,
              });
            });
          }
          edges.push(baselineOf(sheet.line) - ASCENT * step);
        }
        closeSegment();
        skip(1);
        break;
      }

      case 'image': {
        const fit = Math.min(1, (right - left) / block.width);
        const width = block.width * fit;
        const height = block.height * fit;
        const lines = Math.max(1, Math.ceil(height / step));
        need(lines);
        sheet.images.push({
          href: block.href,
          x: left,
          y: baselineOf(sheet.line) - ASCENT * step,
          width,
          height,
        });
        sheet.line += lines;
        break;
      }
    }
  }

  report.pageCount = sheets.length;
  const pages = sheets.map((s, pageIndex): PageScene => {
    writeFurniture(s.writer, page, options, pageIndex, header);
    return { ...page.scene(s.writer.strokes, s.baselines), images: s.images };
  });
  return { pages, report, corrections };
}
