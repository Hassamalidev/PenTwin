import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { pathBounds } from './path';
import { renderText, type RenderOptions } from './render';
import { sceneToSvg } from './svg';
import { loadSampleBank, repoPath } from './testing';

const bank = loadSampleBank();
const sample = readFileSync(repoPath('tests/sample.txt'), 'utf8');
const options: RenderOptions = { seed: 'golden', pageSize: 'A5' };

describe('renderText', () => {
  it('matches the golden SVG page for tests/sample.txt', async () => {
    const { pages, report } = renderText(sample, bank, options);
    expect(pages).toHaveLength(1);
    expect(report.unknownChars).toEqual({});
    await expect(sceneToSvg(pages[0]!)).toMatchFileSnapshot(
      repoPath('tests/golden/sample-page-1.svg'),
    );
  });

  it('is reproducible for a seed and differs between seeds', () => {
    const svg = (seed: string) =>
      sceneToSvg(renderText(sample, bank, { ...options, seed }).pages[0]!);
    expect(svg('a')).toBe(svg('a'));
    expect(svg('a')).not.toBe(svg('b'));
  });

  it('sits glyphs on the baseline, inside the margins', () => {
    const { pages } = renderText('xxxx xxxx', bank, { seed: 1, lineHeight: 10, xHeight: 4 });
    const page = pages[0]!;
    expect(page.baselines).toEqual([30]);
    for (const stroke of page.strokes) {
      const b = pathBounds(stroke.path);
      expect(b.maxY).toBeCloseTo(30, 0);
      expect(b.minY).toBeCloseTo(26, 0);
      expect(b.minX).toBeGreaterThanOrEqual(20);
    }
  });

  it('advances the pen by each glyph and leaves a wider gap between words', () => {
    const { pages } = renderText('nn n', bank, { seed: 1 });
    const [a, b, c] = pages[0]!.strokes.map((s) => pathBounds(s.path).minX);
    expect(b! - a!).toBeGreaterThan(0);
    expect(c! - b!).toBeGreaterThan((b! - a!) * 1.4);
  });

  it('reports unknown characters and leaves a gap instead of crashing', () => {
    const { pages, report } = renderText('aé\u{1F600}éb', bank, { seed: 1 });
    expect(report.unknownChars).toEqual({ é: 2, '\u{1F600}': 1 });
    expect(report.glyphCount).toBe(2);
    const [a, b] = pages[0]!.strokes.map((s) => pathBounds(s.path).minX);
    const known = renderText('ab', bank, { seed: 1 }).pages[0]!.strokes;
    expect(b! - a!).toBeGreaterThan(pathBounds(known[1]!.path).minX - a!);
  });

  it('handles empty text and paginates long text', () => {
    expect(renderText('', bank, { seed: 1 }).pages).toHaveLength(1);
    const long = renderText(`${sample}\n`.repeat(12), bank, options);
    expect(long.pages.length).toBeGreaterThan(1);
    expect(long.report.pageCount).toBe(long.pages.length);
  });

  it('keeps lines inside the right margin', () => {
    const { pages } = renderText(sample.repeat(3), bank, options);
    for (const stroke of pages[0]!.strokes) {
      expect(pathBounds(stroke.path).maxX).toBeLessThanOrEqual(pages[0]!.width - 20 + 1);
    }
  });
});
