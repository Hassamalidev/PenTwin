/** Renders a text file to PNG pages for a quick visual check: tsx scripts/preview.ts <text> <out-prefix> */
import { readFileSync, writeFileSync } from 'node:fs';
import { renderText } from '../packages/engine/src/index';
import { loadGlyphBank, sceneToPng } from '../packages/engine/src/node/index';

const [textFile = 'tests/sample.txt', out = 'preview'] = process.argv.slice(2);
const { bank } = loadGlyphBank('tests/fixtures/glyphs/sample-user');
const { pages, report } = renderText(readFileSync(textFile, 'utf8'), bank, {
  seed: 'preview',
  pageSize: 'A5',
});
pages.forEach((page, i) => writeFileSync(`${out}-${i + 1}.png`, sceneToPng(page, 110)));
console.log(report);
