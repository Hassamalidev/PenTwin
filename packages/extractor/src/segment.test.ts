import { PRESETS } from '@pentwin/engine';
import { describe, expect, it } from 'vitest';
import { cleanImage } from './clean';
import type { BinaryImage } from './image';
import { segmentPage } from './segment';
import { CONDITIONS, degrade, renderSamplePage, toRgba } from './testing';

const page = renderSamplePage();
const wordsOn = (binary: BinaryImage): number =>
  segmentPage(binary).lines.reduce((sum, line) => sum + line.words.length, 0);

describe('segmentPage', { timeout: 120_000 }, () => {
  it.each(Object.keys(CONDITIONS))('finds the lines and words of a %s photo', (name) => {
    const { binary } = cleanImage(toRgba(degrade(page.gray, CONDITIONS[name]!)));
    const { lines } = segmentPage(binary);
    expect(lines).toHaveLength(page.lineCount);
    // Within 3%: an occasional wide gap inside a word, or a narrow one between two.
    expect(Math.abs(wordsOn(binary) - page.wordCount)).toBeLessThanOrEqual(page.wordCount * 0.03);
  });

  it.each(['neat', 'rushed'] as const)('copes with %s writing', (preset) => {
    const other = renderSamplePage({ jitter: PRESETS[preset], seed: preset });
    const { binary } = cleanImage(toRgba(degrade(other.gray, CONDITIONS.good!)));
    expect(segmentPage(binary).lines).toHaveLength(other.lineCount);
    expect(Math.abs(wordsOn(binary) - other.wordCount)).toBeLessThanOrEqual(other.wordCount * 0.04);
  });

  it('finds a line that holds a single short word', () => {
    const short = renderSamplePage({
      text: 'The quick brown fox jumps over the lazy dog.\nno\nThe end of it.',
    });
    const { binary } = cleanImage(toRgba(short.gray));
    const { lines } = segmentPage(binary);
    expect(lines.map((line) => line.words.length)).toEqual([9, 1, 4]);
  });

  it('keeps lines in reading order with words left to right', () => {
    const { binary } = cleanImage(toRgba(page.gray));
    const { lines } = segmentPage(binary);
    for (let i = 1; i < lines.length; i++) {
      expect(lines[i]!.top).toBeGreaterThan(lines[i - 1]!.bottom);
    }
    for (const line of lines) {
      for (let w = 1; w < line.words.length; w++) {
        expect(line.words[w]!.x0).toBeGreaterThan(line.words[w - 1]!.x1);
      }
    }
  });

  it('joins a dot to its letter but keeps neighbouring letters apart', () => {
    const dots = renderSamplePage({ text: 'jiij: i; i! i?', jitter: PRESETS.neat });
    const { binary } = cleanImage(toRgba(dots.gray));
    const [line] = segmentPage(binary).lines;
    expect(line!.words.map((w) => w.segments.length)).toEqual([5, 2, 2, 2]);
    expect(line!.words[0]!.segments[0]!.componentIds).toHaveLength(2);
  });

  it('returns nothing for a blank page', () => {
    const blank = { width: 400, height: 300, data: new Uint8Array(400 * 300) };
    expect(segmentPage(blank).lines).toEqual([]);
  });
});
