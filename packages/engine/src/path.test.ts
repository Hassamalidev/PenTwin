import { describe, expect, it } from 'vitest';
import { parsePath, pathBounds, serializePath, transformPath } from './path';

describe('parsePath', () => {
  it('parses absolute commands', () => {
    expect(parsePath('M1 2L3 4C1 1 2 2 3 3Q4 4 5 5Z')).toEqual([
      { type: 'M', x: 1, y: 2 },
      { type: 'L', x: 3, y: 4 },
      { type: 'C', x1: 1, y1: 1, x2: 2, y2: 2, x: 3, y: 3 },
      { type: 'Q', x1: 4, y1: 4, x: 5, y: 5 },
      { type: 'Z' },
    ]);
  });

  it('resolves relative commands, H/V and implicit linetos', () => {
    expect(parsePath('m10,10 5,0 h5 v-5 l-1-1')).toEqual([
      { type: 'M', x: 10, y: 10 },
      { type: 'L', x: 15, y: 10 },
      { type: 'L', x: 20, y: 10 },
      { type: 'L', x: 20, y: 5 },
      { type: 'L', x: 19, y: 4 },
    ]);
  });

  it('reflects the control point for smooth curves', () => {
    const [, , s] = parsePath('M0 0C0 10 10 10 10 0S20 -10 20 0');
    expect(s).toEqual({ type: 'C', x1: 10, y1: -10, x2: 20, y2: -10, x: 20, y: 0 });
  });

  it('rejects arcs and malformed data', () => {
    expect(() => parsePath('M0 0A5 5 0 0 1 10 10')).toThrow(/Unsupported/);
    expect(() => parsePath('M0 0L1')).toThrow();
    expect(() => parsePath('1 2 3')).toThrow();
  });
});

describe('path helpers', () => {
  it('round-trips through serialize and parse', () => {
    const path = parsePath('M1.5 2.25C3 4 5 6 7.125 8L0 -3Z');
    expect(parsePath(serializePath(path, 3))).toEqual(path);
  });

  it('trims trailing zeros when serializing', () => {
    expect(serializePath([{ type: 'M', x: 1, y: 2.5 }], 2)).toBe('M1 2.5');
  });

  it('transforms every point and reports bounds', () => {
    const moved = transformPath(parsePath('M0 0Q5 -5 10 0'), (x, y) => [x + 1, y * 2]);
    expect(moved).toEqual([
      { type: 'M', x: 1, y: 0 },
      { type: 'Q', x1: 6, y1: -10, x: 11, y: 0 },
    ]);
    expect(pathBounds(moved)).toEqual({ minX: 1, minY: -10, maxX: 11, maxY: 0 });
  });
});
