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
    const result = clean('“It’s fine” – she said — ‘really’');
    expect(result.text).toBe("\"It's fine\" - she said - 'really'");
    expect(result.unsupported).toEqual([]);
    expect(result.replaced.every((r) => !r.lossy)).toBe(true);
    expect(result.replaced.find((r) => r.from === '’')).toMatchObject({ to: "'", count: 2 });
  });

  it('expands ligatures, ellipses, fractions and marks', () => {
    expect(clean('oﬃce ﬁle… ½ cup, 3×4, Acme™').text).toBe('office file... 1/2 cup, 3x4, Acme(TM)');
  });

  it('turns every kind of space into a plain one and drops invisible characters', () => {
    const result = clean('a b c\td so­ft zero​width ﻿bom');
    expect(result.text).toBe('a b c d soft zerowidth bom');
    expect(result.unsupported).toEqual([]);
  });

  it('writes accented letters plainly and marks that as lossy', () => {
    const result = clean('café naïve résumé');
    expect(result.text).toBe('cafe naive resume');
    expect(result.replaced).toEqual([
      { from: 'é', to: 'e', count: 3, lossy: true },
      { from: 'ï', to: 'i', count: 1, lossy: true },
    ]);
  });

  it('lists emoji and math symbols instead of dropping them', () => {
    const text =
      'Great work \u{1F600}\u{1F600}! Sum: ∑ x ≤ 10, √2 and €5 \u{1F468}‍\u{1F469}‍\u{1F467}';
    const result = clean(text);
    // Still in the text, in place: the renderer leaves a gap and reports them too.
    expect(result.text).toBe(text);
    expect(result.unsupported).toEqual([
      { char: '\u{1F600}', count: 2, kind: 'emoji' },
      { char: '∑', count: 1, kind: 'math symbol' },
      { char: '≤', count: 1, kind: 'math symbol' },
      { char: '√', count: 1, kind: 'math symbol' },
      { char: '€', count: 1, kind: 'currency symbol' },
      // A family emoji is several code points but one character to the reader.
      { char: '\u{1F468}‍\u{1F469}‍\u{1F467}', count: 1, kind: 'emoji' },
    ]);
  });

  it('names letters from other alphabets', () => {
    expect(clean('سلام 你').unsupported.map((u) => u.kind)).toEqual([
      'letter from another alphabet',
      'letter from another alphabet',
      'letter from another alphabet',
      'letter from another alphabet',
      'letter from another alphabet',
    ]);
  });

  it('only substitutes what the bank can actually write', () => {
    // A bank with no hyphen cannot write a dash as "-".
    const noHyphen = normalizeText('a — b', (char) => char !== '-' && canWrite(char));
    expect(noHyphen.text).toBe('a — b');
    expect(noHyphen.unsupported).toEqual([{ char: '—', count: 1, kind: 'symbol' }]);
    // A bank that does have an accented letter keeps it.
    const withAccent = normalizeText('café', (char) => char === 'é' || canWrite(char));
    expect(withAccent).toEqual({ text: 'café', replaced: [], unsupported: [] });
  });
});

describe('describeProblems', () => {
  it('gives one clear sentence per problem', () => {
    expect(describeProblems(clean('Hi \u{1F600}\u{1F600} ≤ café “ok”'))).toEqual([
      '"\u{1F600}" (emoji) appears 2 times and cannot be written in your handwriting. A gap will be left.',
      '"≤" (math symbol) appears once and cannot be written in your handwriting. A gap will be left.',
      '"é" appears once and will be written as "e".',
    ]);
  });

  it('says nothing when everything can be written faithfully', () => {
    expect(describeProblems(clean('All “fine” here – really.'))).toEqual([]);
  });
});
