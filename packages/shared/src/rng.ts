export type Seed = number | string;

export interface Rng {
  /** Uniform float in [0, 1). */
  next(): number;
  /** Uniform float in [min, max). */
  float(min: number, max: number): number;
  /** Uniform integer in [min, max], both inclusive. */
  int(min: number, max: number): number;
  /** Uniform pick from a non-empty array. */
  pick<T>(items: readonly T[]): T;
}

/** FNV-1a, so string seeds ("doc-123:page-4") map to a stable 32-bit state. */
function hashSeed(seed: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Seeded PRNG (mulberry32). The same seed always yields the same sequence. */
export function createRng(seed: Seed): Rng {
  let state = typeof seed === 'string' ? hashSeed(seed) : seed >>> 0;

  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const float = (min: number, max: number): number => min + next() * (max - min);
  const int = (min: number, max: number): number => Math.floor(float(min, max + 1));

  return {
    next,
    float,
    int,
    pick<T>(items: readonly T[]): T {
      if (items.length === 0) throw new Error('Cannot pick from an empty array');
      return items[int(0, items.length - 1)] as T;
    },
  };
}
