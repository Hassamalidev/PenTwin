import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildGlyphBank,
  pathBounds,
  presetOptions,
  quoteExport,
  renderDocument,
  type Block,
  type RenderOptions,
} from '@pentwin/engine';
import { PDFDocument } from 'pdf-lib';
import { afterAll, describe, expect, it } from 'vitest';
import { createExportService } from './export';
import type { ExportRequest } from './schema';

const glyphDir = fileURLToPath(
  new URL('../../../tests/fixtures/glyphs/sample-user', import.meta.url),
);
const bankData: ExportRequest['bank'] = {
  metadata: JSON.parse(readFileSync(join(glyphDir, 'metadata.json'), 'utf8')),
  files: Object.fromEntries(
    readdirSync(glyphDir)
      .filter((name) => name.endsWith('.svg'))
      .map((name) => [name, readFileSync(join(glyphDir, name), 'utf8')]),
  ),
};
const bank = buildGlyphBank(bankData.metadata, (file) => bankData.files[file]!);
const storageDir = mkdtempSync(join(tmpdir(), 'pentwin-overrides-'));
afterAll(() => rmSync(storageDir, { recursive: true, force: true }));
const service = createExportService({ storageDir, secret: 'test-secret-of-sufficient-length' });

const prose = 'the weather was pleasant through most of that long afternoon. '.repeat(12);
const written = (blocks: Block[], options: RenderOptions = { seed: 1 }): string =>
  renderDocument(blocks, bank, options)
    .pages.flatMap((page) => page.strokes)
    .map((s) => s.char)
    .join('');

describe('per-block overrides', () => {
  const blocks: Block[] = [
    { type: 'heading', text: 'Notes' },
    { type: 'paragraph', text: 'first' },
    { type: 'paragraph', text: 'second' },
  ];

  it('leaves a skipped block out and keeps the rest', () => {
    const skipped = blocks.map((b, i) => (i === 1 ? { ...b, skip: true } : b));
    expect(written(blocks)).toBe('Notesfirstsecond');
    expect(written(skipped)).toBe('Notessecond');
    // Skipping moves what follows up: it takes no space.
    const lines = (list: Block[]): number =>
      renderDocument(list, bank, { seed: 1 }).pages[0]!.baselines.length;
    expect(lines(skipped)).toBe(lines(blocks) - 1);
  });

  it('starts a new page at a page break, unless the break itself is skipped', () => {
    const withBreak: Block[] = [blocks[0]!, blocks[1]!, { type: 'pageBreak' }, blocks[2]!];
    const pages = (list: Block[]): number => renderDocument(list, bank, { seed: 1 }).pages.length;
    expect(pages(blocks)).toBe(1);
    expect(pages(withBreak)).toBe(2);
    expect(pages(withBreak.map((b) => (b.type === 'pageBreak' ? { ...b, skip: true } : b)))).toBe(
      1,
    );
  });

  it('restyles a heading: its size and whether it is underlined', () => {
    const heading = (extra: object) =>
      renderDocument([{ type: 'heading', text: 'Notes', ...extra }], bank, { seed: 1 }).pages[0]!;
    const capHeight = (scene: ReturnType<typeof heading>): number => {
      const b = pathBounds(scene.strokes[0]!.path);
      return b.maxY - b.minY;
    };
    const underlines = (scene: ReturnType<typeof heading>): number =>
      scene.strokes.filter((s) => s.char === '').length;

    expect(capHeight(heading({ scale: 1.8 })) / capHeight(heading({ scale: 1 }))).toBeCloseTo(
      1.8,
      1,
    );
    expect(underlines(heading({}))).toBe(1);
    expect(underlines(heading({ underline: false }))).toBe(0);
    expect(underlines(heading({ level: 2 }))).toBe(0);
    expect(underlines(heading({ level: 2, underline: true }))).toBe(1);
  });

  it('carries overrides through to the exported PDF', async () => {
    const full: Block[] = [
      { type: 'heading', text: 'Notes', scale: 1.6, underline: false },
      { type: 'paragraph', text: 'kept' },
      { type: 'paragraph', text: 'left out', skip: true },
      { type: 'pageBreak' },
      { type: 'paragraph', text: 'on page two' },
    ];
    const result = await service.exportDocument({
      blocks: full,
      bank: bankData,
      options: { seed: 'o' },
    });
    expect(result.pageCount).toBe(2);
    // The same blocks without the overrides give a different document.
    const plain = full.filter((b) => b.type !== 'pageBreak').map((b) => ({ ...b, skip: false }));
    const other = await service.exportDocument({
      blocks: plain,
      bank: bankData,
      options: { seed: 'o' },
    });
    expect(other.id).not.toBe(result.id);
    expect(other.pageCount).toBe(1);
    // And the worker refuses override values outside sensible limits.
    await expect(
      service.exportDocument({
        blocks: [{ type: 'heading', text: 'x', scale: 50 }],
        bank: bankData,
        options: { seed: 1 },
      }),
    ).rejects.toThrow(/scale/);
  });
});

