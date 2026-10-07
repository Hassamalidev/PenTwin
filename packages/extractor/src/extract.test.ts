import {
  buildGlyphBank,
  NO_JITTER,
  pathBounds,
  renderText,
  REQUIRED_CHARS,
  type PathCommand,
} from '@pentwin/engine';
import { svgToPixels } from '@pentwin/engine/node';
import { describe, expect, it } from 'vitest';
import { reportCoverage } from './coverage';
import { BANK_X_HEIGHT, extractGlyphBank } from './extract';
import type { BinaryImage } from './image';
import { normalizeGlyphs } from './normalize';
import {
  CONDITIONS,
  degrade,
  extractLabels,
  renderSamplePage,
  SAMPLE,
  SAMPLE_TEXT,
  toRgba,
} from './testing';
import { vectorize } from './vectorize';

const page = renderSamplePage();
const photo = degrade(page.gray, { ...CONDITIONS.shadowed, rotate: 2.5 });
const labels = extractLabels(photo);
const normalized = normalizeGlyphs(labels.alignment, labels.page, labels.binary.width);
const extraction = extractGlyphBank(toRgba(photo), SAMPLE_TEXT);

const spread = (values: number[]): number => {
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  return Math.sqrt(values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length) / mean;
};

describe('normalizeGlyphs', { timeout: 120_000 }, () => {
  const { glyphs, metrics } = normalized;

  it('measures the letter proportions of the page', () => {
    // Written at a 3mm x-height with a 0.5mm pen; ink edges add about a pen width.
    const expected = (3 + 0.5) * page.pxPerMm;
    expect(metrics.xHeight / expected).toBeGreaterThan(0.9);
    expect(metrics.xHeight / expected).toBeLessThan(1.1);
    expect(metrics.capHeight).toBeGreaterThan(metrics.xHeight * 1.25);
    expect(metrics.descender).toBeGreaterThan(metrics.xHeight * 0.25);
    expect(metrics.wordGap).toBeGreaterThan(metrics.letterGap * 2);
    expect(metrics.strokeWidth / (0.5 * page.pxPerMm)).toBeGreaterThan(0.8);
    expect(metrics.strokeWidth / (0.5 * page.pxPerMm)).toBeLessThan(1.6);
  });

  it('gives the same letter the same height above the baseline on every line', () => {
    for (const char of 'aenorst') {
      const heights = glyphs.filter((g) => g.char === char).map((g) => g.baseline);
      expect(heights.length).toBeGreaterThan(10);
      expect(spread(heights)).toBeLessThan(0.1);
    }
    // And no line sits systematically high or low.
    const lines = new Map<number, number[]>();
    for (const g of glyphs.filter((x) => 'aceno'.includes(x.char))) {
      lines.set(g.line, [...(lines.get(g.line) ?? []), g.baseline]);
    }
    const lineMeans = [...lines.values()]
      .filter((v) => v.length >= 3)
      .map((v) => v.reduce((a, b) => a + b, 0) / v.length);
    expect(lineMeans.length).toBeGreaterThan(10);
    expect(spread(lineMeans)).toBeLessThan(0.05);
  });

  it('lets descenders hang below the baseline and nothing else', () => {
    for (const g of glyphs) {
      const below = g.bitmap.height - g.baseline;
      if ('gpqy'.includes(g.char)) expect(below).toBeGreaterThan(metrics.xHeight * 0.2);
      if ('aenorsdhklb'.includes(g.char))
        expect(Math.abs(below)).toBeLessThan(metrics.xHeight * 0.2);
    }
  });

  it('keeps side bearings within sensible bounds', () => {
    for (const g of glyphs) {
      for (const bearing of [g.lsb, g.rsb]) {
        expect(bearing).toBeGreaterThanOrEqual(-0.15 * metrics.xHeight - 1e-9);
        expect(bearing).toBeLessThanOrEqual(0.6 * metrics.xHeight + 1e-9);
      }
    }
  });
});

/** Fills a traced path back into pixels, to compare with the bitmap it came from. */
const rasterizePath = (path: PathCommand[], width: number, height: number): BinaryImage => {
  const d = path
    .map((c) =>
      c.type === 'Z'
        ? 'Z'
        : c.type === 'Q'
          ? `Q${c.x1} ${c.y1} ${c.x} ${c.y}`
          : `${c.type}${(c as { x: number }).x} ${(c as { y: number }).y}`,
    )
    .join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}"><rect width="${width}" height="${height}" fill="#fff"/><path d="${d}"/></svg>`;
  const pixels = svgToPixels(svg, width);
  const data = new Uint8Array(width * height);
  for (let i = 0; i < data.length; i++) data[i] = pixels.data[i * 4]! < 128 ? 1 : 0;
  return { width, height, data };
};

