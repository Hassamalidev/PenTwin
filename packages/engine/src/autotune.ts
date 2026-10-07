import type { StyleFeatures } from '@pentwin/shared';
import type { JitterParams } from './jitter';
import { PRESETS } from './presets';

const clamp = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, value));

/**
 * Chooses jitter settings that suit one writer, from the style measured on their sample,
 * so a naturally neat writer is not made messy and a loose one is not tidied up.
 *
 * Two things follow from the glyphs being cut from the writer's own page:
 *
 * - They already lean the way the writer leans, so no extra slant is added.
 * - Each glyph already carries its own small size, lean and height differences. Adding
 *   the full measured variation on top would double it, so only part is added
 *   (`SHARE`). The slow, page-level drift is not in the glyphs at all and is scaled from
 *   how unsteady the writer is overall.
 *
 * `xHeight` is the size the text will be written at, in mm.
 */
export function tuneJitter(
  style: StyleFeatures,
  xHeight: number,
  base: JitterParams = PRESETS.normal,
): JitterParams {
  const SHARE = 0.5;
  // One number for "how unsteady": about 0.4 for very neat writing, 2 or more for rushed.
  const unsteady = clamp(
    (style.sizeVariation / 0.04 + style.baselineWobble / 0.04 + style.slantVariation / 3) / 3,
    0.3,
    2.5,
  );

  return {
    ...base,
    slant: 0,
    slantVariation: clamp(style.slantVariation * SHARE, 0.3, 5),
    rotation: clamp(style.slantVariation * 0.4, 0.3, 3.5),
    size: clamp(style.sizeVariation * SHARE, 0.01, 0.12),
    letterSpacing: clamp(style.spacingVariation * SHARE, 0.01, 0.15),
    wordSpacing: clamp(0.25 * unsteady, 0.08, 0.5),
    baselineDrift: clamp(0.12 * xHeight * unsteady, 0.05, 1),
    lineSlope: clamp(0.5 * unsteady, 0.15, 1.4),
    marginDrift: clamp(0.8 * unsteady, 0.2, 2.5),
    warp: clamp(0.04 * unsteady, 0.02, 0.1),
  };
}
