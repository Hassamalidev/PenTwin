import { createRng } from '@pentwin/shared';
import { createVariantPicker, type Glyph, type GlyphBank } from './glyphs';
import type { Ink } from './ink';
import { createJitterStyler, createNoise, type JitterParams } from './jitter';
import { transformPath, type PathCommand } from './path';
import { identityStyler, type GlyphStyle, type Styler } from './style';

export interface InkStroke {
  /** The character (or letter pair) this glyph stands for. Empty for drawn lines. */
  char: string;
  /** Path in page coordinates (mm). */
  path: PathCommand[];
  /** Pen width in mm. Not used when the stroke is only filled. */
  width: number;
  /** 0 to 1. Omitted means fully opaque. */
  opacity?: number;
  /**
   * How to paint the path. Omitted means the bank's own way (`PageScene.paint`).
   * `both` fills the outline and strokes it too, which is how filled glyphs are made bold.
   */
  mode?: 'stroke' | 'fill' | 'both';
  /** Part of a word that was struck out, or the line striking it. Not part of the text. */
  struck?: true;
  /** A second pass over a letter already written. Not part of the text. */
  retrace?: true;
}

export interface RenderReport {
  pageCount: number;
  glyphCount: number;
  /** Characters the bank has no glyph for, with how often each occurred. A gap is left. */
  unknownChars: Record<string, number>;
  /** How many letter pairs were written with a single pair glyph. */
  bigramCount: number;
}

/** One word to write, with how to write it. */
export interface Token {
  text: string;
  /** Heavier strokes. */
  bold?: boolean;
  /** Extra lean. */
  italic?: boolean;
  /** A mistake: written, then crossed out. */
  struck?: boolean;
  /** Index of a letter that is gone over a second time. */
  retrace?: number;
}

/** Where one line of writing goes. All lengths in mm. */
export interface LineSpec {
  baseline: number;
  left: number;
  /** The writing should not run past this x. */
  right: number;
  /** Position of the line on the page; drives the slow line-to-line variation. */
  lineIndex: number;
  /** Size multiplier, e.g. 1.3 for a heading. */
  scale?: number;
}

export interface PageWriter {
  /** Writes the tokens along a line and returns the x where the pen ended up. */
  writeLine(tokens: readonly Token[], spec: LineSpec): number;
  /** Draws a freehand straight line: an underline, a table rule. */
  drawLine(x0: number, y0: number, x1: number, y1: number): void;
  /** Width the text would nominally take at the given size. */
  measure(text: string, scale?: number): number;
  /** Nominal width of a space. */
  spaceWidth: number;
  strokes: InkStroke[];
}

export interface WriterSetup {
  bank: GlyphBank;
  /** Height of a lowercase "x" in mm. */
  xHeight: number;
  penWidth: number;
  /** Seed for everything random on this page. */
  pageSeed: string;
  jitter?: JitterParams;
  report: RenderReport;
  /**
   * Chance, 0 to 1, of using a pair glyph where the bank has one. Not always, so the
   * same pair does not look identical every time. Defaults to 0.7.
   */
  bigramRate?: number;
  /** The pen. Omit for plain, uniform strokes. */
  ink?: Ink;
  /** Lines of writing on this page; fatigue builds up over them. */
  lineCount?: number;
}

/** Word gaps shrink at most this far to keep a line inside its right limit. */
const MIN_GAP_SQUEEZE = 0.5;
/** Extra lean of italic text, in radians (about 10 degrees). */
const ITALIC_LEAN = 0.18;
/** Pen width multiplier for bold stroke glyphs. */
const BOLD_STROKE = 1.6;
/** Outline added around bold filled glyphs, as a fraction of the pen width. */
const BOLD_OUTLINE = 0.7;

interface Slot {
  glyph?: Glyph;
  style: GlyphStyle;
  /** Space before this slot: a letter gap, or a word gap for the first slot of a word. */
  gapBefore: number;
  isWordStart: boolean;
  advance: number;
  bold: boolean;
  italic: boolean;
  /** Which token this belongs to, and where in it. */
  token: number;
  charIndex: number;
}

/**
 * The part of the engine that actually writes: turns words into placed, styled glyphs on
 * one page. Body text, headers, list markers and table cells all go through it, so they
 * share one hand.
 */
