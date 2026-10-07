import { fileURLToPath } from 'node:url';
import { loadGlyphBank } from './node/load';

/** Paths and fixtures shared by the engine's tests. */
export const repoPath = (relative: string): string =>
  fileURLToPath(new URL(`../../../${relative}`, import.meta.url));

export const SAMPLE_GLYPHS_DIR = repoPath('tests/fixtures/glyphs/sample-user');

export const loadSampleBank = () => loadGlyphBank(SAMPLE_GLYPHS_DIR).bank;
