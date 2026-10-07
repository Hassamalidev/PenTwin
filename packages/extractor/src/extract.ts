import { serializePath, transformPath, type GlyphMetadata } from '@pentwin/engine';
import { alignToText, type FlaggedWord } from './align';
import { cleanImage } from './clean';
import { reportCoverage, type CoverageReport } from './coverage';
import type { RgbaImage } from './image';
import { normalizeGlyphs, type NormalizedGlyph, type PageMetrics } from './normalize';
import { assessQuality, type QualityReport } from './quality';
import { segmentPage } from './segment';
import { vectorize } from './vectorize';

/** A glyph bank in the engine's format: metadata plus one SVG document per variant. */
export interface ExtractedBank {
  metadata: GlyphMetadata;
  files: Record<string, string>;
}

export interface ExtractionOptions {
  name?: string;
  /** Most variants kept per character. More adds file size for little extra variety. */
  maxVariants?: number;
  /** Skip the photo quality gate (for images already known to be clean). */
  skipQualityGate?: boolean;
}

export interface Extraction {
  quality: QualityReport;
  /** Absent when the photo failed the quality gate or no writing could be matched. */
  bank?: ExtractedBank;
  coverage?: CoverageReport;
  metrics?: PageMetrics;
  /** Words and letter pairs that were left out rather than guessed. */
  flagged: FlaggedWord[];
  /** Size of the bank in bytes (metadata and all SVG files). */
  bankBytes: number;
  /** Milliseconds spent in each stage. */
  timings: Record<string, number>;
}

/** The x-height of every extracted bank, in glyph units. */
export const BANK_X_HEIGHT = 100;
/** Cuts below this are only used when a character would otherwise have under 3 variants. */
const TRUSTED = 0.6;

/** Best variants first; doubtful cuts only fill in where a character is short. */
function chooseVariants(glyphs: NormalizedGlyph[], max: number): Map<string, NormalizedGlyph[]> {
  const byChar = new Map<string, NormalizedGlyph[]>();
  for (const glyph of glyphs) {
    const list = byChar.get(glyph.char);
    if (list) list.push(glyph);
    else byChar.set(glyph.char, [glyph]);
  }
  for (const [char, list] of byChar) {
    list.sort((a, b) => b.confidence - a.confidence);
    const trusted = list.filter((g) => g.confidence >= TRUSTED).slice(0, max);
    byChar.set(char, trusted.length >= 3 ? trusted : list.slice(0, Math.min(max, 3)));
  }
  return byChar;
}

/**
 * Photo of the handwritten copy-paragraph in, personal glyph bank out.
 *
 * Runs entirely on the caller's machine. Nothing is uploaded and no model is involved:
 * the photo is cleaned, cut into letters, matched against the known text and traced.
 */
export function extractGlyphBank(
  photo: RgbaImage,
  expectedText: string,
  options: ExtractionOptions = {},
): Extraction {
  const timings: Record<string, number> = {};
  const timed = <T>(stage: string, run: () => T): T => {
    const start = performance.now();
    const result = run();
    timings[stage] = Math.round(performance.now() - start);
    return result;
  };

  const quality = timed('quality', () => assessQuality(photo));
  if (!quality.ok && !options.skipQualityGate) {
    return { quality, flagged: [], bankBytes: 0, timings };
  }

  const { binary } = timed('clean', () => cleanImage(photo));
  const page = timed('segment', () => segmentPage(binary));
  const alignment = timed('align', () => alignToText(page, binary.width, expectedText));
  const { glyphs, metrics } = timed('normalize', () =>
    normalizeGlyphs(alignment, page, binary.width),
  );
  if (glyphs.length === 0) return { quality, flagged: alignment.flagged, bankBytes: 0, timings };

  const scale = BANK_X_HEIGHT / metrics.xHeight;
  const round = (v: number): number => Math.round(v * scale * 10) / 10;
  const chosen = chooseVariants(glyphs, options.maxVariants ?? 6);

  const metadata: GlyphMetadata = {
    version: 1,
    name: options.name ?? 'my-handwriting',
    xHeight: BANK_X_HEIGHT,
    capHeight: round(metrics.capHeight),
    descender: round(metrics.descender),
    spaceAdvance: round(Math.max(metrics.xHeight * 0.25, metrics.wordGap - metrics.letterGap)),
    paint: 'fill',
    glyphs: {},
  };
  const files: Record<string, string> = {};

  timed('vectorize', () => {
    for (const [char, variants] of chosen) {
      const code = char.codePointAt(0)!.toString(16).padStart(4, '0');
      metadata.glyphs[char] = variants.map((glyph, i) => {
        const file = `u${code}-${i + 1}.svg`;
        const path = transformPath(vectorize(glyph.bitmap), (x, y) => [x * scale, y * scale]);
        const { width, height } = glyph.bitmap;
        files[file] =
          `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${round(width)} ${round(height)}">` +
          `<path d="${serializePath(path, 1)}"/></svg>`;
        return {
          file,
          // The pen always moves forward, even for a glyph that overlaps both neighbours.
          advance: Math.max(round(width) * 0.2, round(glyph.lsb + width + glyph.rsb)),
          lsb: round(glyph.lsb),
          rsb: round(glyph.rsb),
          baseline: round(glyph.baseline),
        };
      });
    }
  });

  const confidences = new Map(
    [...chosen].map(([char, variants]) => [char, variants.map((g) => g.confidence)]),
  );
  const bankBytes =
    JSON.stringify(metadata).length +
    Object.values(files).reduce((sum, svg) => sum + svg.length, 0);

  return {
    quality,
    bank: { metadata, files },
    coverage: reportCoverage(confidences),
    metrics,
    flagged: alignment.flagged,
    bankBytes,
    timings,
  };
}
