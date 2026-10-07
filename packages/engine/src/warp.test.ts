import { createRng } from '@pentwin/shared';
import { describe, expect, it } from 'vitest';
import { NO_JITTER } from './jitter';
import { serializePath } from './path';
import { renderText } from './render';
import { loadSampleBank } from './testing';
import { createWarp } from './warp';

const X_HEIGHT = 140;

describe('createWarp', () => {
  it('is the identity when the amount is zero', () => {
    const warp = createWarp(createRng(1), 0, X_HEIGHT);
    expect(warp(37, -120)).toEqual([37, -120]);
  });

  it('moves points by a small, bounded distance', () => {
    for (let seed = 0; seed < 200; seed++) {
      const warp = createWarp(createRng(seed), 0.05, X_HEIGHT);
      for (const [x, y] of [
        [0, 0],
        [100, -140],
        [60, 70],
        [140, -210],
      ] as const) {
        const [wx, wy] = warp(x, y);
        // Affine part is at most 5% of each coordinate (twice for x: scale + shear),
        // each wave at most 0.7 * 5% of the x-height.
        const limit = 0.05 * (Math.abs(x) + Math.abs(y)) + 0.035 * X_HEIGHT + 1e-9;
        expect(Math.abs(wx - x)).toBeLessThanOrEqual(limit);
        expect(Math.abs(wy - y)).toBeLessThanOrEqual(limit);
      }
    }
  });

  it('bends smoothly: neighbouring points move together', () => {
    const warp = createWarp(createRng(7), 0.08, X_HEIGHT);
    const [ax, ay] = warp(50, -50);
    const [bx, by] = warp(52, -50);
    expect(Math.hypot(bx - ax - 2, by - ay)).toBeLessThan(0.5);
  });

  it('differs from one glyph to the next and is reproducible', () => {
    const rng = createRng(3);
    const first = createWarp(rng, 0.05, X_HEIGHT)(100, -100);
    const second = createWarp(rng, 0.05, X_HEIGHT)(100, -100);
    expect(first).not.toEqual(second);
    expect(createWarp(createRng(3), 0.05, X_HEIGHT)(100, -100)).toEqual(first);
  });
});

describe('warp in rendering', () => {
  const bank = loadSampleBank();
  // Normalise each "e" to its own start point, so only the shape is compared.
  const shapes = (warp: number): Set<string> => {
    const { pages } = renderText('e'.repeat(60), bank, {
      seed: 'warp',
      jitter: { ...NO_JITTER, warp },
    });
    return new Set(
      pages[0]!.strokes.map(({ path }) => {
        const start = path[0] as { x: number; y: number };
        return serializePath(
          path.map((c) =>
            c.type === 'C'
              ? {
                  type: 'C' as const,
                  x1: c.x1 - start.x,
                  y1: c.y1 - start.y,
                  x2: c.x2 - start.x,
                  y2: c.y2 - start.y,
                  x: c.x - start.x,
                  y: c.y - start.y,
                }
              : { type: 'M' as const, x: 0, y: 0 },
          ),
          1,
        );
      }),
    );
  };

  it('turns 3 stored variants into a different shape for every placement', () => {
    expect(shapes(0).size).toBeLessThanOrEqual(3 * 2); // 3 variants, allowing for rounding
    expect(shapes(0.05).size).toBe(60);
  });
});
