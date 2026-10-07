/**
 * Builds the side-by-side image in docs/benchmarks: the same text written the way a
 * font-based tool writes it (one shape per letter, dead straight) and the way this
 * engine writes it. See docs/benchmarks/README.md for what this is and is not.
 *
 *   pnpm benchmark
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import {
  applyEffects,
  encodePng,
  presetOptions,
  renderText,
  type GlyphBank,
  type RasterImage,
  type RenderOptions,
} from '../packages/engine/src/index';
import { loadGlyphBank, sceneToPixels } from '../packages/engine/src/node/index';

const { bank } = loadGlyphBank('tests/fixtures/glyphs/sample-user');
const text = readFileSync('docs/benchmarks/text.txt', 'utf8');
const paper = { kind: 'ruled', ruling: 'college' } as const;
const base: RenderOptions = { seed: 'benchmark', pageSize: 'A5', paper };

// What a handwriting font does: every "e" is the same "e", on a perfectly level line.
const oneShape: GlyphBank = {
  ...bank,
  glyphs: new Map([...bank.glyphs].map(([char, variants]) => [char, variants.slice(0, 1)])),
};
const fontStyle = renderText(text, oneShape, base).pages[0]!;
const engine = renderText(text, bank, { ...base, ...presetOptions('normal'), paper }).pages[0]!;

const scan = (scene: typeof engine): RasterImage =>
  applyEffects(sceneToPixels(scene, 100), { mode: 'scan', seed: 'benchmark' });
const [left, right] = [scan(fontStyle), scan(engine)];

// The two pages next to each other, with a white gutter between them.
const gutter = 24;
const width = left.width + gutter + right.width;
const height = Math.max(left.height, right.height);
const data = new Uint8Array(width * height * 4).fill(255);
for (const [image, offset] of [
  [left, 0],
  [right, left.width + gutter],
] as const) {
  for (let y = 0; y < image.height; y++) {
    data.set(
      image.data.subarray(y * image.width * 4, (y + 1) * image.width * 4),
      (y * width + offset) * 4,
    );
  }
}

mkdirSync('docs/benchmarks', { recursive: true });
writeFileSync('docs/benchmarks/font-style-vs-engine.png', await encodePng({ width, height, data }));
console.log('docs/benchmarks/font-style-vs-engine.png (left: font-style, right: engine)');
