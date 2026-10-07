/**
 * End-to-end demo of the extractor on a synthetic sample photo: extracts a glyph bank,
 * then writes a page with it to docs/samples/extracted-bank.png.
 *
 *   pnpm extract:demo
 */
import { writeFileSync } from 'node:fs';
import { buildGlyphBank, PRESETS, renderText } from '../packages/engine/src/index';
import { sceneToPng } from '../packages/engine/src/node/index';
import { extractGlyphBank } from '../packages/extractor/src/extract';
import {
  CONDITIONS,
  degrade,
  renderSamplePage,
  SAMPLE_TEXT,
  toRgba,
} from '../packages/extractor/src/testing';

const photo = degrade(renderSamplePage().gray, { ...CONDITIONS.shadowed, rotate: 2.5 });
const result = extractGlyphBank(toRgba(photo), SAMPLE_TEXT);
if (!result.bank || !result.coverage || !result.metrics) {
  console.error('Extraction failed:', result.quality.issues);
  process.exit(1);
}

const { coverage, metrics } = result;
console.log(`Photo: ${photo.width} x ${photo.height} px, shadowed and rotated 2.5 degrees`);
console.log(`Timings (ms): ${JSON.stringify(result.timings)}`);
console.log(`Bank size: ${(result.bankBytes / 1024).toFixed(0)} KB`);
console.log(
  `Coverage: ${coverage.strong.length} strong, ${coverage.weak.length} weak (${coverage.weak.join(' ')}), ` +
    `${coverage.missing.length} missing (${coverage.missing.join(' ')})`,
);
console.log(
  `Metrics (px): x-height ${metrics.xHeight.toFixed(1)}, cap ${metrics.capHeight.toFixed(1)}, ` +
    `descender ${metrics.descender.toFixed(1)}, stroke ${metrics.strokeWidth.toFixed(1)}`,
);
console.log(`Left out: ${result.flagged.map((f) => `${f.expected} (${f.reason})`).join(', ')}`);

const bank = buildGlyphBank(result.bank.metadata, (file) => result.bank!.files[file]!);
const { pages, report } = renderText(SAMPLE_TEXT, bank, {
  seed: 'extracted',
  pageSize: 'A5',
  jitter: PRESETS.normal,
  paper: { kind: 'ruled', ruling: 'wide' },
});
writeFileSync('docs/samples/extracted-bank.png', sceneToPng(pages[0]!, 110));
console.log(
  `docs/samples/extracted-bank.png (unknown characters: ${JSON.stringify(report.unknownChars)})`,
);
