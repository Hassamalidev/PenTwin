import { wholeLetters } from './writer';
import { describe, expect, it } from 'vitest';
import { applyEffects } from './effects';
import { INKS } from './ink';
import { sceneToPixels } from './node/png';
import { pathBounds } from './path';
import { presetOptions, PRESETS, type PresetName } from './presets';
import { renderText } from './render';
import { sceneToSvg } from './svg';
import { loadSampleBank } from './testing';

const bank = loadSampleBank();
const names = Object.keys(PRESETS) as PresetName[];
const text = 'the weather was pleasant through most of that long afternoon. '.repeat(40);
const render = (name: PresetName) => renderText(text, bank, { seed: 'v2', ...presetOptions(name) });

describe('presets v2', { timeout: 120_000 }, () => {
  it('offers five presets', () => {
    expect(names.sort()).toEqual(['exam', 'lecture', 'neat', 'normal', 'rushed']);
  });

  it('gives each a complete bundle: hand, pen, paper and slips', () => {
    for (const name of names) {
      const bundle = presetOptions(name);
      expect(bundle.jitter).toBe(PRESETS[name]);
      expect(INKS[bundle.ink]).toBeDefined();
      expect(bundle.paper.kind).toBe('ruled');
      expect(bundle.corrections).toBeGreaterThanOrEqual(0);
      expect(bundle.corrections).toBeLessThanOrEqual(0.03);
    }
  });

  it('makes all five pages different from one another', () => {
    const pages = names.map((name) => sceneToSvg(render(name).pages[0]!));
    expect(new Set(pages).size).toBe(5);
    // No two share the whole bundle of pen, paper and hand.
    const bundles = names.map((name) => JSON.stringify(presetOptions(name)));
    expect(new Set(bundles).size).toBe(5);
  });

  it('writes exam answers in black on wide ruling with a margin, tiring down the page', () => {
    const exam = presetOptions('exam');
    expect(exam.ink).toBe('ballpoint-black');
    expect(exam.paper).toEqual({ kind: 'ruled', ruling: 'wide', marginLine: true });
    expect(exam.jitter.fatigue).toBeGreaterThan(PRESETS.normal.fatigue);
    // Between normal and rushed in steadiness.
    for (const key of ['baselineDrift', 'size', 'slant', 'rotation'] as const) {
      expect(exam.jitter[key]).toBeGreaterThan(PRESETS.normal[key]);
      expect(exam.jitter[key]).toBeLessThan(PRESETS.rushed[key]);
    }
    const scene = render('exam').pages[0]!;
    expect(scene.inkColor).toBe(INKS['ballpoint-black'].color);
    for (const stroke of wholeLetters(scene.strokes).slice(0, 50)) {
      expect(pathBounds(stroke.path).minX).toBeGreaterThan(30); // right of the margin line
    }
  });

  it('writes lecture notes small and tight, in pencil on narrow ruling', () => {
    const lecture = presetOptions('lecture');
    expect(lecture.ink).toBe('pencil');
    expect(lecture.paper).toMatchObject({ ruling: 'narrow' });
    expect(lecture.jitter.tracking).toBeLessThan(0);
    // Narrow ruling and tight spacing fit more lines and more words on a page.
    const lines = (name: PresetName): number => render(name).pages[0]!.baselines.length;
    expect(lines('lecture')).toBeGreaterThan(lines('exam'));
    expect(sceneToSvg(render('lecture').pages[0]!)).toContain('feTurbulence');
  });

  it('lets the user override any part of a preset', () => {
    const scene = renderText(text, bank, {
      seed: 1,
      ...presetOptions('exam'),
      ink: 'gel',
      corrections: 0,
    }).pages[0]!;
    expect(scene.inkColor).toBe(INKS.gel.color);
    expect(scene.strokes.some((s) => s.struck)).toBe(false);
  });
});

describe('realism features combined', { timeout: 120_000 }, () => {
  it('fatigue, corrections, ink and a photo effect work together without losing text', () => {
    const { pages, corrections } = renderText(text, bank, {
      seed: 'all',
      ...presetOptions('exam'),
      corrections: 0.2,
      header: [{ label: 'Name', value: 'Sara Khan' }],
      pageNumbers: true,
    });
    expect(corrections.struck + corrections.retraced).toBeGreaterThan(5);

    // Everything that is not a correction, header or page number spells the text.
    const body = pages.flatMap((page, i) => {
      const top = page.baselines[0]! - 4;
      return wholeLetters(page.strokes)
        .filter((s) => s.char !== '' && !s.struck && !s.retrace)
        .filter((s) => pathBounds(s.path).maxY > top)
        .slice(0, -String(i + 1).length);
    });
    expect(body.map((s) => s.char).join('')).toBe(text.replace(/\s+/g, ''));

    const clean = sceneToPixels(pages[0]!, 60);
    const photo = applyEffects(clean, { mode: 'photo', seed: 'all', crease: true });
    expect(photo.width).toBe(clean.width);
    let changed = 0;
    for (let i = 0; i < photo.data.length; i += 4) if (photo.data[i] !== clean.data[i]) changed++;
    expect(changed / (photo.data.length / 4)).toBeGreaterThan(0.9);
  });
});
