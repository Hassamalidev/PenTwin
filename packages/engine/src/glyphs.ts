import type { Rng } from '@pentwin/shared';
import { z } from 'zod';
import { parsePath, transformPath, type PathCommand } from './path';

/**
 * Glyph set metadata (`metadata.json`).
 *
 * Each variant is one SVG file whose viewBox is tight around the ink: x = 0 is the ink's
 * left edge and `baseline` is the y coordinate of the writing baseline in that file.
 * The ink is drawn `lsb` to the right of the pen, and the pen then moves on by `advance`.
 * All lengths are in glyph units; `xHeight` sets how those units map to millimetres.
 */
const variantSchema = z.object({
  file: z.string().min(1),
  advance: z.number().positive(),
  lsb: z.number(),
  rsb: z.number(),
  baseline: z.number(),
  /**
   * Set when this variant was not written by the user but made from other glyphs, e.g.
   * "scaled from c". Derived glyphs must always be marked so they can be shown as such.
   */
  derivedFrom: z.string().optional(),
});

export const glyphMetadataSchema = z.object({
  version: z.literal(1),
  name: z.string().min(1),
  xHeight: z.number().positive(),
  capHeight: z.number().positive(),
  descender: z.number().nonnegative(),
  /** Advance of a space between words. */
  spaceAdvance: z.number().positive(),
  /** `stroke`: paths are pen centre-lines. `fill`: paths are filled outlines. */
  paint: z.enum(['stroke', 'fill']),
  glyphs: z.record(
    z.string().refine((key) => [...key].length === 1, 'Glyph keys must be a single character'),
    z.array(variantSchema).min(1),
  ),
  /**
   * Letter pairs written as one glyph ("th", "er"), keyed by the two characters. Optional.
   * A pair keeps the spacing, overlap and joining stroke the writer really used, which
   * two separate letters placed side by side cannot.
   */
  bigrams: z
    .record(
      z.string().refine((key) => [...key].length === 2, 'Bigram keys must be two characters'),
      z.array(variantSchema).min(1),
    )
    .optional(),
});

export type GlyphMetadata = z.infer<typeof glyphMetadataSchema>;

export interface Glyph {
  char: string;
  variant: number;
  /** Pen-relative path: x = 0 at the pen, y = 0 on the baseline, y grows downward. */
  path: PathCommand[];
  advance: number;
  lsb: number;
  rsb: number;
  /** Present when the glyph was derived from other glyphs instead of written by the user. */
  derivedFrom?: string;
}

export interface GlyphBank {
  name: string;
  xHeight: number;
  capHeight: number;
  descender: number;
  spaceAdvance: number;
  paint: 'stroke' | 'fill';
  glyphs: ReadonlyMap<string, readonly Glyph[]>;
  /** Letter pairs available as a single glyph, keyed by the two characters. */
  bigrams?: ReadonlyMap<string, readonly Glyph[]>;
}

const range = (from: string, to: string): string[] =>
  Array.from({ length: to.charCodeAt(0) - from.charCodeAt(0) + 1 }, (_, i) =>
    String.fromCharCode(from.charCodeAt(0) + i),
  );

/** Characters a bank needs before it can render ordinary English text. */
export const REQUIRED_CHARS: readonly string[] = [
  ...range('a', 'z'),
  ...range('A', 'Z'),
  ...range('0', '9'),
  ...'.,;:!?\'"-()/&$%+=@#*',
];

const PATH_D = /<path\b[^>]*?\sd="([^"]*)"/g;

/** Validates metadata and assembles a bank. `readSvg` returns the SVG source for a file name. */
export function buildGlyphBank(metadata: unknown, readSvg: (file: string) => string): GlyphBank {
  const meta = glyphMetadataSchema.parse(metadata);
  const load = (entries: GlyphMetadata['glyphs']): Map<string, Glyph[]> =>
    new Map(
      Object.entries(entries).map(([char, variants]) => [
        char,
        variants.map((v, variant): Glyph => {
          const d = [...readSvg(v.file).matchAll(PATH_D)].map((m) => m[1]).join(' ');
          if (!d.trim()) throw new Error(`No path data in ${v.file} (glyph "${char}")`);
          const path = transformPath(parsePath(d), (x, y) => [x + v.lsb, y - v.baseline]);
          return {
            char,
            variant,
            path,
            advance: v.advance,
            lsb: v.lsb,
            rsb: v.rsb,
            ...(v.derivedFrom ? { derivedFrom: v.derivedFrom } : {}),
          };
        }),
      ]),
    );
  const glyphs = load(meta.glyphs);

  return {
    name: meta.name,
    xHeight: meta.xHeight,
    capHeight: meta.capHeight,
    descender: meta.descender,
    spaceAdvance: meta.spaceAdvance,
    paint: meta.paint,
    glyphs,
    ...(meta.bigrams ? { bigrams: load(meta.bigrams) } : {}),
  };
}

export interface CoverageReport {
  /** Required characters with no glyph at all. */
  missing: string[];
  /** Required characters with fewer than `minVariants` variants. */
  weak: string[];
}

export function checkCoverage(
  bank: GlyphBank,
  minVariants = 3,
  required: readonly string[] = REQUIRED_CHARS,
): CoverageReport {
  const report: CoverageReport = { missing: [], weak: [] };
  for (const char of required) {
    const count = bank.glyphs.get(char)?.length ?? 0;
    if (count === 0) report.missing.push(char);
    else if (count < minVariants) report.weak.push(char);
  }
  return report;
}

export interface VariantPicker {
  /** Returns a glyph for a character or letter pair, or undefined when the bank has none. */
  pick(key: string): Glyph | undefined;
}

/**
 * Picks variants so the same one is never used twice in a row for a character, and is not
 * reused within the last `avoidWindow` picks when the bank has enough variants to allow it.
 * With three or more variants there are always at least two candidates, so the sequence
 * never settles into a fixed cycle.
 */
export function createVariantPicker(bank: GlyphBank, rng: Rng, avoidWindow = 2): VariantPicker {
  const recent = new Map<string, number[]>();

  return {
    pick(char) {
      const variants = bank.glyphs.get(char) ?? bank.bigrams?.get(char);
      if (!variants || variants.length === 0) return undefined;
      if (variants.length === 1) return variants[0];

      const history = recent.get(char) ?? [];
      const blocked = history.slice(-Math.max(1, Math.min(avoidWindow, variants.length - 2)));
      const glyph = rng.pick(variants.filter((v) => !blocked.includes(v.variant)));

      history.push(glyph.variant);
      if (history.length > avoidWindow) history.shift();
      recent.set(char, history);
      return glyph;
    },
  };
}
