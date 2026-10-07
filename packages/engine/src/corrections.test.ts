import { createRng } from '@pentwin/shared';
import { describe, expect, it } from 'vitest';
import { addCorrections, canCorrect, readMarkers, RETRACE, STRUCK } from './corrections';
import { PRESETS } from './presets';
import { renderText } from './render';
import { sceneToSvg } from './svg';
import { loadSampleBank } from './testing';

const bank = loadSampleBank();

// Ordinary prose mixed with everything that must never be altered.
const text = [
  'Dr. Ahmed Khan paid $1,250.75 on 03/14/2025 for 12 books, and the receipt number was 48-A/7791.',
  'Solve x=2y+3 when y=4; the answer is 11. Then write to ali.raza@example.com about ISBN 978-3-16.',
  'the weather was pleasant through most of that long afternoon, although several people wondered',
  'whether another storm might arrive before evening and spoil their carefully planned outing.',
].join('\n');

const words = (s: string): string[] => s.split(/\s+/).filter(Boolean);
const plan = (rate: number, seed = 1) => addCorrections(text, rate, createRng(seed));

describe('canCorrect', () => {
  it('allows only plain lowercase words of four letters or more', () => {
    for (const word of ['weather', 'that', 'afternoon,', 'outing.'])
      expect(canCorrect(word)).toBe(true);
    for (const word of [
      'the', // too short
      'Ahmed', // a name
      'Then', // capitalised
      '$1,250.75',
      '03/14/2025',
      '12',
      '48-A/7791.',
      'x=2y+3',
      'y=4;',
      'ali.raza@example.com',
      'ISBN',
      '978-3-16.',
      "don't",
      'well-known',
      '(maybe)',
    ]) {
      expect(canCorrect(word)).toBe(false);
    }
  });
});

describe('addCorrections', () => {
  it('returns the text untouched at rate 0', () => {
    expect(plan(0)).toEqual({ text, counts: { struck: 0, retraced: 0 } });
  });

  it.each([0.05, 0.3, 1])('keeps every original word, in order, at rate %s', (rate) => {
    for (let seed = 0; seed < 20; seed++) {
      const result = plan(rate, seed);
      const kept = words(result.text)
        .filter((w) => !w.startsWith(STRUCK))
        .map((w) => w.replace(RETRACE, ''));
      expect(kept).toEqual(words(text));
      // Line breaks survive too.
      expect(result.text.split('\n')).toHaveLength(text.split('\n').length);
    }
  });

  it('never touches a protected word, however high the rate', () => {
    for (let seed = 0; seed < 20; seed++) {
      const out = words(plan(1, seed).text);
      out.forEach((word, i) => {
        const marked = word.includes(RETRACE) || out[i - 1]?.startsWith(STRUCK);
        if (marked) expect(canCorrect(word.replace(RETRACE, ''))).toBe(true);
      });
    }
  });

  it('strikes a slip that is not the word itself, made only of its letters', () => {
    const out = words(plan(1, 3).text);
    const slips = out.flatMap((word, i) =>
      word.startsWith(STRUCK) ? [[word.slice(1), out[i + 1]!]] : [],
    );
    expect(slips.length).toBeGreaterThan(3);
    for (const [slip, right] of slips) {
      const letters = right!.replace(RETRACE, '').replace(/[^a-z]/g, '');
      expect(slip).not.toBe(letters);
      expect(slip!.length).toBeLessThanOrEqual(letters.length);
      for (const char of slip!) expect(letters).toContain(char);
    }
  });

  it('never puts two corrections side by side', () => {
    const out = words(plan(1, 5).text);
    let previous = false;
    for (const word of out) {
      if (word.startsWith(STRUCK)) continue;
      const corrected = word.includes(RETRACE) || out[out.indexOf(word) - 1]?.startsWith(STRUCK);
      expect(previous && corrected).toBeFalsy();
      previous = Boolean(corrected);
    }
  });

  it('corrects about as often as asked', () => {
    const long = `${text}\n`.repeat(40);
    const eligible = words(long).filter(canCorrect).length;
    const { counts } = addCorrections(long, 0.03, createRng(9));
    expect(counts.struck / eligible).toBeGreaterThan(0.01);
    expect(counts.struck / eligible).toBeLessThan(0.06);
    expect(counts.retraced / eligible).toBeGreaterThan(0.01);
    expect(counts.retraced / eligible).toBeLessThan(0.06);
  });

  it('reads its own markers back', () => {
    expect(readMarkers('plain')).toEqual({ text: 'plain', struck: false });
    expect(readMarkers(`${STRUCK}teh`)).toEqual({ text: 'teh', struck: true });
    expect(readMarkers(`wea${RETRACE}ther,`)).toEqual({
      text: 'weather,',
      struck: false,
      retrace: 3,
    });
  });
});

describe('corrections in rendering', { timeout: 120_000 }, () => {
  const render = (corrections?: number, seed = 'c') =>
    renderText(text, bank, { seed, jitter: PRESETS.normal, corrections });

  it('changes nothing when off', () => {
    expect(render().corrections).toEqual({ struck: 0, retraced: 0 });
    expect(sceneToSvg(render(0).pages[0]!)).toBe(sceneToSvg(render().pages[0]!));
  });

  it('writes exactly the original text once the corrections are set aside', () => {
    for (const seed of ['a', 'b', 'c', 'd']) {
      const { pages, corrections } = render(0.4, seed);
      const strokes = pages.flatMap((page) => page.strokes);
      const written = strokes
        .filter((s) => !s.struck && !s.retrace)
        .map((s) => s.char)
        .join('');
      expect(written).toBe(text.replace(/\s+/g, ''));
      expect(corrections.struck).toBeGreaterThan(1);
      expect(corrections.retraced).toBeGreaterThan(0);
      expect(strokes.filter((s) => s.retrace)).toHaveLength(corrections.retraced);
    }
  });

  it('draws a line through each struck word, and only those', () => {
    const { pages, corrections } = render(1);
    const strokes = pages.flatMap((page) => page.strokes);
    const lines = strokes.filter((s) => s.struck && s.char === '');
    // One or two passes of the pen per struck word.
    expect(lines.length).toBeGreaterThanOrEqual(corrections.struck);
    expect(lines.length).toBeLessThanOrEqual(corrections.struck * 2);
    for (const line of lines) {
      expect(line.mode).toBe('stroke');
      const [start, end] = line.path as unknown as { x: number; y: number }[];
      expect(end!.x - start!.x).toBeGreaterThan(3); // mm: spans a word
      expect(Math.abs(end!.y - start!.y)).toBeLessThan(1.5); // roughly level
    }
  });

  it('adds very few at a realistic rate', () => {
    const long = renderText(`${text}\n`.repeat(6), bank, { seed: 'r', corrections: 0.02 });
    const total = long.corrections.struck + long.corrections.retraced;
    expect(total).toBeGreaterThan(0);
    expect(total).toBeLessThan(15);
  });

  it('is reproducible', () => {
    expect(sceneToSvg(render(0.3).pages[0]!)).toBe(sceneToSvg(render(0.3).pages[0]!));
  });
});