describe('vectorize', { timeout: 120_000 }, () => {
  it('traces a solid block as one closed outline inside the bitmap', () => {
    const block = { width: 12, height: 12, data: new Uint8Array(144).fill(1) };
    const path = vectorize(block);
    expect(path.filter((c) => c.type === 'M')).toHaveLength(1);
    expect(path.at(-1)).toEqual({ type: 'Z' });
    const b = pathBounds(path);
    expect(b.minX).toBeGreaterThanOrEqual(0);
    expect(b.maxX).toBeLessThanOrEqual(12);
  });

  it('keeps the hole in a ring open', () => {
    const size = 20;
    const data = new Uint8Array(size * size);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const r = Math.hypot(x - 9.5, y - 9.5);
        if (r < 9 && r > 5) data[y * size + x] = 1;
      }
    }
    const ring = { width: size, height: size, data };
    expect(vectorize(ring).filter((c) => c.type === 'M')).toHaveLength(2);
    const back = rasterizePath(vectorize(ring), size, size);
    expect(back.data[10 * size + 10]).toBe(0); // centre stays empty
    expect(back.data[10 * size + 2]).toBe(1); // the ring itself is filled
  });

  it('drops specks and returns nothing for an empty bitmap', () => {
    expect(vectorize({ width: 5, height: 5, data: new Uint8Array(25) })).toEqual([]);
    const speck = new Uint8Array(25);
    speck[12] = 1;
    expect(vectorize({ width: 5, height: 5, data: speck })).toEqual([]);
  });

  it('reproduces real glyph bitmaps closely', () => {
    const overlaps: number[] = [];
    for (const { bitmap } of normalized.glyphs.filter((_, i) => i % 6 === 0)) {
      const back = rasterizePath(vectorize(bitmap), bitmap.width, bitmap.height);
      let both = 0;
      let either = 0;
      for (let i = 0; i < bitmap.data.length; i++) {
        if (bitmap.data[i] && back.data[i]) both++;
        if (bitmap.data[i] || back.data[i]) either++;
      }
      overlaps.push(both / either);
    }
    const mean = overlaps.reduce((a, b) => a + b, 0) / overlaps.length;
    // Strokes here are only about 5 pixels thick, so one pixel of smoothing is a lot.
    expect(mean).toBeGreaterThan(0.8);
    expect(Math.min(...overlaps)).toBeGreaterThan(0.55);
  });
});

describe('reportCoverage', () => {
  it('classifies characters as strong, weak or missing', () => {
    const report = reportCoverage(
      new Map([
        ['a', [0.9, 0.9, 0.6]],
        ['b', [0.5]],
      ]),
      ['a', 'b', 'c'],
    );
    expect(report.chars).toEqual([
      { char: 'a', variants: 3, quality: expect.closeTo(0.8, 5), strength: 'strong' },
      { char: 'b', variants: 1, quality: 0.5, strength: 'weak' },
      { char: 'c', variants: 0, quality: 0, strength: 'missing' },
    ]);
    expect([report.strong, report.weak, report.missing]).toEqual([['a'], ['b'], ['c']]);
  });
});

describe('extractGlyphBank', { timeout: 120_000 }, () => {
  it('reports coverage that matches what was actually written', () => {
    const { coverage, bank } = extraction;
    expect(coverage!.chars.map((c) => c.char)).toEqual([...REQUIRED_CHARS]);
    // The copy-paragraph has none of these, so they cannot be in the bank.
    expect(coverage!.missing.sort()).toEqual(['#', '%', '*', '+', '=', '@']);

    const written: Record<string, number> = {};
    for (const char of SAMPLE.paragraphs.join('')) written[char] = (written[char] ?? 0) + 1;
    for (const entry of coverage!.chars) {
      expect(entry.variants).toBe(bank!.metadata.glyphs[entry.char]?.length ?? 0);
      expect(entry.variants).toBeLessThanOrEqual(written[entry.char] ?? 0);
      expect(entry.strength).toBe(
        entry.variants >= 3 ? 'strong' : entry.variants > 0 ? 'weak' : 'missing',
      );
    }
    // Every lowercase letter appears at least 3 times, and nearly all should be found.
    const lowercase = coverage!.chars.filter((c) => c.char >= 'a' && c.char <= 'z');
    expect(lowercase.filter((c) => c.strength === 'strong').length).toBeGreaterThanOrEqual(24);
  });

  it('produces a bank the engine accepts, of a few hundred KB at most', () => {
    const { bank, bankBytes } = extraction;
    const loaded = buildGlyphBank(bank!.metadata, (file) => bank!.files[file]!);
    expect(loaded.paint).toBe('fill');
    expect(loaded.xHeight).toBe(BANK_X_HEIGHT);
    expect(bankBytes).toBeGreaterThan(20_000);
    expect(bankBytes).toBeLessThan(400_000);
  });

  it('writes with the extracted bank: every glyph the right size and on the baseline', () => {
    const { bank } = extraction;
    const loaded = buildGlyphBank(bank!.metadata, (file) => bank!.files[file]!);
    // Enough repeats to use every variant, taken from many different lines of the photo.
    const { pages, report } = renderText('nose ran over a cone '.repeat(8), loaded, {
      seed: 1,
      lineHeight: 10,
      xHeight: 4,
      jitter: NO_JITTER,
    });
    expect(report.unknownChars).toEqual({});
    const scene = pages[0]!;
    for (const stroke of scene.strokes) {
      const b = pathBounds(stroke.path);
      const baseline = scene.baselines.reduce((a, c) =>
        Math.abs(c - b.maxY) < Math.abs(a - b.maxY) ? c : a,
      );
      expect(Math.abs(b.maxY - baseline)).toBeLessThan(0.5); // mm
      expect(b.maxY - b.minY).toBeGreaterThan(4 * 0.75);
      expect(b.maxY - b.minY).toBeLessThan(4 * 1.3);
    }
  });

  it('stops at the quality gate for an unusable photo', () => {
    const dark = extractGlyphBank(toRgba(degrade(page.gray, { brightness: 0.2 })), SAMPLE_TEXT);
    expect(dark.bank).toBeUndefined();
    expect(dark.quality.issues.map((i) => i.code)).toEqual(['too-dark']);
    expect(Object.keys(dark.timings)).toEqual(['quality']);
  });

  it('reports what it left out and how long each stage took', () => {
    expect(extraction.flagged.length).toBeLessThan(8);
    expect(Object.keys(extraction.timings)).toEqual([
      'quality',
      'clean',
      'segment',
      'align',
      'normalize',
      'vectorize',
    ]);
  });
});
