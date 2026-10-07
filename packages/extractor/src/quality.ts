import { estimateBackground, normalizeIllumination, threshold } from './clean';
import { shrinkGray, toGray, type RgbaImage } from './image';

export type QualityIssueCode =
  'low-resolution' | 'too-dark' | 'shadow' | 'blurry' | 'cropped' | 'no-writing';

export interface QualityIssue {
  code: QualityIssueCode;
  /** What the user should do about it, in plain words. */
  message: string;
}

export interface QualityMetrics {
  /** Shorter side of the photo, in pixels. */
  shortSide: number;
  /** Typical brightness of the bare paper, 0 to 255. */
  paperBrightness: number;
  /** Darkest part of the paper relative to the brightest, 0 to 1. 1 is perfectly even. */
  evenness: number;
  /** Edge crispness of the pen strokes, 0 to 1. */
  sharpness: number;
  /** Share of the ink lying right at the edge of the photo, 0 to 1. */
  edgeInk: number;
  /** Share of the photo covered by ink, 0 to 1. */
  inkCoverage: number;
}

export interface QualityReport {
  ok: boolean;
  issues: QualityIssue[];
  metrics: QualityMetrics;
}

/**
 * Limits below which a photo is sent back. Calibrated on synthetic test photos only;
 * they need checking against real phone photos before launch.
 */
export const QUALITY_LIMITS = {
  minShortSide: 900,
  minPaperBrightness: 80,
  minEvenness: 0.4,
  minSharpness: 0.2,
  maxEdgeInk: 0.004,
  minInkCoverage: 0.003,
};

const MESSAGES: Record<QualityIssueCode, string> = {
  'low-resolution':
    'The photo is too small to read your letters clearly. Move closer so the page fills the picture, or use your main camera.',
  'too-dark': 'The photo is too dark. Add more light, or move near a window.',
  shadow:
    'Part of the page is in shadow. Move so that your hand and phone are not between the light and the paper.',
  blurry: 'The photo is blurry. Hold the phone steady and tap the page to focus before you shoot.',
  cropped: 'Some writing is cut off at the edge. Fit the whole page in the picture.',
  'no-writing':
    "We couldn't find any handwriting. Use a dark pen on plain white paper and photograph the written side.",
};

const percentile = (values: Uint8Array, p: number): number => {
  const histogram = new Uint32Array(256);
  for (const v of values) histogram[v]!++;
  let remaining = values.length * p;
  for (let v = 0; v < 256; v++) {
    remaining -= histogram[v]!;
    if (remaining <= 0) return v;
  }
  return 255;
};

/** Checks a photo before any extraction is attempted, and says how to retake it if needed. */
export function assessQuality(photo: RgbaImage): QualityReport {
  // Measure at a fixed size so the limits mean the same for every camera.
  const gray = shrinkGray(toGray(photo), 1000);
  const { width, height } = gray;

  const background = estimateBackground(gray);
  const paperBrightness = percentile(background.data, 0.5);
  const evenness =
    percentile(background.data, 0.05) / Math.max(1, percentile(background.data, 0.95));

  const flat = normalizeIllumination(gray);
  const ink = threshold(flat);
  let inkPixels = 0;
  let edgePixels = 0;
  const border = Math.round(width * 0.012);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!ink.data[y * width + x]) continue;
      inkPixels++;
      if (x < border || y < border || x >= width - border || y >= height - border) edgePixels++;
    }
  }

  // Sharpness: how abruptly brightness changes at stroke edges. A crisp stroke jumps from
  // paper to ink within a pixel; a blurred one ramps slowly, so its strongest second
  // derivative is far smaller.
  const laplacian = new Uint8Array(width * height);
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x;
      const v =
        flat.data[i - 1]! +
        flat.data[i + 1]! +
        flat.data[i - width]! +
        flat.data[i + width]! -
        4 * flat.data[i]!;
      laplacian[i] = Math.min(255, Math.abs(v));
    }
  }
  const sharpness = percentile(laplacian, 0.995) / 255;

  const metrics: QualityMetrics = {
    shortSide: Math.min(photo.width, photo.height),
    paperBrightness,
    evenness,
    sharpness,
    edgeInk: inkPixels > 0 ? edgePixels / inkPixels : 0,
    inkCoverage: inkPixels / (width * height),
  };

  const failed: QualityIssueCode[] = [];
  if (metrics.shortSide < QUALITY_LIMITS.minShortSide) failed.push('low-resolution');
  if (paperBrightness < QUALITY_LIMITS.minPaperBrightness) failed.push('too-dark');
  if (evenness < QUALITY_LIMITS.minEvenness) failed.push('shadow');
  if (metrics.inkCoverage < QUALITY_LIMITS.minInkCoverage) {
    failed.push('no-writing');
  } else {
    // These two only mean something once there is writing to measure.
    if (sharpness < QUALITY_LIMITS.minSharpness) failed.push('blurry');
    if (metrics.edgeInk > QUALITY_LIMITS.maxEdgeInk) failed.push('cropped');
  }

  return {
    ok: failed.length === 0,
    issues: failed.map((code) => ({ code, message: MESSAGES[code] })),
    metrics,
  };
}
