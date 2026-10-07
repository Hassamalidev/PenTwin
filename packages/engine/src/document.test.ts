import { PDFDict, PDFDocument, PDFName } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { renderDocument, type Block } from './document';
import { encodePng } from './effects';
import { RULING_SPACING } from './paper';
import { pathBounds } from './path';
import { scenesToPdf } from './pdf';
import { renderText, type PageScene, type RenderOptions } from './render';
import { sceneToSvg } from './svg';
import { loadSampleBank } from './testing';
import type { InkStroke } from './writer';

const bank = loadSampleBank();
const options: RenderOptions = { seed: 'doc' };
const glyphs = (scene: PageScene): InkStroke[] => scene.strokes.filter((s) => s.char !== '');
const rules = (scene: PageScene): InkStroke[] => scene.strokes.filter((s) => s.char === '');
const textOf = (strokes: InkStroke[]): string => strokes.map((s) => s.char).join('');
const height = (stroke: InkStroke): number => {
  const b = pathBounds(stroke.path);
  return b.maxY - b.minY;
};

describe('page header and numbers', () => {
  const header = [
    { label: 'Name', value: 'Sara Khan' },
    { label: 'Date', value: '14/03/2025' },
    { label: 'Roll no', value: '2041' },
  ];
  const body = 'xxxx xxxx xxxx\n'.repeat(60);
  const withHeader = renderText(body, bank, { ...options, header, pageNumbers: true });
  const without = renderText(body, bank, options);

  it('writes the header fields in the same handwriting, above the body', () => {
    const page = withHeader.pages[0]!;
    const bodyTop = Math.min(...page.baselines);
    const above = glyphs(page).filter((s) => pathBounds(s.path).maxY < bodyTop - 2);
    expect(textOf(above)).toBe('Name:SaraKhanDate:14/03/2025Rollno:2041');
  });

  it('puts two fields on one row, one at each margin, when they fit', () => {
    const page = withHeader.pages[0]!;
    const start = (char: string): { x: number; y: number } => {
      const b = pathBounds(glyphs(page).find((s) => s.char === char)!.path);
      return { x: b.minX, y: b.maxY };
    };
    const [name, date, roll] = [start('N'), start('D'), start('R')];
    expect(Math.abs(name.y - date.y)).toBeLessThan(1);
    expect(name.x).toBeLessThan(25);
    expect(date.x).toBeGreaterThan(page.width / 2);
    expect(roll.y - name.y).toBeCloseTo(8, 0); // the next row, one line down
  });

  it('gives each field its own row when two will not fit side by side', () => {
    const narrow = renderText(body, bank, { ...options, pageSize: 'A5', header }).pages[0]!;
    const y = (char: string): number =>
      pathBounds(glyphs(narrow).find((s) => s.char === char)!.path).maxY;
    expect(y('D') - y('N')).toBeGreaterThan(6);
    expect(y('R') - y('D')).toBeGreaterThan(6);
  });

  it('moves the body down on the first page only, unless asked for every page', () => {
    expect(withHeader.pages[0]!.baselines[0]!).toBeGreaterThan(without.pages[0]!.baselines[0]!);
    expect(withHeader.pages[1]!.baselines[0]!).toBe(without.pages[1]!.baselines[0]!);
    const every = renderText(body, bank, { ...options, header, headerOnEveryPage: true });
    expect(every.pages[1]!.baselines[0]!).toBe(every.pages[0]!.baselines[0]!);
    const second = glyphs(every.pages[1]!).filter(
      (s) => pathBounds(s.path).maxY < every.pages[1]!.baselines[0]! - 2,
    );
    expect(textOf(second)).toContain('Name:SaraKhan');
  });

  it('keeps header and body on the ruling of lined paper', () => {
    const ruled = renderText(body, bank, {
      ...options,
      header,
      paper: { kind: 'ruled', ruling: 'wide' },
    }).pages[0]!;
    const step = RULING_SPACING.wide;
    const first = ruled.baselines[0]!;
    for (const stroke of glyphs(ruled).filter((s) => 'NDR'.includes(s.char))) {
      const lines = (first - pathBounds(stroke.path).maxY) / step;
      expect(Math.abs(lines - Math.round(lines))).toBeLessThan(0.08);
      expect(Math.round(lines)).toBeGreaterThanOrEqual(1);
    }
    expect((first - 29.8) / step).toBeCloseTo(Math.round((first - 29.8) / step), 5);
  });

  it('numbers every page at the bottom', () => {
    expect(withHeader.pages.length).toBeGreaterThan(1);
    withHeader.pages.forEach((page, i) => {
      const last = glyphs(page).at(-1)!;
      const b = pathBounds(last.path);
      expect(last.char).toBe(String(i + 1));
      expect(b.maxY).toBeGreaterThan(page.height - 14);
      expect(Math.abs((b.minX + b.maxX) / 2 - page.width / 2)).toBeLessThan(4);
    });
  });
});

