/**
 * The true test of the product: cuts a real writer's letters from a real page, then writes
 * new text with them, the way a user's handwriting would be used. Pictures go to
 * test-results/real-hand, which git ignores: handwriting images are never committed.
 *
 *   pnpm real:render <folder of .pgm files> [writer filter] [style]
 */
import { mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  buildGlyphBank,
  encodePng,
  finishPage,
  presetOptions,
  renderText,
  tuneJitter,
  type PresetName,
} from '../packages/engine/src/index';
import { sceneToPixels } from '../packages/engine/src/node/index';
import { applyFallbacks, extractGlyphBank, mergeTopUp } from '../packages/extractor/src/index';
import { readPgm } from './pgm';

const TEXTS: Record<string, string> = {
  WOZ: 'Within a short time she was walking briskly toward the Emerald City, her silver shoes tinkling merrily on the hard, yellow roadbed. The sun shone bright and the birds sang sweet and Dorothy did not feel nearly as bad as you might think a little girl would who had been suddenly whisked away from her own country and set down in the midst of a strange land.',
  LND: "Our London business is good, but Vienna and Berlin are quiet. Mr. D. Lloyd has gone to Switzerland and I hope for good news. He will be there for a week at 1496 Zermott Street and then goes to Turin and Rome and will join Colonel Parry and arrive at Athens, Greece, November 27 or December 2. Letters there should be addressed King James Blvd. 3580. We expect Charles E. Fuller Tuesday. Dr. L. McQuaid and Robert Unger, Esq., left on the 'Y.X.' Express tonight.",
};
const NEW_TEXT =
  'The water in the river was cold and the wind came down from the hills all morning. ' +
  'She thought about the letter she had not sent, and walked on past the old town with her ' +
  'hands in her coat. Nothing had changed there, and that was what she liked most.';

const [dir, filter = '', style = 'normal'] = process.argv.slice(2);
if (!dir) throw new Error('Usage: pnpm real:render <folder of .pgm files> [filter] [style]');
const out = 'test-results/real-hand';
mkdirSync(out, { recursive: true });

const read = (name: string) => {
  const gray = readPgm(join(dir, name));
  const rgba = new Uint8ClampedArray(gray.width * gray.height * 4);
  for (let i = 0; i < gray.data.length; i++) {
    rgba[i * 4] = rgba[i * 4 + 1] = rgba[i * 4 + 2] = gray.data[i]!;
    rgba[i * 4 + 3] = 255;
  }
  return { width: gray.width, height: gray.height, data: rgba };
};

const files = readdirSync(dir).filter((n) => n.endsWith('.pgm') && n.includes(filter));
const writers = [...new Set(files.map((n) => n.slice(0, 5)))];
for (const writer of writers) {
  const sources = files.filter((n) => n.startsWith(writer));
  const first = sources.find((n) => n.includes('pWOZ'));
  if (!first) continue;
  const result = extractGlyphBank(read(first), TEXTS.WOZ!, { skipQualityGate: true });
  if (!result.bank) {
    console.log(`${writer}: no letters extracted`);
    continue;
  }
  // The second page fills in the alphabet, as a top-up sheet does for a user.
  const second = sources.find((n) => n.includes('pLND'));
  const extra = second
    ? extractGlyphBank(read(second), TEXTS.LND!, { skipQualityGate: true })
    : undefined;
  const merged = extra?.bank
    ? mergeTopUp(result.bank, extra.bank, Object.keys(extra.bank.metadata.glyphs), 12).bank
    : result.bank;
  const filled = applyFallbacks(merged);
  const bank = buildGlyphBank(filled.bank.metadata, (file) => filled.bank.files[file]!);
  const preset = presetOptions(style as PresetName);
  const xHeight = 2.6;
  const { pages, report } = renderText(NEW_TEXT, bank, {
    seed: 'real',
    pageSize: 'A5',
    ...preset,
    ink: 'ballpoint-blue',
    xHeight,
    ...(result.style ? { jitter: tuneJitter(result.style, xHeight) } : {}),
  });
  const dpi = 150;
  const clean = sceneToPixels({ ...pages[0]!, inkEffects: undefined }, dpi);
  const page = finishPage(clean, { mode: 'scan', seed: 'real', pxPerMm: dpi / 25.4, patch: 0.12 });
  const file = join(out, `${writer}-${style}.png`);
  writeFileSync(file, await encodePng(page));
  const counts = Object.values(filled.bank.metadata.glyphs).map((v) => v.length);
  console.log(
    `${file}: ${counts.length} characters, ${counts.reduce((a, b) => a + b, 0)} samples, ` +
      `gaps left: ${Object.keys(report.unknownChars).join('') || 'none'}`,
  );
}
