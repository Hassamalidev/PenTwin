/**
 * Renders the pictures the public site uses: the hero, the gallery and the social
 * preview image. Every one is real engine output, written with the synthetic demo
 * glyph set. Runs automatically before `dev` and `build` of the web app.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  encodePng,
  presetOptions,
  renderDocument,
  renderText,
  sceneToSvg,
  type PageScene,
  type RenderOptions,
} from '../packages/engine/src/index';
import { loadGlyphBank, sceneToPixels, svgToPixels } from '../packages/engine/src/node/index';
import {
  DEMO_TEXTS,
  DEMO_VIEW,
  GALLERY,
  HERO_TEXT,
  SOCIAL_TEXT,
} from '../apps/web/src/lib/gallery';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'apps/web/public/gallery');
mkdirSync(out, { recursive: true });

const { bank } = loadGlyphBank(join(root, 'tests/fixtures/glyphs/sample-user'));
const sample = readFileSync(join(root, 'tests/sample.txt'), 'utf8');
const base: RenderOptions = { seed: 'site', pageSize: 'A5' };

interface Window {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A rectangular window onto a page (in mm), as pixels `pixels` wide. */
const windowOf = (scene: PageScene, view: Window, pixels: number) => {
  const svg = sceneToSvg(scene)
    .replace(/width="[\d.]+mm" height="[\d.]+mm"/, `width="${view.width}" height="${view.height}"`)
    .replace(/viewBox="[^"]+"/, `viewBox="${view.x} ${view.y} ${view.width} ${view.height}"`);
  return svgToPixels(svg, pixels);
};

const save = async (name: string, scene: PageScene, dpi = 120): Promise<void> => {
  writeFileSync(join(out, `${name}.png`), await encodePng(sceneToPixels(scene, dpi)));
};

// Hero: the same sentence the typed side of the comparison shows.
const hero = renderText(HERO_TEXT, bank, {
  ...base,
  ...presetOptions('normal'),
  corrections: 0,
  margins: { left: 12, right: 12 },
}).pages[0]!;
// Just the written lines: the page's blank top and bottom would only waste space.
writeFileSync(
  join(out, 'hero-handwritten.png'),
  await encodePng(windowOf(hero, { x: 8, y: 20, width: 132, height: 46 }, 1100)),
);

// The live demo's starting picture: the same settings the demo itself uses in the browser.
for (const [key, text] of Object.entries(DEMO_TEXTS)) {
  const page = renderText(text, bank, {
    seed: 'demo',
    pageSize: 'A5',
    ...presetOptions('normal'),
    corrections: 0,
    margins: { top: 8, left: 12, right: 12 },
  }).pages[0]!;
  writeFileSync(
    join(out, `demo-${key}.png`),
    await encodePng(
      windowOf(
        page,
        { x: 0, y: 0, width: DEMO_VIEW.width, height: DEMO_VIEW.height },
        DEMO_VIEW.pixels,
      ),
    ),
  );
}

const scenes: Record<(typeof GALLERY)[number]['id'], () => PageScene | Promise<PageScene>> = {
  neat: () => renderText(sample, bank, { ...base, ...presetOptions('neat') }).pages[0]!,
  exam: () =>
    renderText(sample, bank, { ...base, ...presetOptions('exam'), corrections: 0.02 }).pages[0]!,
  lecture: () =>
    renderText(`${sample}${sample}`, bank, { ...base, ...presetOptions('lecture') }).pages[0]!,
  fountain: () =>
    renderText(sample, bank, {
      ...base,
      ...presetOptions('normal'),
      ink: 'fountain',
      paper: { kind: 'plain' },
      lineHeight: 9,
    }).pages[0]!,
  dotted: () =>
    renderText(sample, bank, { ...base, ...presetOptions('normal'), paper: { kind: 'dotted' } })
      .pages[0]!,
  notes: () =>
    renderDocument(
      [
        { type: 'heading', text: 'Water cycle notes' },
        {
          type: 'paragraph',
          text: [
            { text: 'Water moves between the sea, the air and the land. The main driver is ' },
            { text: 'heat from the sun,', bold: true },
            { text: ' which lifts water into the air.' },
          ],
        },
        { type: 'heading', text: 'Stages', level: 2 },
        {
          type: 'list',
          ordered: true,
          items: [
            'Evaporation from seas and lakes',
            'Condensation into clouds',
            'Rain or snow falls',
          ],
        },
        {
          type: 'table',
          rows: [
            ['Stage', 'Where'],
            ['Evaporation', 'sea surface'],
            ['Rainfall', 'land and sea'],
          ],
        },
      ],
      bank,
      {
        ...base,
        ...presetOptions('normal'),
        corrections: 0,
        paper: { kind: 'ruled', ruling: 'college', marginLine: true },
        header: [{ label: 'Name', value: 'Sara Khan' }],
      },
    ).pages[0]!,
};

for (const { id } of GALLERY) await save(id, await scenes[id]());

// Social preview: 1200 x 630, the headline in handwriting on lined paper.
const social = renderText(SOCIAL_TEXT, bank, {
  ...base,
  pageSize: 'A4',
  ...presetOptions('neat'),
  ink: 'ballpoint-blue',
  paper: { kind: 'ruled', ruling: 'wide' },
  xHeight: 4.2,
  margins: { left: 16, right: 16 },
}).pages[0]!;
writeFileSync(
  join(root, 'apps/web/public/og.png'),
  await encodePng(windowOf(social, { x: 6, y: 12, width: 150, height: 78.75 }, 1200)),
);

console.log(`site assets: hero, ${GALLERY.length} gallery pictures, social preview`);
