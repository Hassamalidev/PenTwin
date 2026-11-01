import type { NormalizedGlyph } from './normalize';

/**
 * Lets a writer's letters check each other. Labels come from matching marks to the known
 * text, and in joined writing that can slide by a letter, or give one label to a whole word.
 * A wrong cut is usually unlike the other samples of its label, and often more like some
 * other letter. Nothing here comes from outside: each writer is the reference for themselves.
 */
const SIZE = 20;
/** Samples of a letter needed before it can vouch for anything. */
const MIN_SAMPLES = 3;
/** How many of the nearest samples count: a letter can have two or three written forms. */
const NEAREST = 3;
/** Below this, a cut is unlike its own letter whatever else it resembles. */
const MIN_LIKENESS = 0.3;
/** How much more a cut may resemble another letter before it is taken to be mislabelled. */
const RIVAL_MARGIN = 0.02;
/** Widths outside this share of a letter's usual width are not that letter. */
const MAX_WIDTH = 1.45;
const MIN_WIDTH = 0.4;

/** A cut reduced to a small, even grid of ink, so shapes of any size can be compared. */
function signature(glyph: NormalizedGlyph, from = 0, to = glyph.bitmap.width): Float32Array {
  const { height, data } = glyph.bitmap;
  const stride = glyph.bitmap.width;
  const width = Math.max(1, to - from);
  const grid = new Float32Array(SIZE * SIZE);
  for (let y = 0; y < height; y++) {
    const row = Math.min(SIZE - 1, Math.floor((y / height) * SIZE));
    for (let x = 0; x < width; x++) {
      if (data[y * stride + x + from])
        grid[row * SIZE + Math.min(SIZE - 1, Math.floor((x / width) * SIZE))]! += 1;
    }
  }
  // A pen line is thin: spread each cell a little, so a stroke a pixel away still matches.
  const soft = new Float32Array(SIZE * SIZE);
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      let sum = 0;
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          const nr = r + dr;
          const nc = c + dc;
          if (nr >= 0 && nc >= 0 && nr < SIZE && nc < SIZE) sum += grid[nr * SIZE + nc]!;
        }
      }
      soft[r * SIZE + c] = sum;
    }
  }
  const mean = soft.reduce((sum, v) => sum + v, 0) / soft.length;
  let length = 0;
  for (let i = 0; i < soft.length; i++) {
    soft[i]! -= mean;
    length += soft[i]! * soft[i]!;
  }
  const norm = Math.sqrt(length) || 1;
  for (let i = 0; i < soft.length; i++) soft[i]! /= norm;
  return soft;
}

const likeness = (a: Float32Array, b: Float32Array): number => {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += a[i]! * b[i]!;
  return sum;
};

const nearest = (scores: number[]): number => {
  const top = scores.sort((a, b) => b - a).slice(0, NEAREST);
  return top.reduce((sum, v) => sum + v, 0) / Math.max(1, top.length);
};

const median = (values: number[]): number =>
  [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)] ?? 0;

/** A pair or word has to look like its letters, slice by slice, or it is not that word. */
const MIN_SHAPE_LIKENESS = 0.35;
/** Joined letters overlap a little, but not by this much. */
const MIN_SHAPE_WIDTH = 0.75;
/** Wider than this and a pair or word holds more than its own letters. */
const MAX_SHAPE_WIDTH = 1.3;

/** Rough width of a letter within a word, for slicing a joined shape along its letters. */
const share = (char: string): number =>
  !/[a-zA-Z0-9]/.test(char) ? 0.3 : 'iljtfr'.includes(char) ? 0.55 : 'mw'.includes(char) ? 1.4 : 1;

function shapeMatchesLetters(
  shape: NormalizedGlyph,
  signaturesOf: (char: string) => Float32Array[],
): boolean {
  const chars = [...shape.char];
  const total = chars.reduce((sum, c) => sum + share(c), 0);
  let at = 0;
  let sum = 0;
  let judged = 0;
  for (const char of chars) {
    const width = (share(char) / total) * shape.bitmap.width;
    const samples = signaturesOf(char);
    if (samples.length > 0) {
      const slice = signature(shape, Math.round(at), Math.round(at + width));
      sum += nearest(samples.map((sample) => likeness(slice, sample)));
      judged++;
    }
    at += width;
  }
  // Nothing to compare with is no evidence either way: such shapes stay out.
  return judged >= Math.ceil(chars.length * 0.5) && sum / judged >= MIN_SHAPE_LIKENESS;
}

/**
 * The writer's own letters as a reference: how unlike a cut is to a letter, 0 to 1. Letters
 * with no trusted samples cost a middling amount, so they neither help nor rule anything out.
 */
export function letterTemplates(
  glyphs: readonly NormalizedGlyph[],
): (bitmap: NormalizedGlyph['bitmap'], char: string) => number {
  const samples = new Map<string, Float32Array[]>();
  for (const glyph of glyphs) {
    if (glyph.char.length !== 1) continue;
    samples.set(glyph.char, [...(samples.get(glyph.char) ?? []), signature(glyph)]);
  }
  return (bitmap, char) => {
    const list = samples.get(char);
    if (!list || list.length < 2) return 0.5;
    const cut = signature({ bitmap } as NormalizedGlyph);
    return Math.max(0, Math.min(1, 1 - nearest(list.map((sample) => likeness(cut, sample)))));
  };
}

export interface Verification {
  /**
   * Share of the kept letters that look most like their own label among the writer's other
   * letters, 0 to 1. Needs no answer key, so it can be measured on any real page.
   */
  consistency: number;
  kept: NormalizedGlyph[];
  /** Cuts the writer's other letters did not support. */
  refused: NormalizedGlyph[];
}

