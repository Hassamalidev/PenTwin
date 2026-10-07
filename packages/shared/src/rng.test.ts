import { describe, expect, it } from 'vitest';
import { createRng } from './rng';

const take = (seed: number | string, n: number): number[] => {
  const rng = createRng(seed);
  return Array.from({ length: n }, () => rng.next());
};

describe('createRng', () => {
  it('yields an identical sequence for the same seed', () => {
    expect(take(42, 1000)).toEqual(take(42, 1000));
    expect(take('doc-1:page-2', 1000)).toEqual(take('doc-1:page-2', 1000));
  });

  it('yields different sequences for different seeds', () => {
    expect(take(1, 10)).not.toEqual(take(2, 10));
    expect(take('a', 10)).not.toEqual(take('b', 10));
  });

  it('stays in [0, 1) and is roughly uniform', () => {
    const values = take(7, 20000);
    expect(values.every((v) => v >= 0 && v < 1)).toBe(true);
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    expect(mean).toBeGreaterThan(0.48);
    expect(mean).toBeLessThan(0.52);
  });

  it('int covers the inclusive range and nothing outside it', () => {
    const rng = createRng(3);
    const seen = new Set(Array.from({ length: 2000 }, () => rng.int(1, 6)));
    expect([...seen].sort()).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('float respects its bounds', () => {
    const rng = createRng(9);
    for (let i = 0; i < 1000; i++) {
      const v = rng.float(-2, 5);
      expect(v).toBeGreaterThanOrEqual(-2);
      expect(v).toBeLessThan(5);
    }
  });

  it('pick returns members and rejects empty arrays', () => {
    const rng = createRng(5);
    const items = ['a', 'b', 'c'] as const;
    for (let i = 0; i < 100; i++) expect(items).toContain(rng.pick(items));
    expect(() => rng.pick([])).toThrow();
  });
});
