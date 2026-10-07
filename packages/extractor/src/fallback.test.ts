import { buildGlyphBank, checkCoverage, pathBounds, REQUIRED_CHARS } from '@pentwin/engine';
import { describe, expect, it } from 'vitest';
import { extractGlyphBank, type ExtractedBank } from './extract';
import { applyFallbacks } from './fallback';
import { renderSamplePage, SAMPLE_TEXT, toRgba } from './testing';

const full = extractGlyphBank(toRgba(renderSamplePage().gray), SAMPLE_TEXT).bank!;

/** A copy of the extracted bank with some characters removed or cut down. */
const without = (remove: string, keepOne = ''): ExtractedBank => {
  const metadata = structuredClone(full.metadata);
  for (const char of remove) delete metadata.glyphs[char];
  for (const char of keepOne) metadata.glyphs[char] = metadata.glyphs[char]!.slice(0, 1);
  return { metadata, files: { ...full.files } };
};
const load = (bank: ExtractedBank) => buildGlyphBank(bank.metadata, (file) => bank.files[file]!);

describe('applyFallbacks', { timeout: 120_000 }, () => {
  const damaged = without('COSVWXZ0:;(', 'aeg');
  const result = applyFallbacks(damaged);
  const bank = load(result.bank);

  it('completes a bank with deliberately missing letters', () => {
    for (const char of 'COSVWXZ0:;(') expect(bank.glyphs.get(char)?.length).toBeGreaterThan(0);
    for (const char of 'aeg') expect(bank.glyphs.get(char)).toHaveLength(3);
    // What is left has no sound recipe and must be written by the user.
    expect(checkCoverage(bank, 1).missing.sort()).toEqual(['#', '%', '*', '@']);
    expect(result.topUp.required.sort()).toEqual(['#', '%', '*', '@']);
  });

  it('flags every glyph it added, in the bank and in the report', () => {
    const marked = [...bank.glyphs.values()].flat().filter((g) => g.derivedFrom);
    expect(marked).toHaveLength(result.derived.length);
    expect(marked.length).toBeGreaterThan(20);
    for (const glyph of marked) expect(glyph.derivedFrom).toMatch(/\S/);
    // And nothing unmarked appeared: unmarked glyphs are exactly the ones we started with.
    const unmarked = [...bank.glyphs.values()].flat().filter((g) => !g.derivedFrom).length;
    const before = Object.values(damaged.metadata.glyphs).flat().length;
    expect(unmarked).toBe(before);
  });

  it('says how each character was made', () => {
    const how = (char: string) => result.derived.find((d) => d.char === char);
    expect(how('C')).toEqual({ char: 'C', method: 'transformed', from: '"c" written larger' });
    expect(how(':')).toMatchObject({ method: 'transformed', from: 'two "." one above the other' });
    expect(how('(')).toMatchObject({ method: 'transformed', from: '")" mirrored' });
    expect(how('a')).toMatchObject({ method: 'reused' });
    expect(result.topUp.recommended).toEqual(expect.arrayContaining(['C', '0', ':', '(']));
    expect(result.topUp.recommended).not.toContain('a');
  });

  it('builds sensible shapes', () => {
    const height = (char: string): number => {
      const b = pathBounds(bank.glyphs.get(char)![0]!.path);
      return b.maxY - b.minY;
    };
    const { xHeight, capHeight } = bank;
    // A capital made from a lowercase letter is cap height; it sits on the baseline.
    expect(height('C') / capHeight).toBeGreaterThan(0.85);
    expect(height('C') / capHeight).toBeLessThan(1.25);
    expect(pathBounds(bank.glyphs.get('O')![0]!.path).maxY).toBeLessThan(xHeight * 0.15);
    // A colon is two dots, clearly taller than one.
    expect(height(':')).toBeGreaterThan(height('.') * 2.5);
    // "=" and "+" come from the dash.
    expect(height('=')).toBeGreaterThan(height('-') * 2);
    expect(height('+')).toBeGreaterThan(height('-') * 2);
    // A mirrored bracket keeps its size.
    expect(height('(')).toBeCloseTo(height(')'), 0);
  });

  it('prefers the user own writing: nothing is derived when the bank is complete', () => {
    const complete = applyFallbacks(full, [...'abc']);
    expect(complete.derived).toEqual([]);
    expect(complete.topUp).toEqual({ required: [], recommended: [] });
  });

  it('never builds from glyphs that were themselves derived', () => {
    // "O" is missing and so is "o": "0" could only come from a derived "O", so it must not.
    const result2 = applyFallbacks(without('Oo0'));
    expect(result2.topUp.required).toEqual(expect.arrayContaining(['O', 'o', '0']));
  });

  it('leaves the input bank untouched', () => {
    const before = JSON.stringify(damaged);
    applyFallbacks(damaged);
    expect(JSON.stringify(damaged)).toBe(before);
    expect(REQUIRED_CHARS.length).toBeGreaterThan(80);
  });
});
