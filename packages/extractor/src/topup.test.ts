import { buildGlyphBank, checkCoverage } from '@pentwin/engine';
import { PDFDocument } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { extractGlyphBank, type ExtractedBank } from './extract';
import { applyFallbacks } from './fallback';
import { renderSamplePage, SAMPLE_TEXT, toRgba } from './testing';
import { buildTopUpSheet, extractTopUp, mergeTopUp, topUpText } from './topup';

const load = (bank: ExtractedBank) => buildGlyphBank(bank.metadata, (file) => bank.files[file]!);

describe('top-up sheet', () => {
  it('asks for each character several times, with an anchor word on every line', () => {
    expect(topUpText(['#', '@', '*'])).toBe('none #### @@@@ ****');
    expect(topUpText([...'abcdefg'], 2, 3).split('\n')).toEqual([
      'none aa bb cc',
      'none dd ee ff',
      'none gg',
    ]);
  });

  it('builds a one-page PDF', async () => {
    const doc = await PDFDocument.load(await buildTopUpSheet(['#', '@', '*', '+', '=']));
    expect(doc.getPageCount()).toBe(1);
  });
});

describe('top-up flow', { timeout: 180_000 }, () => {
  // The first sample, with its gaps filled by the fallback chain.
  const first = extractGlyphBank(toRgba(renderSamplePage().gray), SAMPLE_TEXT).bank!;
  const { bank: base, topUp: wanted } = applyFallbacks(first);
  // "%" is three separate marks and cannot be cut reliably yet, so it is not asked for here.
  const chars = [...wanted.required.filter((c) => c !== '%'), ...wanted.recommended];

  // The user writes the top-up sheet and photographs it.
  const page = renderSamplePage({ text: topUpText(chars), seed: 'top-up' });
  const extraction = extractTopUp(toRgba(page.gray), chars);

  it('wants the characters the first sample could not supply', () => {
    expect(wanted.required.sort()).toEqual(['#', '%', '*', '@']);
    expect(wanted.recommended.sort()).toEqual(['+', '=']);
  });

  it('extracts the top-up characters from a nearly empty page', () => {
    expect(extraction.quality.issues.map((i) => i.code)).toEqual(['no-writing']);
    expect(extraction.bank).toBeDefined();
    for (const char of chars) {
      expect(extraction.bank!.metadata.glyphs[char]?.length).toBeGreaterThanOrEqual(3);
    }
  });

  it('improves coverage when merged', () => {
    const merged = mergeTopUp(base, extraction.bank!, chars);
    const before = checkCoverage(load(base));
    const after = checkCoverage(load(merged.bank));
    expect(before.missing.sort()).toEqual(['#', '%', '*', '@']);
    expect(after.missing).toEqual(['%']);
    expect(after.weak.length).toBeLessThanOrEqual(before.weak.length);
    for (const char of ['#', '@', '*']) expect(merged.added[char]).toBeGreaterThanOrEqual(3);
  });

  it('swaps derived stand-ins for the handwritten glyphs', () => {
    const merged = mergeTopUp(base, extraction.bank!, chars);
    expect(base.metadata.glyphs['+']!.every((v) => v.derivedFrom)).toBe(true);
    expect(merged.replaced['+']).toBe(base.metadata.glyphs['+']!.length);
    expect(merged.bank.metadata.glyphs['+']!.some((v) => v.derivedFrom)).toBe(false);
    expect(merged.bank.metadata.glyphs['=']!.some((v) => v.derivedFrom)).toBe(false);
  });

  it('never overwrites a glyph the user already wrote', () => {
    // Offer new "a" glyphs for a character that is already full.
    const again = extractGlyphBank(
      toRgba(renderSamplePage({ seed: 'second' }).gray),
      SAMPLE_TEXT,
    ).bank!;
    const merged = mergeTopUp(base, again, ['a', 'Q']);
    const own = (bank: ExtractedBank, char: string) =>
      bank.metadata.glyphs[char]!.filter((v) => !v.derivedFrom);

    // "a" already had the maximum: nothing changes.
    expect(merged.bank.metadata.glyphs.a).toEqual(base.metadata.glyphs.a);
    expect(merged.added.a).toBeUndefined();
    // "Q" had two handwritten variants: both are kept, new ones are added after them.
    expect(own(merged.bank, 'Q').slice(0, 2)).toEqual(own(base, 'Q'));
    expect(own(merged.bank, 'Q').length).toBeGreaterThan(2);
    for (const variant of own(base, 'Q')) {
      expect(merged.bank.files[variant.file]).toBe(base.files[variant.file]);
    }
    // Characters that were not asked for are left alone, even though the photo had them.
    expect(merged.bank.metadata.glyphs.b).toEqual(base.metadata.glyphs.b);
  });

  it('leaves both inputs untouched and rejects mismatched banks', () => {
    const snapshot = JSON.stringify(base);
    mergeTopUp(base, extraction.bank!, chars);
    expect(JSON.stringify(base)).toBe(snapshot);
    const other = structuredClone(extraction.bank!);
    other.metadata.xHeight = 50;
    expect(() => mergeTopUp(base, other, chars)).toThrow(/different glyph units/);
  });
});
