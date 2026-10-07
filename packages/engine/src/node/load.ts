import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildGlyphBank, checkCoverage, type CoverageReport, type GlyphBank } from '../glyphs';

/** Loads a glyph set directory (`metadata.json` plus the SVG files it references). */
export function loadGlyphBank(dir: string): { bank: GlyphBank; coverage: CoverageReport } {
  const metadata: unknown = JSON.parse(readFileSync(join(dir, 'metadata.json'), 'utf8'));
  const bank = buildGlyphBank(metadata, (file) => readFileSync(join(dir, file), 'utf8'));
  return { bank, coverage: checkCoverage(bank) };
}
