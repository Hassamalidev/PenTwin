import { createRng, PAGE_SIZES, type PageSizeName, type Seed } from '@pentwin/shared';
import { addCorrections, readMarkers, RETRACE, STRUCK, type CorrectionCounts } from './corrections';
import { layoutHeader, writeFurniture, type FurnitureOptions } from './furniture';
import type { GlyphBank } from './glyphs';
import { INKS, type Ink, type InkName } from './ink';
import type { JitterParams } from './jitter';
import { layoutText, type Margins } from './layout';
import { createPaper, type Paper, type PaperSpec } from './paper';
import { createPageWriter, type InkStroke, type RenderReport } from './writer';

/** All lengths are in millimetres. */
export interface RenderOptions extends FurnitureOptions {
  /** Same text + bank + options + seed always gives the same pages. */
  seed: Seed;
  pageSize?: PageSizeName;
  margins?: Partial<Margins>;
  lineHeight?: number;
  /** Height of a lowercase "x". Defaults to 35% of the line height. */
  xHeight?: number;
  /** Extra gap after each paragraph, in lines. */
  paragraphSpacing?: number;
  hyphenate?: boolean;
  /** The pen: a named ink or custom settings. Omit for plain, uniform strokes. */
  ink?: InkName | Ink;
  /** Overrides the ink's colour. */
  inkColor?: string;
  penWidth?: number;
  /** Human variation. Omit for perfectly regular output. */
  jitter?: JitterParams;
  /**
   * Paper pattern. Ruled, graph and dotted paper set the line spacing and the first
   * baseline themselves, overriding `lineHeight` and `margins.top`.
   */
  paper?: PaperSpec;
  /**
   * Chance, 0 to 1, of writing a letter pair with a single pair glyph when the bank has
   * one. 0 turns pair glyphs off. Defaults to 0.7.
   */
  bigrams?: number;
  /**
   * Chance, 0 to 1, per eligible word of a correction: a slip that is struck out and
   * rewritten, or a letter gone over twice. Off (0) by default; 0.01 to 0.03 looks
   * natural. Only plain lowercase words are ever touched, so numbers, names, formulas
   * and anything capitalised are always written exactly as given.
   */
  corrections?: number;
}

