export type Ruling = 'narrow' | 'college' | 'wide';

export interface PaperSpec {
  kind: 'plain' | 'ruled' | 'graph' | 'dotted';
  /** Line spacing for ruled paper. Defaults to `college`. */
  ruling?: Ruling;
  /** Draws a vertical margin line; the text then starts to the right of it. */
  marginLine?: boolean;
}

/** One stroked path of the printed pattern, in page coordinates (mm). */
export interface PaperLayer {
  d: string;
  color: string;
  width: number;
}

export interface Paper {
  background: string;
  layers: PaperLayer[];
  /** Set when the paper has lines to write on: the text must use this line spacing. */
  lineHeight?: number;
  /** Baseline of the first line of writing. */
  firstBaseline?: number;
  /** Text may not start left of this (the margin line plus a small gap). */
  minLeft?: number;
  /**
   * How freely the writing may wander, as a multiplier on baseline drift and line slope.
   * Printed lines give the hand something to follow, so it strays much less than on
   * plain paper.
   */
  driftScale: number;
}

/** Standard ruling spacings in mm. */
export const RULING_SPACING: Record<Ruling, number> = { narrow: 6.4, college: 7.1, wide: 8.7 };

const RULE_COLOR = '#a9c1e0';
const MARGIN_COLOR = '#e59aa0';
const GRID_COLOR = '#c6d5e8';
const DOT_COLOR = '#aab4c2';
const GRID_STEP = 5;
/** Height left blank above the first rule. */
const HEADER = 30;
/** Rules stop this far above the bottom edge. */
const FOOTER = 12;
/** Writing rests a touch above the printed line, not exactly on it. */
const HOVER = 0.2;

const n = (v: number): string => String(Math.round(v * 100) / 100);

export function createPaper(spec: PaperSpec, width: number, height: number): Paper {
  const paper: Paper = { background: '#ffffff', layers: [], driftScale: 1 };

  if (spec.kind === 'ruled') {
    const spacing = RULING_SPACING[spec.ruling ?? 'college'];
    let d = '';
    for (let y = HEADER; y <= height - FOOTER; y += spacing) d += `M0 ${n(y)}H${n(width)}`;
    paper.layers.push({ d, color: RULE_COLOR, width: 0.2 });
    paper.lineHeight = spacing;
    paper.firstBaseline = HEADER - HOVER;
    paper.driftScale = 0.4;
  }

  if (spec.kind === 'graph') {
    let d = '';
    for (let y = GRID_STEP; y < height; y += GRID_STEP) d += `M0 ${n(y)}H${n(width)}`;
    for (let x = GRID_STEP; x < width; x += GRID_STEP) d += `M${n(x)} 0V${n(height)}`;
    paper.layers.push({ d, color: GRID_COLOR, width: 0.15 });
  }

  if (spec.kind === 'dotted') {
    // Each dot is a tiny round-capped stroke, so the whole grid is a single path.
    let d = '';
    for (let y = GRID_STEP; y < height; y += GRID_STEP) {
      for (let x = GRID_STEP; x < width; x += GRID_STEP) d += `M${n(x)} ${n(y)}h0.01`;
    }
    paper.layers.push({ d, color: DOT_COLOR, width: 0.45 });
  }

  if (spec.kind === 'graph' || spec.kind === 'dotted') {
    // One line of writing every two grid rows.
    paper.lineHeight = GRID_STEP * 2;
    paper.firstBaseline = HEADER - HOVER;
    paper.driftScale = spec.kind === 'graph' ? 0.4 : 0.6;
  }

  if (spec.marginLine) {
    const x = Math.round(width * 0.15);
    paper.layers.push({ d: `M${x} 0V${n(height)}`, color: MARGIN_COLOR, width: 0.3 });
    paper.minLeft = x + 3;
  }

  return paper;
}
