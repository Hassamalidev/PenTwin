import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { REQUIRED_CHARS } from '@pentwin/engine';
import { describe, expect, it } from 'vitest';
import { checkSampleText, type SampleText } from './sample-text';

const sample = JSON.parse(
  readFileSync(fileURLToPath(new URL('../../../docs/sample-text.json', import.meta.url)), 'utf8'),
) as SampleText;

describe('docs/sample-text.json', () => {
  const coverage = checkSampleText(sample);

  it('meets every coverage target', () => {
    expect(coverage.failures).toEqual([]);
  });

  it('fits on one or two handwritten pages', () => {
    expect(coverage.wordCount).toBeGreaterThan(100);
    expect(coverage.wordCount).toBeLessThan(260);
  });

  it('uses only plain characters a pen sample can be matched against', () => {
    for (const char of Object.keys(coverage.counts)) expect(char).toMatch(/^[\x21-\x7e]$/);
  });

  it('reports which engine characters the sample cannot supply', () => {
    const absent = REQUIRED_CHARS.filter((char) => !coverage.counts[char]);
    expect(absent.sort()).toEqual(['#', '%', '*', '+', '=', '@']);
  });
});

describe('checkSampleText', () => {
  it('lists every missed target', () => {
    const { failures } = checkSampleText({
      ...sample,
      paragraphs: ['The quick brown fox.'],
      targets: {
        lowercaseMin: 1,
        uppercaseMin: 0,
        digitMin: 1,
        punctuation: '.!',
        pairs: ['th', 'ck'],
      },
    });
    expect(failures).toContain('lowercase "a" appears 0 times, needs 1');
    expect(failures).toContain('digit "0" appears 0 times, needs 1');
    expect(failures).toContain('punctuation "!" appears 0 times, needs 1');
    expect(failures).toContain('pair "th" does not appear');
    expect(failures.some((f) => f.includes('"q"') || f.includes('"."') || f.includes('"ck"'))).toBe(
      false,
    );
  });
});
