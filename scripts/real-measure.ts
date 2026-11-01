/**
 * Measures real handwriting pages and our own generated pages with the same code.
 *
 *   python -I scripts/to-pgm.py <folder of images> <folder for .pgm files>
 *   pnpm real:measure <folder of .pgm files> [--write]
 *
 * Images are never kept in this repository. With --write, only the summary numbers go to
 * packages/engine/src/real-ranges.json. Real pages are grouped by writer when their file
 * name starts with "wNNNN_".
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  buildGlyphBank,
  presetOptions,
  PRESETS,
  renderText,
  type PresetName,
} from '../packages/engine/src/index';
import { sceneToPixels } from '../packages/engine/src/node/index';
import {
  cleanImage,
  measurePage,
  summarizeMeasures,
  type MeasureName,
  type PageMeasure,
} from '../packages/extractor/src/index';
import { buildDemoHand } from './demo-hand';

/** Reads a binary PGM (P5): the simplest image file there is. */
export function readPgm(path: string): { width: number; height: number; data: Uint8Array } {
  const bytes = readFileSync(path);
  let at = 0;
  const token = (): string => {
    while (bytes[at] === 32 || bytes[at] === 10 || bytes[at] === 13) at++;
    const start = at;
    while (at < bytes.length && ![32, 10, 13].includes(bytes[at]!)) at++;
    return bytes.toString('latin1', start, at);
  };
  if (token() !== 'P5') throw new Error(`${path} is not a binary PGM`);
  const width = Number(token());
  const height = Number(token());
  token();
  at++;
  return { width, height, data: bytes.subarray(at, at + width * height) };
}

export const measureGray = (image: {
  width: number;
  height: number;
  data: Uint8Array;
}): PageMeasure | undefined => {
  const rgba = new Uint8ClampedArray(image.width * image.height * 4);
  for (let i = 0; i < image.data.length; i++) {
    rgba[i * 4] = rgba[i * 4 + 1] = rgba[i * 4 + 2] = image.data[i]!;
    rgba[i * 4 + 3] = 255;
  }
  const { binary } = cleanImage({ width: image.width, height: image.height, data: rgba });
  return measurePage(binary);
};

const SAMPLE =
  'Within a short time she was walking briskly toward the Emerald City, her silver shoes ' +
  'tinkling merrily on the hard, yellow roadbed. The sun shone bright and the birds sang ' +
  'sweet and Dorothy did not feel nearly as bad as you might think a little girl would who ' +
  'had been suddenly whisked away from her own country and set down in the midst of a ' +
  'strange land.';

const dir = process.argv[2];
if (!dir) throw new Error('Usage: pnpm real:measure <folder of .pgm files> [--write]');
const files = readdirSync(dir).filter((name) => name.endsWith('.pgm'));

const real: PageMeasure[] = [];
const refused: string[] = [];
for (const name of files) {
  const measure = measureGray(readPgm(join(dir, name)));
  if (measure) real.push(measure);
  else refused.push(name);
}
const writers = new Set(files.map((name) => /^(w\d+)_/.exec(name)?.[1] ?? name)).size;
const summary = summarizeMeasures(real);

const hand = buildDemoHand();
const bank = buildGlyphBank(hand.metadata, (file) => hand.files[file]!);
const generated = (Object.keys(PRESETS) as PresetName[]).map((name) => {
  const { pages } = renderText(SAMPLE, bank, {
    seed: 'real-measure',
    pageSize: 'Letter',
    ...presetOptions(name),
    paper: { kind: 'plain' },
    lineHeight: 11,
  });
  const pixels = sceneToPixels({ ...pages[0]!, inkEffects: undefined }, 200);
  const gray = new Uint8Array(pixels.width * pixels.height);
  for (let i = 0; i < gray.length; i++) gray[i] = pixels.data[i * 4 + 1]!;
  return [name, measureGray({ width: pixels.width, height: pixels.height, data: gray })] as const;
});

const names = Object.keys(summary) as MeasureName[];
const cell = (value: number | undefined): string => (value === undefined ? '-' : value.toFixed(3));
console.log(`${real.length} real pages measured, ${writers} writers, ${refused.length} refused`);
console.log(
  `| Measure | Real low | Real middle | Real high | ${generated.map(([n]) => n).join(' | ')} |`,
);
console.log(`| --- | --- | --- | --- | ${generated.map(() => '---').join(' | ')} |`);
for (const name of names) {
  const { low, median, high } = summary[name];
  const marks = generated.map(([, m]) => {
    if (!m) return '-';
    const inside = m[name] >= low && m[name] <= high;
    return `${cell(m[name])}${inside ? '' : ' **out**'}`;
  });
  console.log(
    `| ${name} | ${cell(low)} | ${cell(median)} | ${cell(high)} | ${marks.join(' | ')} |`,
  );
}
if (process.argv.includes('--write')) {
  writeFileSync(
    'packages/engine/src/real-ranges.json',
    `${JSON.stringify({ pages: real.length, writers, ranges: summary }, null, 2)}\n`,
  );
  console.log('packages/engine/src/real-ranges.json');
}
