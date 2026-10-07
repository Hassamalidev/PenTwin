import type { Rng } from '@pentwin/shared';
import type { PointFn } from './path';

/**
 * Builds a one-off distortion for a single placed glyph: a tiny affine change plus a
 * smooth, low-frequency bend. Applied on top of variant selection, it means a stored
 * variant never appears twice with exactly the same shape.
 *
 * `amount` is a fraction of the x-height (0.05 is subtle, 0.15 is sloppy). `xHeight` is in
 * the same units as the points being warped.
 */
export function createWarp(rng: Rng, amount: number, xHeight: number): PointFn {
  const scaleX = 1 + amount * rng.float(-1, 1);
  const scaleY = 1 + amount * rng.float(-1, 1);
  const shear = amount * rng.float(-1, 1);

  // Wavelengths longer than the glyph itself, so strokes bend rather than wiggle.
  const wave = () => {
    const direction = rng.float(0, Math.PI * 2);
    const k = (Math.PI * 2) / (xHeight * rng.float(1.5, 4));
    return {
      kx: Math.cos(direction) * k,
      ky: Math.sin(direction) * k,
      phase: rng.float(0, Math.PI * 2),
      amplitude: amount * xHeight * rng.float(0.3, 0.7),
    };
  };
  const wx = wave();
  const wy = wave();

  return (x, y) => [
    x * scaleX + y * shear + wx.amplitude * Math.sin(wx.kx * x + wx.ky * y + wx.phase),
    y * scaleY + wy.amplitude * Math.sin(wy.kx * x + wy.ky * y + wy.phase),
  ];
}
