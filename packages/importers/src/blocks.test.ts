import { REQUIRED_CHARS, type Block } from '@pentwin/engine';
import { describe, expect, it } from 'vitest';
import {
  contentToMarkup,
  mapBlockText,
  markupToContent,
  normalizeBlocks,
  textToBlocks,
} from './blocks';

const bank = new Set(REQUIRED_CHARS);
const canWrite = (char: string): boolean => bank.has(char);

describe('textToBlocks', () => {
  it('splits paragraphs at blank lines and joins the lines inside them', () => {
    expect(textToBlocks('First line\nstill first.\r\n\r\n\n  Second   one. \n\n')).toEqual([
      { type: 'paragraph', text: 'First line still first.' },
      { type: 'paragraph', text: 'Second one.' },
    ]);
    expect(textToBlocks('  \n ')).toEqual([]);
  });
});

describe('mapBlockText', () => {
  const upper = (text: string): string => text.toUpperCase();

  it('reaches the text of every kind of block and keeps everything else', () => {
    const blocks: Block[] = [
      { type: 'heading', text: 'title', level: 2, underline: true },
      { type: 'paragraph', text: [{ text: 'bold', bold: true }, { text: ' plain' }], skip: true },
      { type: 'list', ordered: true, items: ['one', [{ text: 'two', italic: true }]] },
      { type: 'table', rows: [['a', 'b']] },
      { type: 'image', href: 'data:image/png;base64,AAAA', width: 10, height: 5 },
      { type: 'pageBreak' },
    ];
    expect(blocks.map((b) => mapBlockText(b, upper))).toEqual([
      { type: 'heading', text: 'TITLE', level: 2, underline: true },
      { type: 'paragraph', text: [{ text: 'BOLD', bold: true }, { text: ' PLAIN' }], skip: true },
      { type: 'list', ordered: true, items: ['ONE', [{ text: 'TWO', italic: true }]] },
      { type: 'table', rows: [['A', 'B']] },
      blocks[4],
      blocks[5],
    ]);
  });
});

describe('normalizeBlocks', () => {
  it('normalizes the whole document and adds the counts up across blocks', () => {
    const result = normalizeBlocks(
      [
        { type: 'heading', text: 'Caf\u00e9 \u201cmenu\u201d' },
        { type: 'paragraph', text: [{ text: 'Price \u2264 5 \u{1F600}', bold: true }] },
        { type: 'list', items: ['caf\u00e9 \u{1F600}', 'tea \u2013 hot'] },
        { type: 'table', rows: [['\u{1F600}']] },
      ],
      canWrite,
    );
    expect(result.blocks).toEqual([
      { type: 'heading', text: 'Cafe "menu"' },
      { type: 'paragraph', text: [{ text: 'Price \u2264 5 \u{1F600}', bold: true }] },
      { type: 'list', items: ['cafe \u{1F600}', 'tea - hot'] },
      { type: 'table', rows: [['\u{1F600}']] },
    ]);
    expect(result.unsupported).toEqual([
      { char: '\u2264', count: 1, kind: 'math symbol' },
      { char: '\u{1F600}', count: 3, kind: 'emoji' },
    ]);
    expect(result.replaced.find((r) => r.from === '\u00e9')).toEqual({
      from: '\u00e9',
      to: 'e',
      count: 2,
      lossy: true,
    });
  });
});

describe('markup', () => {
  it('shows bold and italic as markers and reads them back', () => {
    const runs = [
      { text: 'The liquid was ' },
      { text: 'heated slowly', bold: true },
      { text: ' and then ' },
      { text: 'left to cool', italic: true },
      { text: '.' },
    ];
    const markup = contentToMarkup(runs);
    expect(markup).toBe('The liquid was **heated slowly** and then *left to cool*.');
    expect(markupToContent(markup)).toEqual(runs);
  });

  it('leaves plain text as a plain string', () => {
    expect(contentToMarkup('just text')).toBe('just text');
    expect(markupToContent('just text')).toBe('just text');
    // A lone asterisk is not markup.
    expect(markupToContent('3 * 4 = 12')).toBe('3 * 4 = 12');
  });

  it('keeps spaces outside the markers', () => {
    expect(contentToMarkup([{ text: 'a ' }, { text: ' bold ', bold: true }, { text: 'b' }])).toBe(
      'a  **bold** b',
    );
  });
});
