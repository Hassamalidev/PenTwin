import type { PenModel } from './pen';

export type InkName = 'ballpoint-blue' | 'ballpoint-black' | 'gel' | 'fountain' | 'pencil';

/** How a pen lays down ink. */
export interface Ink {
  color: string;
  /** Darkness of a normal stroke, 0 to 1. */
  opacity: number;
  /** Multiplier on the pen width. */
  width: number;
  /**
   * 0 to 1. How much the darkness rises and falls along the writing, slowly, the way a
   * fountain pen runs wetter and drier or a pencil is pressed harder and lighter.
   */
  shading: number;
  /** Fraction. How much the stroke width swells and thins with pressure. */
  widthVariation: number;
  /** mm. How far the ink soaks outward into the paper. Raster output only. */
  bleed: number;
  /** 0 to 1. Speckle where the paper's texture shows through. Raster output only. */
  grain: number;
  /**
   * How the width changes along each stroke. Only for pen-stroke handwriting; filled
   * outlines cut from a photo already carry the writer's own pen. Left out, every
   * stroke is drawn at one width.
   */
  pen?: PenModel;
}

export const INKS: Record<InkName, Ink> = {
  'ballpoint-blue': {
    color: '#1b2a6b',
    opacity: 0.92,
    width: 1,
    shading: 0.12,
    widthVariation: 0.06,
    bleed: 0,
    grain: 0.12,
    // Lands with a small blob, lifts off in a thin tail.
    pen: { taper: 0.55, landing: 0.22, nib: 0 },
  },
  'ballpoint-black': {
    color: '#1d1d1f',
    opacity: 0.92,
    width: 1,
    shading: 0.12,
    widthVariation: 0.06,
    bleed: 0,
    grain: 0.12,
    // Lands with a small blob, lifts off in a thin tail.
    pen: { taper: 0.55, landing: 0.22, nib: 0 },
  },
  /** Dense, even, slightly wider line. */
  gel: {
    color: '#0b0b3b',
    opacity: 1,
    width: 1.3,
    shading: 0.02,
    widthVariation: 0.03,
    bleed: 0.02,
    grain: 0,
    pen: { taper: 0.35, landing: 0.12, nib: 0 },
  },
  /** Wet line that pools and thins: strong shading, swelling strokes, a little bleed. */
  fountain: {
    color: '#14213d',
    opacity: 0.95,
    width: 1.3,
    shading: 0.4,
    widthVariation: 0.14,
    bleed: 0.07,
    grain: 0,
    // An ordinary fine nib held at about 40 degrees: wide down, thin across.
    pen: { taper: 0.4, landing: 0.08, nib: 0.42, nibAngle: 40 },
  },
  /** Grey, light, grainy. */
  pencil: {
    color: '#4b4b4f',
    opacity: 0.78,
    width: 1.15,
    shading: 0.22,
    widthVariation: 0.12,
    bleed: 0,
    grain: 0.65,
    // A worn point has a slight chisel to it.
    pen: { taper: 0.5, landing: 0.04, nib: 0.12, nibAngle: 30 },
  },
};

/**
 * SVG filter that gives the ink its bleed and grain, or undefined when it has neither.
 * Applied to raster output; PDF stays plain vector and shows colour, opacity and width only.
 */
export function inkFilter(
  ink: Pick<Ink, 'bleed' | 'grain'>,
  width: number,
  height: number,
): string | undefined {
  if (ink.bleed <= 0 && ink.grain <= 0) return undefined;
  const steps: string[] = [];
  let source = 'SourceGraphic';
  if (ink.bleed > 0) {
    // A soft halo under the crisp stroke.
    steps.push(
      `<feGaussianBlur in="SourceGraphic" stdDeviation="${ink.bleed}" result="halo"/>`,
      '<feMerge result="wet"><feMergeNode in="halo"/><feMergeNode in="SourceGraphic"/></feMerge>',
    );
    source = 'wet';
  }
  if (ink.grain > 0) {
    // Noise becomes transparency: the ink skips over the low spots of the paper.
    const k = (-1.6 * ink.grain).toFixed(3);
    const b = (1 + 0.32 * ink.grain).toFixed(3);
    steps.push(
      '<feTurbulence type="fractalNoise" baseFrequency="2.2" numOctaves="2" seed="7" result="tooth"/>',
      `<feColorMatrix in="tooth" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  ${k} 0 0 0 ${b}" result="mask"/>`,
      `<feComposite in="${source}" in2="mask" operator="in"/>`,
    );
  }
  return (
    `<filter id="ink" filterUnits="userSpaceOnUse" x="0" y="0" width="${width}" height="${height}">` +
    steps.join('') +
    '</filter>'
  );
}
