export type PageSizeName = 'A4' | 'Letter' | 'A5';

export interface PageSize {
  widthMm: number;
  heightMm: number;
}

/**
 * A few numbers describing how someone writes, independent of the size they wrote at.
 * Measured from a handwriting sample and stored with the profile. Used to tune the
 * renderer to the writer and to compare handwriting styles.
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

  // How consistent the writer is. Low values mean neat, even writing.
  /** How much the lean varies from letter to letter, in degrees. */
  slantVariation: number;
  /** How much small letters vary in height, as a fraction of the x-height. */
  sizeVariation: number;
  /** How far letters sit above or below the line, as a fraction of the x-height. */
  baselineWobble: number;
  /** How much the space around letters varies, as a fraction of the x-height. */
  spacingVariation: number;
}
