import { PRESETS } from '@pentwin/engine';
import { describe, expect, it } from 'vitest';
import {
  CONDITIONS,
  degrade,
  extractLabels,
  renderSamplePage,
  SAMPLE_TEXT,
  scoreAlignment,
} from './testing';

const page = renderSamplePage();

describe('alignToText', { timeout: 180_000 }, () => {
  it.each(Object.keys(CONDITIONS))('labels at least 90%% of a %s photo correctly', (name) => {
    const { alignment } = extractLabels(degrade(page.gray, CONDITIONS[name]!));
    const score = scoreAlignment(alignment.glyphs, page.truth);
    expect(alignment.expectedChars).toBe(page.truth.length);
    expect(score.correct).toBeGreaterThanOrEqual(0.9);
    expect(score.wrong).toBeLessThanOrEqual(0.01);
  });

  it('flags what it cannot place instead of guessing', () => {
    // Letters pushed together until many of them touch.
    const tight = renderSamplePage({ jitter: { ...PRESETS.normal, tracking: -0.12 }, seed: 't' });
    const { alignment } = extractLabels(degrade(tight.gray, CONDITIONS.good!));
    const score = scoreAlignment(alignment.glyphs, tight.truth);
    expect(alignment.flagged.length).toBeGreaterThan(3);
    expect(alignment.flagged.every((f) => f.reason === 'letters-joined')).toBe(true);
    // Much more is left out than on a clean page, but very little is labeled wrongly.
    expect(score.unlabeled).toBeGreaterThan(0.02);
    expect(score.wrong).toBeLessThanOrEqual(0.01);
    expect(score.correct).toBeGreaterThanOrEqual(0.9);
  });

  it('recovers after a word that is missing from the page', () => {
    // The writer skipped "brown": everything after it must still line up.
    const skipped = renderSamplePage({ text: SAMPLE_TEXT.replace('quick brown fox', 'quick fox') });
    const { alignment } = extractLabels(skipped.gray);
    const score = scoreAlignment(alignment.glyphs, skipped.truth);
    expect(alignment.flagged).toContainEqual({ expected: 'brown', line: -1, reason: 'not-found' });
    expect(score.correct).toBeGreaterThanOrEqual(0.9);
    expect(score.wrong).toBeLessThanOrEqual(0.01);
  });

  it('recovers after an extra word on the page', () => {
    const extra = renderSamplePage({
      text: SAMPLE_TEXT.replace('the lazy dog', 'the very lazy dog'),
    });
    const { alignment } = extractLabels(extra.gray);
    const score = scoreAlignment(alignment.glyphs, extra.truth);
    // The four letters of "very" have no place in the expected text.
    expect(score.correct).toBeGreaterThanOrEqual(0.9);
    expect(score.wrong).toBeLessThanOrEqual(0.02);
  });

  it('joins the two ticks of a double quote into one glyph', () => {
    const { alignment } = extractLabels(page.gray);
    const quotes = alignment.glyphs.filter((g) => g.char === '"');
    expect(quotes).toHaveLength(2);
    for (const quote of quotes) {
      expect(quote.cut).toBe('merged');
      expect(quote.componentIds).toHaveLength(2);
    }
  });
});
