import type { NormalizedGlyph, PageMetrics } from './normalize';
import { vectorize } from './vectorize';

/**
 * A few numbers describing how someone writes, independent of the size they wrote at.
 * Stored with the profile; later used to tune the renderer to the writer and to compare
 * handwriting styles.
 */
export interface StyleFeatures {
  /** Lean of the upright strokes in degrees. Positive leans right. */
  slant: number;
  /** Pen stroke thickness as a fraction of the x-height. */
  strokeWidth: number;
  /** x-height as a fraction of the capital height. Low means small letters, tall capitals. */
  xHeightRatio: number;
  /** How circular the round letters are, 0 to 1. 1 is a perfect circle. */
  roundness: number;
  /** Width of an average lowercase letter as a fraction of the x-height. */
  letterWidth: number;
}

const median = (values: number[], fallback: number): number => {
  if (values.length === 0) return fallback;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)]!;
};

/**
 * Lean of one glyph: the shear that makes its ink stand most upright, found by trying
 * angles and keeping the one where the ink piles into the fewest columns.
 */
function slantOf({ bitmap }: NormalizedGlyph): number {
  const { width, height, data } = bitmap;
  const points: [number, number][] = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) if (data[y * width + x]) points.push([x, height - y]);
  }
  let best = 0;
  let bestScore = -1;
  const columns = new Float64Array(width + 2 * height + 2);
  for (let degrees = -35; degrees <= 35; degrees += 1) {
    const tan = Math.tan((degrees * Math.PI) / 180);
    columns.fill(0);
    // Undo a lean of `degrees`: points higher up are moved back to the left.
    for (const [x, up] of points) columns[Math.round(x - up * tan + height)]!++;
    let score = 0;
    for (const count of columns) score += count * count;
    if (score > bestScore) {
      bestScore = score;
      best = degrees;
    }
  }
  return best;
}

/** 4*pi*area / perimeter^2 of the glyph's outer outline: 1 for a circle, less otherwise. */
function roundnessOf({ bitmap }: NormalizedGlyph): number | undefined {
  // The first closed outline traced is the outer one for a single-stroke round letter.
  let best: { area: number; perimeter: number } | undefined;
  let points: [number, number][] = [];
  const close = (): void => {
    if (points.length < 3) return;
    let area = 0;
    let perimeter = 0;
    points.forEach(([x, y], i) => {
      const [nx, ny] = points[(i + 1) % points.length]!;
      area += x * ny - nx * y;
      perimeter += Math.hypot(nx - x, ny - y);
    });
    area = Math.abs(area) / 2;
    if (!best || area > best.area) best = { area, perimeter };
  };
  for (const command of vectorize(bitmap)) {
    if (command.type === 'M') points = [[command.x, command.y]];
    else if (command.type === 'Z') close();
    else points.push([command.x, command.y]);
  }
  return best ? (4 * Math.PI * best.area) / best.perimeter ** 2 : undefined;
}

/** Measures the writer's style from the normalized glyphs of one page. */
export function measureStyle(
  glyphs: readonly NormalizedGlyph[],
  metrics: PageMetrics,
): StyleFeatures {
  // Only cuts we trust, so one bad cut cannot skew the profile.
  const trusted = glyphs.filter((g) => g.confidence >= 0.6);
  const of = (chars: string): NormalizedGlyph[] => trusted.filter((g) => chars.includes(g.char));

  return {
    // Letters built around one long upright stroke.
    slant: median(of('lbdhkIt1').map(slantOf), 0),
    strokeWidth: metrics.strokeWidth / metrics.xHeight,
    xHeightRatio: metrics.xHeight / metrics.capHeight,
    roundness: median(
      of('oO0').flatMap((g) => roundnessOf(g) ?? []),
      0,
    ),
    letterWidth:
      median(
        of('acenorsuvxz').map((g) => g.bitmap.width),
        metrics.xHeight,
      ) / metrics.xHeight,
  };
}