/** A picture placed on the page. Lengths in mm. */
export interface SceneImage {
  /** A data URL (PNG or JPEG) or a link. Only data URLs are embedded in PDF output. */
  href: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A fully resolved page: every exporter (SVG, PDF, PNG) draws from this. */
export interface PageScene {
  width: number;
  height: number;
  inkColor: string;
  /** Bleed and grain of the ink, drawn in raster output only. */
  inkEffects?: Pick<Ink, 'bleed' | 'grain'>;
  paint: 'stroke' | 'fill';
  strokes: InkStroke[];
  /** Ideal baseline of each text line, before any variation. */
  baselines: number[];
  paper: Pick<Paper, 'background' | 'layers'>;
  /** Pictures on the page, drawn under the ink. */
  images?: SceneImage[];
}

export interface RenderResult {
  pages: PageScene[];
  report: RenderReport;
  /** Corrections that were added, if any were asked for. */
  corrections: CorrectionCounts;
}

const DEFAULT_MARGINS: Margins = { top: 20, right: 20, bottom: 20, left: 20 };
const DEFAULT_LINE_HEIGHT = 8;
const DEFAULT_INK = '#1b2a6b';
const DEFAULT_PEN_WIDTH = 0.4;

/** Page geometry and writing settings shared by every way of rendering. */
export function resolvePage(bank: GlyphBank, options: RenderOptions) {
  const size = PAGE_SIZES[options.pageSize ?? 'A4'];
  const paper = createPaper(options.paper ?? { kind: 'plain' }, size.widthMm, size.heightMm);
  const margins = { ...DEFAULT_MARGINS, ...options.margins };
  margins.left = Math.max(margins.left, paper.minLeft ?? 0);
  // Printed lines dictate the spacing: the writing has to sit on them.
  const lineHeight = paper.lineHeight ?? options.lineHeight ?? DEFAULT_LINE_HEIGHT;
  const jitter = options.jitter && {
    ...options.jitter,
    baselineDrift: options.jitter.baselineDrift * paper.driftScale,
    lineSlope: options.jitter.lineSlope * paper.driftScale,
    // Printed lines pull the writing back to them, word by word and line by line.
    wordBounce: (options.jitter.wordBounce ?? 0) * paper.driftScale,
    lineRide: (options.jitter.lineRide ?? 0) * paper.driftScale,
  };
  const xHeight = options.xHeight ?? lineHeight * 0.35;
  const ink = typeof options.ink === 'string' ? INKS[options.ink] : options.ink;
  const inkColor = options.inkColor ?? ink?.color ?? DEFAULT_INK;

  return {
    width: size.widthMm,
    height: size.heightMm,
    paper,
    margins,
    lineHeight,
    jitter,
    xHeight,
    penWidth: options.penWidth ?? DEFAULT_PEN_WIDTH,
    ink,
    inkColor,
    /** A blank page scene to add strokes to. */
    scene: (strokes: InkStroke[], baselines: number[]): PageScene => ({
      width: size.widthMm,
      height: size.heightMm,
      inkColor,
      ...(ink && (ink.bleed > 0 || ink.grain > 0)
        ? { inkEffects: { bleed: ink.bleed, grain: ink.grain } }
        : {}),
      paint: bank.paint,
      strokes,
      baselines,
      paper: { background: paper.background, layers: paper.layers },
    }),
  };
}

export function renderText(text: string, bank: GlyphBank, options: RenderOptions): RenderResult {
  const page = resolvePage(bank, options);
  const report: RenderReport = { pageCount: 0, glyphCount: 0, unknownChars: {}, bigramCount: 0 };
  const setup = {
    bank,
    xHeight: page.xHeight,
    penWidth: page.penWidth,
    jitter: page.jitter,
    ink: page.ink,
    bigramRate: options.bigrams,
    report,
  };

  // Layout only needs nominal widths, which do not depend on the page.
  const ruler = createPageWriter({ ...setup, pageSeed: `${options.seed}/ruler` });
  const corrected = addCorrections(
    text,
    options.corrections ?? 0,
    createRng(`${options.seed}/corrections`),
  );
  const header = options.header?.length
    ? layoutHeader(page, options.header, (text) => ruler.measure(text))
    : undefined;
  const laidOut = layoutText(corrected.text, {
    pageWidth: page.width,
    pageHeight: page.height,
    margins: page.margins,
    lineHeight: page.lineHeight,
    firstBaseline:
      (options.headerOnEveryPage ? header?.bodyStart : undefined) ?? page.paper.firstBaseline,
    firstPageBaseline: header?.bodyStart,
    paragraphSpacing: options.paragraphSpacing,
    hyphenate: options.hyphenate,
    spaceWidth: ruler.spaceWidth,
    measure: (char) => (char === STRUCK || char === RETRACE ? 0 : ruler.measure(char)),
  });
  report.pageCount = laidOut.length;

  const pages = laidOut.map((lines, pageIndex): PageScene => {
    const writer = createPageWriter({
      ...setup,
      pageSeed: `${options.seed}/page${pageIndex}`,
      lineCount: lines.lines.length,
    });
    lines.lines.forEach((line, lineIndex) => {
      const tokens = line.words.map((word) => readMarkers(word.text));
      writer.writeLine(tokens, {
        baseline: line.baseline,
        left: page.margins.left,
        right: page.width - page.margins.right,
        lineIndex,
      });
    });
    writeFurniture(writer, page, options, pageIndex, header);
    return page.scene(
      writer.strokes,
      lines.lines.map((line) => line.baseline),
    );
  });

  return { pages, report, corrections: corrected.counts };
}