export function createPageWriter(setup: WriterSetup): PageWriter {
  const { bank, xHeight, penWidth, report } = setup;
  const unit = xHeight / bank.xHeight;
  const spaceWidth = bank.spaceAdvance * unit;

  const nominalAdvance = new Map<string, number>();
  for (const [char, variants] of bank.glyphs) {
    const mean = variants.reduce((sum, v) => sum + v.advance, 0) / variants.length;
    nominalAdvance.set(char, mean * unit);
  }
  const measure = (text: string, scale = 1): number =>
    [...text].reduce(
      (sum, char) => sum + (char === ' ' ? spaceWidth : (nominalAdvance.get(char) ?? spaceWidth)),
      0,
    ) * scale;

  // Separate streams, so changing the styling never changes which variants are picked.
  const picker = createVariantPicker(bank, createRng(`${setup.pageSeed}/variants`));
  const styler: Styler = setup.jitter
    ? createJitterStyler(setup.jitter, createRng(`${setup.pageSeed}/style`), {
        xHeight,
        glyphXHeight: bank.xHeight,
        lineCount: setup.lineCount,
      })
    : identityStyler;
  const strokes: InkStroke[] = [];
  const bigrams = bank.bigrams?.size ? bank.bigrams : undefined;
  const bigramRate = setup.bigramRate ?? 0.7;
  const bigramRng = createRng(`${setup.pageSeed}/bigrams`);
  const { ink } = setup;
  const inkRng = createRng(`${setup.pageSeed}/ink`);
  const flow = createNoise(inkRng);
  const pressure = createNoise(inkRng);
  let inkIndex = 0;
  const markRng = createRng(`${setup.pageSeed}/marks`);

  /** Applies the pen (ink, bold) to a placed glyph outline. */
  const inked = (
    char: string,
    path: PathCommand[],
    strokeScale: number,
    bold: boolean,
  ): InkStroke => {
    const stroke: InkStroke = { char, width: penWidth * strokeScale, path };
    if (bank.paint === 'fill') stroke.width = 0;
    if (ink) {
      // Both change slowly from glyph to glyph, like ink flow and hand pressure do.
      const t = inkIndex++;
      stroke.opacity = ink.opacity * (1 - ink.shading * (0.5 + 0.5 * flow(t / 14)));
      const swell = ink.width * (1 + ink.widthVariation * pressure(t / 9));
      if (bank.paint === 'fill') {
        // A filled outline has no pen width to change; a broader pen is drawn as an
        // outline around the glyph.
        stroke.width = Math.max(0, penWidth * (swell - 1));
      } else {
        stroke.width *= swell;
      }
    }
    if (bold) {
      if (bank.paint === 'fill') stroke.width += penWidth * BOLD_OUTLINE;
      else stroke.width *= BOLD_STROKE;
    }
    if (bank.paint === 'fill' && stroke.width > 0) stroke.mode = 'both';
    return stroke;
  };

  /** A hand-drawn line: nearly straight, slightly bowed, never ruler-perfect. */
  const drawnLine = (x0: number, y0: number, x1: number, y1: number): InkStroke => {
    const length = Math.hypot(x1 - x0, y1 - y0);
    // Sideways drift, perpendicular to the line.
    const nx = length > 0 ? -(y1 - y0) / length : 0;
    const ny = length > 0 ? (x1 - x0) / length : 1;
    const drift = (): number => markRng.float(-1, 1) * xHeight * 0.12;
    // A long line is drawn in several sweeps of the hand, each a little off the last.
    const sweeps = Math.max(1, Math.round(length / 22));
    const points = Array.from({ length: sweeps * 2 + 1 }, (_, i) => {
      const t = i / (sweeps * 2);
      const d = drift() * (i % 2 === 1 ? 2 : 1);
      return { x: x0 + (x1 - x0) * t + nx * d, y: y0 + (y1 - y0) * t + ny * d };
    });
    const path: PathCommand[] = [{ type: 'M', ...points[0]! }];
    for (let i = 1; i < points.length; i += 2) {
      path.push({ type: 'Q', x1: points[i]!.x, y1: points[i]!.y, ...points[i + 1]! });
    }
    return { char: '', mode: 'stroke', width: penWidth, path };
  };

  const writeLine = (tokens: readonly Token[], spec: LineSpec): number => {
    const size = spec.scale ?? 1;
    const lineStyle = styler.line(spec.lineIndex);
    const startX = spec.left + lineStyle.offsetX;

    const slots: Slot[] = [];
    for (const [tokenIndex, token] of tokens.entries()) {
      let prev = '';
      const chars = [...token.text];
      for (let i = 0; i < chars.length; i++) {
        const charIndex = i;
        let char = chars[i]!;
        const pair = char + (chars[i + 1] ?? '');
        const retraced = token.retrace === i || token.retrace === i + 1;
        if (!retraced && bigrams?.has(pair) && bigramRng.next() < bigramRate) {
          char = pair;
          i++;
          report.bigramCount++;
        }
        const glyph = picker.pick(char);
        const style = styler.glyph(char);
        const isWordStart = prev === '';
        const gapBefore = isWordStart
          ? slots.length > 0
            ? spaceWidth * size * styler.wordGap()
            : 0
          : styler.letterGap(prev, char[0]!) * size;
        if (!glyph) report.unknownChars[char] = (report.unknownChars[char] ?? 0) + 1;
        const advance = glyph ? glyph.advance * unit * size * style.scale : spaceWidth * size;
        slots.push({
          glyph,
          style,
          gapBefore,
          isWordStart,
          advance,
          bold: token.bold ?? false,
          italic: token.italic ?? false,
          token: tokenIndex,
          charIndex,
        });
        prev = char.at(-1)!;
      }
    }

    // Like a writer running out of room, tighten the word gaps before crossing the margin.
    const natural = slots.reduce((sum, s) => sum + s.gapBefore + s.advance, 0);
    const wordGaps = slots.reduce((sum, s) => sum + (s.isWordStart ? s.gapBefore : 0), 0);
    const overflow = startX + natural - spec.right;
    const squeeze =
      overflow > 0 && wordGaps > 0 ? Math.max(MIN_GAP_SQUEEZE, 1 - overflow / wordGaps) : 1;

    const baselineAt = (x: number): number =>
      spec.baseline + lineStyle.baselineShift(x) + Math.tan(lineStyle.slope) * (x - startX);
    // Where each struck word starts and ends, so it can be crossed out afterwards.
    const spans = new Map<number, { from: number; to: number }>();

    let pen = startX;
    for (const slot of slots) {
      pen += slot.isWordStart ? slot.gapBefore * squeeze : slot.gapBefore;
      const token = tokens[slot.token]!;
      if (token.struck) {
        const span = spans.get(slot.token);
        if (span) span.to = pen + slot.advance;
        else spans.set(slot.token, { from: pen, to: pen + slot.advance });
      }
      if (slot.glyph) {
        const { style } = slot;
        const scale = unit * size * style.scale;
        const tanSlant = Math.tan(style.slant + (slot.italic ? ITALIC_LEAN : 0));
        const angle = style.rotation + lineStyle.slope;
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);
        const originX = pen;
        const originY = baselineAt(pen);

        const place = (glyph: Glyph, dx: number, dy: number): PathCommand[] =>
          transformPath(glyph.path, (gx, gy) => {
            const [wx, wy] = style.warp ? style.warp(gx, gy) : [gx, gy];
            const x = (wx - wy * tanSlant) * scale;
            const y = wy * scale;
            return [originX + dx + x * cos - y * sin, originY + dy + x * sin + y * cos];
          });
        const stroke = inked(
          slot.glyph.char,
          place(slot.glyph, 0, 0),
          style.strokeScale,
          slot.bold,
        );
        if (token.struck) stroke.struck = true;
        strokes.push(stroke);
        report.glyphCount++;

        if (token.retrace === slot.charIndex && slot.glyph.char.length === 1) {
          // Gone over again, a fraction of a millimetre off: another try at the same letter.
          const again = picker.pick(slot.glyph.char) ?? slot.glyph;
          const offset = (): number => markRng.float(-1, 1) * xHeight * 0.07;
          const second = inked(
            again.char,
            place(again, offset(), offset()),
            style.strokeScale,
            slot.bold,
          );
          second.retrace = true;
          strokes.push(second);
        }
      }
      pen += slot.advance;
    }

    for (const { from, to } of spans.values()) {
      // Through the middle of the small letters, a little past both ends.
      const lift = xHeight * size * 0.5;
      const overshoot = xHeight * 0.25;
      const passes = markRng.next() < 0.35 ? 2 : 1;
      for (let i = 0; i < passes; i++) {
        const line = drawnLine(
          from - overshoot,
          baselineAt(from) - lift,
          to + overshoot,
          baselineAt(to) - lift,
        );
        line.struck = true;
        strokes.push(line);
      }
    }
    return pen;
  };

  const drawLine = (x0: number, y0: number, x1: number, y1: number): void => {
    strokes.push(drawnLine(x0, y0, x1, y1));
  };
  return { writeLine, drawLine, measure, spaceWidth, strokes };
}
