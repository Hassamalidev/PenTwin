/**
 * Writes the printable handwriting sample sheet to docs/sample-sheet.pdf.
 *
 *   pnpm sample:sheet
 */
import { readFileSync, writeFileSync } from 'node:fs';
import type { SampleText } from '../packages/extractor/src/sample-text';
import { buildSampleSheet } from '../packages/extractor/src/sheet';

const sample = JSON.parse(readFileSync('docs/sample-text.json', 'utf8')) as SampleText;
writeFileSync('docs/sample-sheet.pdf', await buildSampleSheet(sample));
console.log('docs/sample-sheet.pdf');