/**
 * Keeps the cuts a writer's other letters agree with, most typical first. Pairs, whole words
 * and letters with too few samples to judge are passed through unchanged.
 */
export function verifyGlyphs(glyphs: readonly NormalizedGlyph[], xHeight: number): Verification {
  // A full stop or comma the size of a letter is a letter, whatever its label says.
  const oversized = (g: NormalizedGlyph): boolean =>
    (g.char === '.' || g.char === ',') &&
    Math.max(g.bitmap.width, g.bitmap.height) > xHeight * 0.75;
  const singles = glyphs.filter((g) => g.char.length === 1 && /[a-zA-Z0-9]/.test(g.char));
  let alive = new Set(singles);
  const signatures = new Map(singles.map((g) => [g, signature(g)]));
  const typical = new Map<NormalizedGlyph, number>();

  // Twice: once the worst cuts are gone, the rest are judged against better company.
  for (let round = 0; round < 2; round++) {
    const byChar = new Map<string, NormalizedGlyph[]>();
    for (const glyph of alive) byChar.set(glyph.char, [...(byChar.get(glyph.char) ?? []), glyph]);
    const widths = new Map(
      [...byChar].map(([char, list]) => [char, median(list.map((g) => g.bitmap.width))]),
    );
    const next = new Set<NormalizedGlyph>();
    const standing = new Map<NormalizedGlyph, number>();
    for (const glyph of alive) {
      const own = byChar.get(glyph.char)!;
      if (own.length < MIN_SAMPLES) {
        next.add(glyph);
        continue;
      }
      const width = glyph.bitmap.width / Math.max(1, widths.get(glyph.char)!);
      if (width > MAX_WIDTH || width < MIN_WIDTH) continue;
      const mine = signatures.get(glyph)!;
      const self = nearest(
        own.filter((g) => g !== glyph).map((g) => likeness(mine, signatures.get(g)!)),
      );
      let rival = -1;
      for (const [char, list] of byChar) {
        if (char === glyph.char || list.length < MIN_SAMPLES) continue;
        rival = Math.max(rival, nearest(list.map((g) => likeness(mine, signatures.get(g)!))));
      }
      standing.set(glyph, self - Math.max(0, rival));
      typical.set(glyph, self);
      if (self < MIN_LIKENESS || rival > self + RIVAL_MARGIN) continue;
      next.add(glyph);
    }
    // Look-alikes (e and c, n and u) can refuse each other. A letter with samples of its own
    // keeps its strongest few rather than vanish from the bank: a gap is worse than a doubt.
    for (const list of byChar.values()) {
      if (list.length < MIN_SAMPLES || list.filter((g) => next.has(g)).length >= MIN_SAMPLES)
        continue;
      const strongest = list
        .filter((g) => standing.has(g))
        .sort((a, b) => standing.get(b)! - standing.get(a)!)
        .slice(0, MIN_SAMPLES);
      for (const glyph of strongest) next.add(glyph);
    }
    alive = next;
  }

  const proven = (char: string): Float32Array[] =>
    [...alive]
      .filter((g) => g.char === char || g.char === char.toLowerCase())
      .map((g) => signatures.get(g)!);
  /** A pair or word must be about as wide as its letters, or some of them are not in it. */
  const wrongWidth = (shape: NormalizedGlyph): boolean => {
    const usual = [...shape.char].map((char) => {
      const widths = [...alive].filter((g) => g.char === char).map((g) => g.bitmap.width);
      if (widths.length) return median(widths);
      return /[a-zA-Z0-9]/.test(char) ? xHeight * 0.7 : xHeight * 0.2;
    });
    const together = usual.reduce((sum, w) => sum + w, 0);
    return (
      shape.bitmap.width < together * MIN_SHAPE_WIDTH ||
      shape.bitmap.width > together * MAX_SHAPE_WIDTH
    );
  };
  const kept: NormalizedGlyph[] = [];
  const refused: NormalizedGlyph[] = [];
  for (const glyph of glyphs) {
    if (oversized(glyph)) refused.push(glyph);
    else if (glyph.char.length > 1 && (wrongWidth(glyph) || !shapeMatchesLetters(glyph, proven))) {
      refused.push(glyph);
    } else if (!signatures.has(glyph)) kept.push(glyph);
    else if (alive.has(glyph)) {
      const self = typical.get(glyph);
      // Typical cuts of a letter are used first.
      kept.push(self === undefined ? glyph : { ...glyph, typicality: self });
    } else refused.push(glyph);
  }
  // Each kept letter against every other letter: is its nearest company its own label?
  const survivors = [...alive].filter((g) => signatures.has(g));
  const classes = new Map<string, Float32Array[]>();
  for (const g of survivors) {
    classes.set(g.char, [...(classes.get(g.char) ?? []), signatures.get(g)!]);
  }
  let right = 0;
  let judged = 0;
  for (const glyph of survivors) {
    const mine = signatures.get(glyph)!;
    const own = classes.get(glyph.char)!.filter((s) => s !== mine);
    if (own.length < 2) continue;
    const self = nearest(own.map((s) => likeness(mine, s)));
    let best = -1;
    for (const [char, list] of classes) {
      if (char !== glyph.char && list.length >= 2) {
        best = Math.max(best, nearest(list.map((s) => likeness(mine, s))));
      }
    }
    judged++;
    if (self >= best) right++;
  }
  return { kept, refused, consistency: judged ? right / judged : 1 };
}
