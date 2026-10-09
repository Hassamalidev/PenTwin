import { describe, expect, it } from 'vitest';
import { NO_JITTER, type JitterParams } from './jitter';
import { pathBounds } from './path';
import { PRESETS } from './presets';
import { renderText } from './render';
import { sceneToSvg } from './svg';
import { loadSampleBank } from './testing';

/**
 * Word bounce, line ride and stroke pressure: the habits that make writing step up and
 * down and vary in weight, the way a hand does.
 */
const bank = loadSampleBank();
const base = { seed: 'habits', pageSize: 'A5', lineHeight: 10, xHeight: 4 } as const;
const page = (text: string, jitter: JitterParams) =>
  renderText(text, bank, { ...base, jitter }).pages[0]!;
const bottoms = (text: string, jitter: JitterParams): number[] =>
  page(text, jitter).strokes.map((stroke) => pathBounds(stroke.path).maxY);
const spread = (values: number[]): number => Math.max(...values) - Math.min(...values);

describe('off unless asked for', () => {
  it('leaves the page exactly as it was when the habits are left out or set to zero', () => {
    const text = 'The quick brown fox jumps over the lazy dog, twice.';
    const without = { ...PRESETS.rushed };
    delete without.wordBounce;
    delete without.lineRide;
    delete without.pressure;
    const zeroed = { ...without, wordBounce: 0, lineRide: 0, pressure: 0 };
    expect(sceneToSvg(page(text, zeroed))).toBe(sceneToSvg(page(text, without)));
  });

  it('never changes which letters are picked or where along the line they sit', () => {
    const text = 'never change the letters or the spacing';
    const lefts = (jitter: JitterParams): number[] =>
      page(text, jitter).strokes.map((stroke) => pathBounds(stroke.path).minX);
    const plain = lefts(NO_JITTER);
    const lively = lefts({ ...NO_JITTER, wordBounce: 0.3, lineRide: 0.3 });
    expect(lively).toHaveLength(plain.length);
    // Word bounce also resizes a word a little, so allow a fraction of a millimetre.
    lively.forEach((x, index) => expect(Math.abs(x - plain[index]!)).toBeLessThan(0.4));
  });
});

describe('word bounce', () => {
  it('lands each word at its own height, with the letters of a word together', () => {
    const still = bottoms('xx xx xx xx xx', NO_JITTER);
    expect(spread(still)).toBeLessThan(0.1);

    const moved = bottoms('xx xx xx xx xx', { ...NO_JITTER, wordBounce: 0.3 });
    expect(moved).toHaveLength(10);
    const words = [0, 1, 2, 3, 4].map((word) => moved.slice(word * 2, word * 2 + 2));
    // Inside a word the letters stay level with each other...
    for (const word of words) expect(spread(word)).toBeLessThan(0.25);
    // ...while the words themselves sit at clearly different heights,
    const heights = words.map((word) => word.reduce((sum, y) => sum + y, 0) / word.length);
    expect(spread(heights)).toBeGreaterThan(0.3);
    // but never more than the setting allows: 0.3 of a 4 mm x-height.
    expect(spread(heights)).toBeLessThan(2 * 0.3 * 4 + 0.3);
  });

  it('is repeatable for a seed', () => {
    const jitter = { ...NO_JITTER, wordBounce: 0.2, lineRide: 0.2, pressure: 0.2 };
    expect(sceneToSvg(page('same seed, same page', jitter))).toBe(
      sceneToSvg(page('same seed, same page', jitter)),
    );
  });
});

describe('line ride', () => {
  it('moves whole lines off their ruling by different amounts', () => {
    const text = Array.from({ length: 8 }, () => 'xxxx xxxx xxxx').join('\n');
    const scene = page(text, { ...NO_JITTER, lineRide: 0.3 });
    const offsets = scene.baselines.map((baseline) => {
      const onLine = scene.strokes
        .map((stroke) => pathBounds(stroke.path).maxY)
        .filter((y) => Math.abs(y - baseline) < 4);
      // Every letter on the line is off by the same amount: the line moved as one.
      expect(spread(onLine)).toBeLessThan(0.15);
      return onLine[0]! - baseline;
    });
    expect(spread(offsets)).toBeGreaterThan(0.3);
    for (const offset of offsets) expect(Math.abs(offset)).toBeLessThanOrEqual(0.3 * 4 + 0.1);
    // Some ride above the line and some below.
    expect(Math.min(...offsets)).toBeLessThan(0);
    expect(Math.max(...offsets)).toBeGreaterThan(0);
  });
});

describe('stroke pressure', () => {
  const text = 'kxk tfk xkx ktf kkk xxx';

  it('gives the strokes of a letter different weights, within the setting', () => {
    const even = page(text, NO_JITTER).strokes;
    expect(new Set(even.map((stroke) => stroke.width)).size).toBe(1);
    const penWidth = even[0]!.width;

    const pressed = page(text, { ...NO_JITTER, pressure: 0.3 }).strokes;
    // A letter made of two pen strokes is now two strokes of ink.
    expect(pressed.length).toBeGreaterThan(even.length);
    const widths = pressed.map((stroke) => stroke.width / penWidth);
    expect(new Set(widths.map((w) => w.toFixed(3))).size).toBeGreaterThan(3);
    for (const width of widths) {
      expect(width).toBeGreaterThan(1 - 0.3 - 0.05);
      // The start of a word can be heavier still, by half the setting.
      expect(width).toBeLessThan(1 + 0.3 * 1.5 + 0.05);
    }
  });

  it('keeps every bit of the letters: only the weight changes', () => {
    const commands = (jitter: JitterParams): number =>
      page(text, jitter).strokes.reduce((sum, stroke) => sum + stroke.path.length, 0);
    expect(commands({ ...NO_JITTER, pressure: 0.3 })).toBe(commands(NO_JITTER));
  });

  it('uses a limited number of weights, so a page still draws quickly', () => {
    const long = Array.from({ length: 40 }, () => text).join(' ');
    const strokes = page(long, { ...NO_JITTER, pressure: 0.3 }).strokes;
    expect(new Set(strokes.map((stroke) => stroke.width.toFixed(4))).size).toBeLessThanOrEqual(16);
  });
});

describe('all together', () => {
  it('works with tiredness and corrections in every style', () => {
    const text = Array.from(
      { length: 30 },
      () => 'Writing changes as the hand tires and the page fills up.',
    ).join(' ');
    for (const preset of Object.values(PRESETS)) {
      const { pages } = renderText(text, bank, {
        seed: 'together',
        pageSize: 'A5',
        jitter: preset,
        corrections: 0.05,
      });
      for (const scene of pages) {
        for (const stroke of scene.strokes) {
          const b = pathBounds(stroke.path);
          expect(Number.isFinite(b.minX + b.maxX + b.minY + b.maxY)).toBe(true);
          expect(stroke.width).toBeGreaterThanOrEqual(0);
        }
      }
    }
  });

  it('gives a hurried hand more of each habit than a careful one', () => {
    for (const habit of ['wordBounce', 'lineRide', 'pressure'] as const) {
      expect(PRESETS.neat[habit]!).toBeLessThan(PRESETS.normal[habit]!);
      expect(PRESETS.normal[habit]!).toBeLessThan(PRESETS.rushed[habit]!);
    }
  });
});
