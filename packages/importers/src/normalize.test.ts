import { REQUIRED_CHARS } from '@pentwin/engine';
import { describe, expect, it } from 'vitest';
import { describeProblems, normalizeText } from './normalize';

const bank = new Set(REQUIRED_CHARS);
const canWrite = (char: string): boolean => bank.has(char);
const clean = (text: string) => normalizeText(text, canWrite);

describe('normalizeText', () => {
  it('leaves plain text alone', () => {
    const text = 'Plain text, with (brackets) & 100% "quotes".\nSecond line.';
    expect(clean(text)).toEqual({ text, replaced: [], unsupported: [] });
  });

  it('straightens smart quotes and dashes', () => {
    const result = clean('\u201cIt\u2019s fine\u201d \u2013 she said \u2014 \u2018really\u2019');
    expect(result.text).toBe("\"It's fine\" - she said - 'really'");
    expect(result.unsupported).toEqual([]);
    expect(result.replaced.every((r) => !r.lossy)).toBe(true);
    expect(result.replaced.find((r) => r.from === '\u2019')).toMatchObject({ to: "'", count: 2 });
  });

  it('expands ligatures, ellipses, fractions and marks', () => {
    expect(clean('o\ufb03ce \ufb01le\u2026 \u00bd cup, 3\u00d74, Acme\u2122').text).toBe(
      'office file... 1/2 cup, 3x4, Acme(TM)',
    );
  });

  it('turns every kind of space into a plain one and drops invisible characters', () => {
    const result = clean('a\u00a0b\u2009c\td so\u00adft zero\u200bwidth \ufeffbom');
    expect(result.text).toBe('a b c d soft zerowidth bom');
    expect(result.unsupported).toEqual([]);
  });

  it('writes accented letters plainly and marks that as lossy', () => {
    const result = clean('caf\u00e9 na\u00efve r\u00e9sum\u00e9');
    expect(result.text).toBe('cafe naive resume');
    expect(result.replaced).toEqual([
      { from: '\u00e9', to: 'e', count: 3, lossy: true },
      { from: '\u00ef', to: 'i', count: 1, lossy: true },
    ]);
  });

  it('lists emoji and math symbols instead of dropping them', () => {
    const text =
      'Great work \u{1F600}\u{1F600}! Sum: \u2211 x \u2264 10, \u221a2 and \u20ac5 \u{1F468}\u200d\u{1F469}\u200d\u{1F467}';
    const result = clean(text);
    // Still in the text, in place: the renderer leaves a gap and reports them too.
    expect(result.text).toBe(text);
    expect(result.unsupported).toEqual([
      { char: '\u{1F600}', count: 2, kind: 'emoji' },
      { char: '\u2211', count: 1, kind: 'math symbol' },
      { char: '\u2264', count: 1, kind: 'math symbol' },
      { char: '\u221a', count: 1, kind: 'math symbol' },
      { char: '\u20ac', count: 1, kind: 'currency symbol' },
      // A family emoji is several code points but one character to the reader.
      { char: '\u{1F468}\u200d\u{1F469}\u200d\u{1F467}', count: 1, kind: 'emoji' },
    ]);
  });

  it('names letters from other alphabets', () => {
    expect(clean('\u0633\u0644\u0627\u0645 \u4f60').unsupported.map((u) => u.kind)).toEqual([
      'letter from another alphabet',
      'letter from another alphabet',
      'letter from another alphabet',
      'letter from another alphabet',
      'letter from another alphabet',
    ]);
  });

  it('only substitutes what the bank can actually write', () => {
    // A bank with no hyphen cannot write a dash as "-".
    const noHyphen = normalizeText('a \u2014 b', (char) => char !== '-' && canWrite(char));
    expect(noHyphen.text).toBe('a \u2014 b');
    expect(noHyphen.unsupported).toEqual([{ char: '\u2014', count: 1, kind: 'symbol' }]);
    // A bank that does have an accented letter keeps it.
    const withAccent = normalizeText('caf\u00e9', (char) => char === '\u00e9' || canWrite(char));
    expect(withAccent).toEqual({ text: 'caf\u00e9', replaced: [], unsupported: [] });
  });
});

describe('describeProblems', () => {
  it('gives one clear sentence per problem', () => {
    expect(
      describeProblems(clean('Hi \u{1F600}\u{1F600} \u2264 caf\u00e9 \u201cok\u201d')),
    ).toEqual([
      '"\u{1F600}" (emoji) appears 2 times and cannot be written in your handwriting. A gap will be left.',
      '"\u2264" (math symbol) appears once and cannot be written in your handwriting. A gap will be left.',
      '"\u00e9" appears once and will be written as "e".',
    ]);
  });

  it('says nothing when everything can be written faithfully', () => {
    expect(describeProblems(clean('All \u201cfine\u201d here \u2013 really.'))).toEqual([]);
  });
});