describe('export quote', { timeout: 120_000 }, () => {
  const documents: [name: string, blocks: Block[], options: ExportRequest['options']][] = [
    ['one short page', [{ type: 'paragraph', text: 'Hello there.' }], { seed: 'a' }],
    ['several pages', Array<Block>(14).fill({ type: 'paragraph', text: prose }), { seed: 'b' }],
    [
      'header, page numbers and a preset',
      Array<Block>(9).fill({ type: 'paragraph', text: prose }),
      {
        seed: 'c',
        ...presetOptions('exam'),
        header: [{ label: 'Name', value: 'Sara Khan' }],
        pageNumbers: true,
      },
    ],
    [
      'skips and page breaks',
      [
        { type: 'heading', text: 'Part one' },
        { type: 'paragraph', text: prose },
        { type: 'paragraph', text: prose, skip: true },
        { type: 'pageBreak' },
        { type: 'list', items: ['alpha', 'beta'] },
        { type: 'table', rows: [['a', 'b']] },
      ],
      { seed: 'd', pageSize: 'A5', paper: { kind: 'ruled', ruling: 'wide', marginLine: true } },
    ],
    [
      'corrections change the length',
      Array<Block>(10).fill({ type: 'paragraph', text: prose }),
      { seed: 'e', corrections: 0.3 },
    ],
  ];

  it.each(documents)(
    'shows the exact page count and cost for: %s',
    async (_name, blocks, options) => {
      const quote = quoteExport(blocks, bank, options);
      const result = await service.exportDocument({ blocks, bank: bankData, options });
      expect(quote.pageCount).toBe(result.pageCount);
      expect(quote.credits).toBe(result.billablePages);
      expect(quote.unknownChars).toEqual(result.unknownChars);

      const { id, expires, sig } = Object.fromEntries(
        new URL(result.downloadPath, 'http://x').searchParams,
      ) as { id?: string; expires: string; sig: string };
      const file = await service.download(id ?? result.id, expires, sig);
      expect((await PDFDocument.load(file)).getPageCount()).toBe(quote.pageCount);
    },
  );

  it('covers more than one page in the multi-page cases', () => {
    expect(quoteExport(documents[1]![1], bank, documents[1]![2]).pageCount).toBeGreaterThan(2);
  });

  it('summarises the settings in plain words', () => {
    const [, blocks, options] = documents[3]!;
    expect(quoteExport(blocks, bank, options).settings).toEqual([
      'Page size: A5',
      'Paper: Lined (wide ruled), with margin line',
      'Pen: Plain blue',
      '1 block left out',
    ]);
    expect(quoteExport(documents[2]![1], bank, documents[2]![2]).settings).toEqual([
      'Page size: A4',
      'Paper: Lined (wide ruled), with margin line',
      'Pen: Black ballpoint',
      'Header: Name',
      'Page numbers: on',
      'Occasional corrections: on',
    ]);
  });

  it('reports characters that cannot be written before the export is made', () => {
    const quote = quoteExport([{ type: 'paragraph', text: 'caf\u00e9 \u2264 5' }], bank, {
      seed: 1,
    });
    expect(Object.keys(quote.unknownChars).sort()).toEqual(['\u00e9', '\u2264']);
  });
});
