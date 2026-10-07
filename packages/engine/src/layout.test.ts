import { describe, expect, it } from 'vitest';
import { layoutText, type LayoutOptions } from './layout';

// Every character is 1mm wide, spaces are 1mm, and the text area is 10mm x 3 lines.
const options: LayoutOptions = {
  pageWidth: 30,
  pageHeight: 50,
  margins: { top: 10, right: 10, bottom: 10, left: 10 },
  lineHeight: 10,
  spaceWidth: 1,
  measure: () => 1,
};

const linesOf = (text: string, overrides: Partial<LayoutOptions> = {}): string[][] =>
  layoutText(text, { ...options, ...overrides }).map((page) =>
    page.lines.map((line) => line.words.map((w) => w.text).join(' ')),
  );

describe('layoutText', () => {
  it('wraps words greedily', () => {
    expect(linesOf('aaa bbb ccc ddd')).toEqual([['aaa bbb', 'ccc ddd']]);
  });

  it('keeps a line that fits exactly and wraps one that is a hair too long', () => {
    expect(linesOf('aaaa bbbbb')).toEqual([['aaaa bbbbb']]); // 4 + 1 + 5 = 10
    expect(linesOf('aaaaa bbbbb')).toEqual([['aaaaa', 'bbbbb']]); // 11
    expect(linesOf('aaaaaaaaaa')).toEqual([['aaaaaaaaaa']]);
  });

  it('hard-breaks a word longer than the line, without hyphens by default', () => {
    expect(linesOf('x aaaaaaaaaaaaaaaaaaaaaaa y')).toEqual(
      [['x', 'aaaaaaaaaa', 'aaaaaaaaaa']].concat([['aaa y']]),
    );
  });

  it('adds a hyphen to forced breaks when hyphenate is on', () => {
    const [page] = linesOf('aaaaaaaaaaaaaaaaaaaa', { hyphenate: true, pageHeight: 500 });
    expect(page).toEqual(['aaaaaaaaa-', 'aaaaaaaaa-', 'aa']);
    for (const line of page!) expect(line.length).toBeLessThanOrEqual(10);
  });

  it('never hyphenates a word that fits on a line', () => {
    expect(linesOf('aaaaaa bbbbbb', { hyphenate: true })).toEqual([['aaaaaa', 'bbbbbb']]);
  });

  it('keeps empty lines and collapses runs of whitespace', () => {
    expect(linesOf('a\n\nb')).toEqual([['a', '', 'b']]);
    expect(linesOf('a   b\t c')).toEqual([['a b c']]);
    expect(linesOf('')).toEqual([['']]);
    expect(linesOf('a\r\nb')).toEqual([['a', 'b']]);
  });

  it('overflows onto new pages', () => {
    const pages = layoutText('a\nb\nc\nd\ne\nf\ng', options);
    expect(pages.map((p) => p.lines.length)).toEqual([3, 3, 1]);
    for (const page of pages) expect(page.lines[0]!.baseline).toBe(20);
    expect(pages[0]!.lines.map((l) => l.baseline)).toEqual([20, 30, 40]);
  });

  it('adds paragraph spacing and positions words from the left margin', () => {
    const [page] = layoutText('ab cd\ne', { ...options, paragraphSpacing: 0.5, pageHeight: 500 });
    expect(page!.lines.map((l) => l.baseline)).toEqual([20, 35]);
    expect(page!.lines[0]!.words).toEqual([
      { text: 'ab', x: 10, width: 2 },
      { text: 'cd', x: 13, width: 2 },
    ]);
  });

  it('honours an explicit first baseline', () => {
    const [page] = layoutText('a\nb', { ...options, firstBaseline: 25 });
    expect(page!.lines.map((l) => l.baseline)).toEqual([25, 35]);
  });

  it('always places at least one line per page, and rejects a page with no width', () => {
    expect(layoutText('a\nb', { ...options, lineHeight: 100 })).toHaveLength(2);
    expect(() => layoutText('a', { ...options, pageWidth: 20 })).toThrow();
  });
});
