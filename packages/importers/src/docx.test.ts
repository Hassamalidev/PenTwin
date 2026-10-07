import { encodePng, renderDocument } from '@pentwin/engine';
import { loadGlyphBank } from '@pentwin/engine/node';
import {
  Document,
  HeadingLevel,
  ImageRun,
  LevelFormat,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
} from 'docx';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { importDocx } from './docx';
import { htmlToBlocks, imagePixelSize } from './html';

/** A Word document with one of everything, built in memory. */
async function fixture(): Promise<Uint8Array> {
  const png = await encodePng({
    width: 96,
    height: 48,
    data: new Uint8Array(96 * 48 * 4).fill(180),
  });
  const cell = (text: string): TableCell => new TableCell({ children: [new Paragraph(text)] });
  const doc = new Document({
    numbering: {
      config: [
        {
          reference: 'steps',
          levels: [{ level: 0, format: LevelFormat.DECIMAL, text: '%1.', alignment: 'left' }],
        },
      ],
    },
    sections: [
      {
        children: [
          new Paragraph({ text: 'Lab report', heading: HeadingLevel.HEADING_1 }),
          new Paragraph({
            children: [
              new TextRun('The liquid was '),
              new TextRun({ text: 'heated slowly', bold: true }),
              new TextRun(' and then '),
              new TextRun({ text: 'left to cool', italics: true }),
              new TextRun('.'),
            ],
          }),
          new Paragraph({ text: 'Method', heading: HeadingLevel.HEADING_2 }),
          new Paragraph({
            text: 'Measure the liquid',
            numbering: { reference: 'steps', level: 0 },
          }),
          new Paragraph({ text: 'Heat it gently', numbering: { reference: 'steps', level: 0 } }),
          new Paragraph({ text: 'a beaker', bullet: { level: 0 } }),
          new Paragraph({ text: 'a burner', bullet: { level: 0 } }),
          new Table({
            rows: [
              new TableRow({ children: [cell('Time'), cell('Temperature')] }),
              new TableRow({ children: [cell('0 min'), cell('21 C')] }),
            ],
          }),
          new Paragraph({
            children: [
              new ImageRun({ data: png, transformation: { width: 96, height: 48 }, type: 'png' }),
            ],
          }),
          new Paragraph('A plain closing paragraph.'),
        ],
      },
    ],
  });
  return new Uint8Array(await Packer.toBuffer(doc));
}

describe('importDocx', { timeout: 60_000 }, () => {
  it('reads every block type from a Word document', async () => {
    const { blocks, warnings } = await importDocx(await fixture());
    expect(warnings).toEqual([]);
    expect(blocks.map((b) => b.type)).toEqual([
      'heading',
      'paragraph',
      'heading',
      'list',
      'list',
      'table',
      'image',
      'paragraph',
    ]);
    expect(blocks[0]).toEqual({ type: 'heading', text: 'Lab report', level: 1 });
    expect(blocks[1]).toEqual({
      type: 'paragraph',
      text: [
        { text: 'The liquid was ' },
        { text: 'heated slowly', bold: true },
        { text: ' and then ' },
        { text: 'left to cool', italic: true },
        { text: '.' },
      ],
    });
    expect(blocks[2]).toEqual({ type: 'heading', text: 'Method', level: 2 });
    expect(blocks[3]).toEqual({
      type: 'list',
      ordered: true,
      items: ['Measure the liquid', 'Heat it gently'],
    });
    expect(blocks[4]).toEqual({ type: 'list', ordered: false, items: ['a beaker', 'a burner'] });
    expect(blocks[5]).toEqual({
      type: 'table',
      rows: [
        ['Time', 'Temperature'],
        ['0 min', '21 C'],
      ],
    });
    expect(blocks[6]).toMatchObject({ type: 'image' });
    expect((blocks[6] as { width: number }).width).toBeCloseTo(25.4, 1); // 96px at 96dpi
    expect((blocks[6] as { height: number }).height).toBeCloseTo(12.7, 1);
    expect(blocks[7]).toEqual({ type: 'paragraph', text: 'A plain closing paragraph.' });
  });

  it('produces blocks the engine can write', async () => {
    const { blocks } = await importDocx(await fixture());
    const dir = fileURLToPath(
      new URL('../../../tests/fixtures/glyphs/sample-user', import.meta.url),
    );
    const { pages, report } = renderDocument(blocks, loadGlyphBank(dir).bank, { seed: 1 });
    expect(pages).toHaveLength(1);
    expect(report.unknownChars).toEqual({});
    expect(pages[0]!.images).toHaveLength(1);
  });

  it('rejects a file that is not a Word document', async () => {
    await expect(importDocx(new TextEncoder().encode('not a docx'))).rejects.toThrow();
  });
});

describe('htmlToBlocks', () => {
  it('decodes entities and collapses whitespace', () => {
    expect(
      htmlToBlocks('<p>Fish &amp; chips\n   &lt;hot&gt; &#8211; &#x263A; caf&eacute;</p>').blocks,
    ).toEqual([{ type: 'paragraph', text: 'Fish & chips <hot> \u2013 \u263a caf&eacute;' }]);
  });

  it('flattens nested lists and paragraphs inside items', () => {
    const html = '<ul><li><p>one</p><ul><li>inner</li></ul></li><li>two<br/>more</li></ul>';
    expect(htmlToBlocks(html).blocks).toEqual([
      { type: 'list', ordered: false, items: ['one', 'inner', 'two more'] },
    ]);
  });

  it('keeps the text of tags it does not know and skips empty paragraphs', () => {
    const html =
      '<p></p><p>See <a href="https://x.test?a=1&amp;b=2">this <u>link</u></a> now</p><p> </p>';
    expect(htmlToBlocks(html).blocks).toEqual([{ type: 'paragraph', text: 'See this link now' }]);
  });

  it('warns about pictures it cannot use instead of dropping them silently', () => {
    const { blocks, warnings } = htmlToBlocks(
      '<p>a</p><p><img src="data:image/x-emf;base64,AAAA" /></p><p><img src="https://x.test/p.png"/></p>',
    );
    expect(blocks).toEqual([{ type: 'paragraph', text: 'a' }]);
    expect(warnings).toHaveLength(2);
    expect(warnings[0]).toContain('x-emf');
    expect(warnings[1]).toContain('Only PNG and JPEG');
  });

  it('reads picture sizes from PNG and JPEG headers', () => {
    // A minimal JPEG: start marker, then a baseline frame header saying 300 x 200.
    const jpeg = Uint8Array.from([0xff, 0xd8, 0xff, 0xc0, 0, 17, 8, 0, 200, 1, 44, 3, 1, 0, 0, 0]);
    expect(imagePixelSize(jpeg)).toEqual({ width: 300, height: 200 });
    expect(imagePixelSize(Uint8Array.from([1, 2, 3, 4, 5]))).toBeUndefined();
  });
});
