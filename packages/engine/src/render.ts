import { createRng, PAGE_SIZES, type PageSizeName, type Seed } from '@pentwin/shared';
import { createVariantPicker, type Glyph, type GlyphBank } from './glyphs';
import { layoutText, type Margins } from './layout';
import { transformPath, type PathCommand } from './path';
import { identityStyler, type GlyphStyle, type Styler } from './style';

/** All lengths are in millimetres. */
export interface RenderOptions {
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
  inkColor?: string;
  penWidth?: number;
}

export interface InkStroke {
  /** Path in page coordinates (mm). */
  path: PathCommand[];
  /** Pen width in mm. Ignored when the bank's glyphs are filled outlines. */
  width: number;
}

/** A fully resolved page: every exporter (SVG, PDF, PNG) draws from this. */
export interface PageScene {
  width: number;
  height: number;
  inkColor: string;
  paint: 'stroke' | 'fill';
  strokes: InkStroke[];
  /** Ideal baseline of each text line, before any variation. */
  baselines: number[];
}

export interface RenderReport {
  pageCount: number;
  glyphCount: number;
  /** Characters the bank has no glyph for, with how often each occurred. A gap is left. */
  unknownChars: Record<string, number>;
}

export interface RenderResult {
  pages: PageScene[];
  report: RenderReport;
}

const DEFAULT_MARGINS: Margins = { top: 20, right: 20, bottom: 20, left: 20 };
const DEFAULT_LINE_HEIGHT = 8;
const DEFAULT_INK = '#1b2a6b';
const DEFAULT_PEN_WIDTH = 0.4;
/** Word gaps shrink at most this far to keep a line inside the right margin. */
const MIN_GAP_SQUEEZE = 0.5;

interface Slot {
  glyph?: Glyph;
  style: GlyphStyle;
  /** Space before this slot: a letter gap, or a word gap for the first slot of a word. */
  gapBefore: number;
  isWordStart: boolean;
  advance: number;
}

export function renderText(text: string, bank: GlyphBank, options: RenderOptions): RenderResult {
  const size = PAGE_SIZES[options.pageSize ?? 'A4'];
  const margins = { ...DEFAULT_MARGINS, ...options.margins };
  const lineHeight = options.lineHeight ?? DEFAULT_LINE_HEIGHT;
  const xHeight = options.xHeight ?? lineHeight * 0.35;
  const penWidth = options.penWidth ?? DEFAULT_PEN_WIDTH;
  const unit = xHeight / bank.xHeight;
  const spaceWidth = bank.spaceAdvance * unit;

  const nominalAdvance = new Map<string, number>();
  for (const [char, variants] of bank.glyphs) {
    const mean = variants.reduce((sum, v) => sum + v.advance, 0) / variants.length;
    nominalAdvance.set(char, mean * unit);
  }

  const laidOut = layoutText(text, {
    pageWidth: size.widthMm,
    pageHeight: size.heightMm,
    margins,
    lineHeight,
    paragraphSpacing: options.paragraphSpacing,
    hyphenate: options.hyphenate,
    spaceWidth,
    measure: (char) => nominalAdvance.get(char) ?? spaceWidth,
  });

  const report: RenderReport = { pageCount: laidOut.length, glyphCount: 0, unknownChars: {} };

  const pages = laidOut.map((page, pageIndex): PageScene => {
    // Separate streams, so changing the styling never changes which variants are picked.
    const picker = createVariantPicker(
      bank,
      createRng(`${options.seed}/page${pageIndex}/variants`),
    );
    const styler: Styler = identityStyler;
    const strokes: InkStroke[] = [];

    page.lines.forEach((line, lineIndex) => {
      const lineStyle = styler.line(lineIndex);
      const startX = margins.left + lineStyle.offsetX;

      const slots: Slot[] = [];
      for (const word of line.words) {
        let prev = '';
        for (const char of word.text) {
          const glyph = picker.pick(char);
          const style = styler.glyph(char);
          const isWordStart = prev === '';
          const gapBefore = isWordStart
            ? slots.length > 0
              ? spaceWidth * styler.wordGap()
              : 0
            : styler.letterGap(prev, char);
          if (!glyph) report.unknownChars[char] = (report.unknownChars[char] ?? 0) + 1;
          const advance = glyph ? glyph.advance * unit * style.scale : spaceWidth;
          slots.push({ glyph, style, gapBefore, isWordStart, advance });
          prev = char;
        }
      }

      // Like a writer running out of room, tighten the word gaps before crossing the margin.
      const natural = slots.reduce((sum, s) => sum + s.gapBefore + s.advance, 0);
      const wordGaps = slots.reduce((sum, s) => sum + (s.isWordStart ? s.gapBefore : 0), 0);
      const overflow = startX + natural - (size.widthMm - margins.right);
      const squeeze =
        overflow > 0 && wordGaps > 0 ? Math.max(MIN_GAP_SQUEEZE, 1 - overflow / wordGaps) : 1;

      let pen = startX;
      for (const slot of slots) {
        pen += slot.isWordStart ? slot.gapBefore * squeeze : slot.gapBefore;
        if (slot.glyph) {
          const { style } = slot;
          const scale = unit * style.scale;
          const tanSlant = Math.tan(style.slant);
          const angle = style.rotation + lineStyle.slope;
          const cos = Math.cos(angle);
          const sin = Math.sin(angle);
          const originX = pen;
          const originY =
            line.baseline +
            lineStyle.baselineShift(pen) +
            Math.tan(lineStyle.slope) * (pen - startX);

          strokes.push({
            width: penWidth * style.strokeScale,
            path: transformPath(slot.glyph.path, (gx, gy) => {
              const [wx, wy] = style.warp ? style.warp(gx, gy) : [gx, gy];
              const x = (wx - wy * tanSlant) * scale;
              const y = wy * scale;
              return [originX + x * cos - y * sin, originY + x * sin + y * cos];
            }),
          });
          report.glyphCount++;
        }
        pen += slot.advance;
      }
    });

    return {
      width: size.widthMm,
      height: size.heightMm,
      inkColor: options.inkColor ?? DEFAULT_INK,
      paint: bank.paint,
      strokes,
      baselines: page.lines.map((line) => line.baseline),
    };
  });

  return { pages, report };
}
