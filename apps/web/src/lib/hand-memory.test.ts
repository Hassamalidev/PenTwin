import { describe, expect, it } from 'vitest';
import { learnFromAnswer, NEW_HAND } from './hand-memory';
import { DEFAULT_SETTINGS, toRenderOptions } from './settings';

describe('learning a writer from their answers', () => {
  it('moves the right way, and "looks right" changes nothing but its confidence', () => {
    expect(learnFromAnswer(NEW_HAND, 'too-neat').scale).toBeGreaterThan(1);
    expect(learnFromAnswer(NEW_HAND, 'too-messy').scale).toBeLessThan(1);
    const right = learnFromAnswer(NEW_HAND, 'right');
    expect(right.scale).toBe(1);
    expect(right.answers).toBe(1);
  });

  it('takes smaller steps as it learns, so it settles', () => {
    const first = learnFromAnswer(NEW_HAND, 'too-neat');
    const second = learnFromAnswer(first, 'too-neat');
    expect(second.scale / first.scale).toBeLessThan(first.scale / NEW_HAND.scale);
  });

  it('settles between two opposite answers instead of swinging', () => {
    let memory = NEW_HAND;
    for (let i = 0; i < 40; i++) {
      memory = learnFromAnswer(memory, i % 2 === 0 ? 'too-neat' : 'too-messy');
    }
    expect(memory.scale).toBeGreaterThan(0.9);
    expect(memory.scale).toBeLessThan(1.15);
  });

  it('stays within its limits however often it is told the same thing', () => {
    let memory = NEW_HAND;
    for (let i = 0; i < 500; i++) memory = learnFromAnswer(memory, 'too-neat');
    expect(memory.scale).toBeLessThanOrEqual(1.8);
  });

  it('reaches the page through the render settings', () => {
    const plain = toRenderOptions(DEFAULT_SETTINGS);
    const looser = toRenderOptions(DEFAULT_SETTINGS, { ...NEW_HAND, scale: 1.5 });
    expect(looser.jitter!.baselineDrift).toBeGreaterThan(plain.jitter!.baselineDrift);
  });

  it("uses the writer's own measured style, and adds no lean to their letters", () => {
    const style = {
      slant: 5,
      strokeWidth: 0.1,
      xHeightRatio: 0.5,
      roundness: 0.5,
      letterWidth: 0.7,
      sizeVariation: 0.03,
      baselineWobble: 0.03,
      slantVariation: 2,
      spacingVariation: 0.05,
    };
    const tuned = toRenderOptions(DEFAULT_SETTINGS, { ...NEW_HAND, style });
    expect(tuned.jitter!.slant).toBe(0);
    expect(tuned.jitter!.wordGapScale).toBe(1);
  });
});
