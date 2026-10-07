import { serializePath, transformPath, type GlyphMetadata } from '@pentwin/engine';
import { alignToText, type FlaggedWord } from './align';
import { cleanImage } from './clean';
import { reportCoverage, type CoverageReport } from './coverage';
import type { RgbaImage } from './image';
import { normalizeGlyphs, type NormalizedGlyph, type PageMetrics } from './normalize';
import { assessQuality, type QualityReport } from './quality';
import { segmentPage } from './segment';
import { measureStyle, type StyleFeatures } from './style';
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
  /** The page is expected to hold very little writing (a top-up sheet). */
  sparse?: boolean;
}

export interface Extraction {
  quality: QualityReport;
  /** Absent when the photo failed the quality gate or no writing could be matched. */
  bank?: ExtractedBank;
  coverage?: CoverageReport;
  /** Letter pairs captured as single glyphs, e.g. "th". */
  bigrams: string[];
  metrics?: PageMetrics;
  /** The writer's style, to be stored with the profile. */
  style?: StyleFeatures;
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
/** Common English letter pairs worth keeping as a unit when both letters were cut cleanly. */
const COMMON_PAIRS = new Set(
  'th he in er an re on at en nd ti es or te of ed is it al ar st to nt ng ou ch ll ee oo'.split(
    ' ',
  ),
);
const MAX_PAIR_VARIANTS = 3;

/** Two neighbouring glyphs as one, exactly as they sat next to each other on the page. */
function joinPair(a: NormalizedGlyph, b: NormalizedGlyph): NormalizedGlyph {
  const x = Math.min(a.bitmap.x, b.bitmap.x);
  const y = Math.min(a.bitmap.y, b.bitmap.y);
  const width = Math.max(a.bitmap.x + a.bitmap.width, b.bitmap.x + b.bitmap.width) - x;
  const height = Math.max(a.bitmap.y + a.bitmap.height, b.bitmap.y + b.bitmap.height) - y;
  const data = new Uint8Array(width * height);
  for (const { bitmap } of [a, b]) {
    for (let row = 0; row < bitmap.height; row++) {
      for (let col = 0; col < bitmap.width; col++) {
        if (bitmap.data[row * bitmap.width + col]) {
          data[(row + bitmap.y - y) * width + col + bitmap.x - x] = 1;
        }
      }
    }
  }
  return {
    char: a.char + b.char,
    confidence: Math.min(a.confidence, b.confidence),
    cut: 'merged',
    line: a.line,
    word: a.word,
    bitmap: { width, height, data, x, y },
    baseline: (a.bitmap.y + a.baseline + b.bitmap.y + b.baseline) / 2 - y,
    lsb: a.lsb,
    rsb: b.rsb,
  };
}

/**
 * Collects the letter pairs to keep as single glyphs: pairs the writer joined together,
 * and common pairs whose two letters were both cut cleanly.
 */
function collectPairs(glyphs: NormalizedGlyph[]): Map<string, NormalizedGlyph[]> {
  const pairs = glyphs.filter((g) => g.char.length === 2);
  const singles = glyphs
    .filter((g) => g.char.length === 1)
    .sort((a, b) => a.line - b.line || a.bitmap.x - b.bitmap.x);
  for (let i = 1; i < singles.length; i++) {
    const a = singles[i - 1]!;
    const b = singles[i]!;
    const clean =
      a.cut === 'clean' && b.cut === 'clean' && Math.min(a.confidence, b.confidence) >= 0.8;
    if (clean && a.line === b.line && a.word === b.word && COMMON_PAIRS.has(a.char + b.char)) {
      pairs.push(joinPair(a, b));
    }
  }
  const byPair = new Map<string, NormalizedGlyph[]>();
  for (const pair of pairs.sort((a, b) => b.confidence - a.confidence)) {
    const list = byPair.get(pair.char) ?? [];
    if (list.length < MAX_PAIR_VARIANTS) byPair.set(pair.char, [...list, pair]);
  }
  return byPair;
}

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
  // A top-up sheet holds only a few characters, so "no writing found" does not apply to it.
  const blocking = quality.issues.filter(
    (issue) => !(options.sparse && issue.code === 'no-writing'),
  );
  if (blocking.length > 0 && !options.skipQualityGate) {
    return { quality, flagged: [], bigrams: [], bankBytes: 0, timings };
  }

  const { binary } = timed('clean', () => cleanImage(photo));
  const page = timed('segment', () => segmentPage(binary));
  const alignment = timed('align', () => alignToText(page, binary.width, expectedText));
  const { glyphs, metrics } = timed('normalize', () =>
    normalizeGlyphs(alignment, page, binary.width),
  );
  if (glyphs.length === 0) {
    return { quality, flagged: alignment.flagged, bigrams: [], bankBytes: 0, timings };
  }
  const singles = glyphs.filter((g) => g.char.length === 1);

  const scale = BANK_X_HEIGHT / metrics.xHeight;
  const round = (v: number): number => Math.round(v * scale * 10) / 10;
  const chosen = chooseVariants(singles, options.maxVariants ?? 6);
  const pairs = collectPairs(glyphs);

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

  /** Traces the variants of one glyph (or letter pair) into SVG files and bank entries. */
  const trace = (key: string, variants: NormalizedGlyph[]) => {
    const code = [...key].map((c) => c.codePointAt(0)!.toString(16).padStart(4, '0')).join('_');
    return variants.map((glyph, i) => {
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
  };
  timed('vectorize', () => {
    for (const [char, variants] of chosen) metadata.glyphs[char] = trace(char, variants);
    if (pairs.size > 0) {
      metadata.bigrams = Object.fromEntries(
        [...pairs].map(([pair, variants]) => [pair, trace(pair, variants)]),
      );
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
    bigrams: [...pairs.keys()].sort(),
    style: measureStyle(singles, metrics),
    flagged: alignment.flagged,
    bankBytes,
    timings,
  };
}