describe('renderDocument', { timeout: 120_000 }, () => {
  const blocks: Block[] = [
    { type: 'heading', text: 'Water cycle' },
    {
      type: 'paragraph',
      text: [{ text: 'Rain falls and' }, { text: 'rivers flow', bold: true }, { text: 'to sea.' }],
    },
    { type: 'heading', text: 'Stages', level: 2 },
    { type: 'list', ordered: true, items: ['one drop', 'two drops'] },
    { type: 'list', items: ['mist'] },
    {
      type: 'table',
      rows: [
        ['Stage', 'State'],
        ['Rain', 'liquid water falling over land'],
      ],
    },
  ];
  const { pages, report } = renderDocument(blocks, bank, options);
  const page = pages[0]!;
  const find = (text: string): InkStroke[] => {
    const all = glyphs(page);
    const at = textOf(all).indexOf(text);
    expect(at).toBeGreaterThanOrEqual(0);
    return all.slice(at, at + text.length);
  };

  it('writes every block, in order, with nothing missing', () => {
    expect(report.unknownChars).toEqual({});
    expect(textOf(glyphs(page))).toBe(
      'WatercycleRainfallsandriversflowtosea.Stages1.onedrop2.twodrops-mistStageStateRainliquidwaterfallingoverland',
    );
  });

  it('makes headings larger and heavier, and underlines the main one', () => {
    const ratio = height(find('Water')[0]!) / height(find('Rain')[0]!);
    // "W" against "R", both capitals: the heading is about 1.35 times the size.
    expect(ratio).toBeGreaterThan(1.2);
    expect(ratio).toBeLessThan(1.55);
    expect(find('Water')[0]!.width).toBeCloseTo(0.4 * 1.6, 5);
    expect(find('Stages')[0]!.width).toBeCloseTo(0.4 * 1.6, 5);

    const underline = rules(page)[0]!;
    const u = pathBounds(underline.path);
    // Just under the baseline of the heading (a descender may cross it).
    expect(u.minY).toBeGreaterThan(page.baselines[0]!);
    expect(u.maxY).toBeLessThan(page.baselines[0]! + 3);
    expect(u.maxX - u.minX).toBeGreaterThan(20);
  });

  it('writes bold runs with a heavier pen and leaves the rest alone', () => {
    for (const stroke of find('riversflow')) expect(stroke.width).toBeCloseTo(0.64, 5);
    for (const stroke of [...find('Rainfallsand'), ...find('tosea.')]) {
      expect(stroke.width).toBeCloseTo(0.4, 5);
    }
  });

  it('numbers or dashes list items and indents their text', () => {
    const left = (text: string): number => pathBounds(find(text)[0]!.path).minX;
    expect(left('1.onedrop')).toBeCloseTo(left('2.twodrops'), 0);
    expect(left('onedrop')).toBeGreaterThan(left('1.onedrop') + 2);
    expect(left('mist')).toBeGreaterThan(left('-mist') + 2);
  });

  it('draws a table grid by hand and keeps each cell in its column', () => {
    // Two rows, two columns: three horizontal rules and three vertical ones.
    const grid = rules(page)
      .slice(1)
      .map((s) => pathBounds(s.path));
    const horizontal = grid.filter((b) => b.maxX - b.minX > b.maxY - b.minY);
    const vertical = grid.filter((b) => b.maxX - b.minX <= b.maxY - b.minY);
    expect(horizontal).toHaveLength(3);
    expect(vertical).toHaveLength(3);
    // Not ruler-straight.
    expect(horizontal.some((b) => b.maxY - b.minY > 0.05)).toBe(true);

    const middle = page.width / 2;
    for (const stroke of [...find('Stage').slice(0, 5), ...find('Rain').slice(-4)]) {
      expect(pathBounds(stroke.path).maxX).toBeLessThan(middle);
    }
    for (const stroke of find('liquidwaterfallingoverland')) {
      expect(pathBounds(stroke.path).minX).toBeGreaterThan(middle);
    }
    // The long cell wrapped, so the second row is taller than the first.
    const ys = horizontal.map((b) => (b.minY + b.maxY) / 2).sort((a, b) => a - b);
    expect(ys[2]! - ys[1]!).toBeGreaterThan((ys[1]! - ys[0]!) * 1.5);
  });

  it('keeps every block on the ruling of lined paper', () => {
    const ruled = renderDocument(blocks, bank, {
      ...options,
      paper: { kind: 'ruled', ruling: 'college' },
    }).pages[0]!;
    for (const baseline of ruled.baselines) {
      const lines = (baseline - 29.8) / RULING_SPACING.college;
      expect(Math.abs(lines - Math.round(lines))).toBeLessThan(1e-6);
    }
  });

  it('places images under the ink in SVG and embeds them in the PDF', async () => {
    const png = await encodePng({ width: 4, height: 4, data: new Uint8Array(64).fill(200) });
    const href = `data:image/png;base64,${Buffer.from(png).toString('base64')}`;
    const result = renderDocument(
      [
        { type: 'paragraph', text: 'before' },
        { type: 'image', href, width: 400, height: 200 },
        { type: 'paragraph', text: 'after' },
      ],
      bank,
      options,
    );
    const scene = result.pages[0]!;
    const [image] = scene.images!;
    // Too wide for the page: scaled down to the text width, keeping its shape.
    expect(image!.width).toBeCloseTo(170, 5);
    expect(image!.height).toBeCloseTo(85, 5);
    expect(image!.y).toBeGreaterThan(scene.baselines[0]!);
    expect(scene.baselines[1]!).toBeGreaterThan(image!.y + image!.height);

    const svg = sceneToSvg(scene);
    expect(svg.indexOf('<image')).toBeGreaterThan(0);
    expect(svg.indexOf('<image')).toBeLessThan(svg.indexOf('<g fill="none"'));

    const pdf = await PDFDocument.load(await scenesToPdf([scene]));
    const objects = pdf.getPage(0).node.Resources()?.lookupMaybe(PDFName.of('XObject'), PDFDict);
    expect(objects?.keys().length).toBe(1);
  });

  it('breaks pages on request and when content runs out of room', () => {
    const forced = renderDocument(
      [
        { type: 'paragraph', text: 'one' },
        { type: 'pageBreak' },
        { type: 'paragraph', text: 'two' },
      ],
      bank,
      options,
    );
    expect(forced.pages.map((p) => textOf(glyphs(p)))).toEqual(['one', 'two']);

    const rows = Array.from({ length: 50 }, (_, i) => [`row ${i}`, 'value']);
    const long = renderDocument([{ type: 'table', rows }], bank, options);
    expect(long.pages.length).toBe(2);
    // The table is closed off with its own border on each page.
    for (const scene of long.pages) expect(rules(scene).length).toBeGreaterThan(5);
    expect(long.report.pageCount).toBe(2);
  });

  it('applies corrections to prose only, never to headings or tables', () => {
    const prose = 'the weather was pleasant through most of that long afternoon';
    const result = renderDocument(
      [
        { type: 'heading', text: 'weather report today' },
        { type: 'paragraph', text: prose },
        { type: 'table', rows: [['weather', 'pleasant']] },
      ],
      bank,
      { ...options, corrections: 0.5 },
    );
    const strokes = result.pages.flatMap(glyphs);
    expect(result.corrections.struck + result.corrections.retraced).toBeGreaterThan(0);
    expect(textOf(strokes.filter((s) => !s.struck && !s.retrace))).toBe(
      `weatherreporttoday${prose.replace(/ /g, '')}weatherpleasant`,
    );
    // Whatever was struck or retraced lies between the heading and the table.
    const marked = strokes.findIndex((s) => s.struck || s.retrace);
    expect(marked).toBeGreaterThanOrEqual('weatherreporttoday'.length);
  });

  it('is reproducible', () => {
    const again = renderDocument(blocks, bank, options);
    expect(sceneToSvg(again.pages[0]!)).toBe(sceneToSvg(page));
  });
});
