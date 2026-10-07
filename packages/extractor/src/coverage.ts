import { REQUIRED_CHARS } from '@pentwin/engine';

export type Strength = 'strong' | 'weak' | 'missing';

export interface CharCoverage {
  char: string;
  variants: number;
  /** Average confidence of the variants kept, 0 to 1. 0 when there are none. */
  quality: number;
  /** `strong`: 3 or more variants. `weak`: 1 or 2. `missing`: none. */
  strength: Strength;
}

export interface CoverageReport {
  chars: CharCoverage[];
  strong: string[];
  weak: string[];
  missing: string[];
}

/** For every required character, says how well the bank can write it. */
export function reportCoverage(
  confidences: ReadonlyMap<string, readonly number[]>,
  required: readonly string[] = REQUIRED_CHARS,
): CoverageReport {
  const chars = required.map((char): CharCoverage => {
    const found = confidences.get(char) ?? [];
    return {
      char,
      variants: found.length,
      quality: found.length > 0 ? found.reduce((a, b) => a + b, 0) / found.length : 0,
      strength: found.length >= 3 ? 'strong' : found.length > 0 ? 'weak' : 'missing',
    };
  });
  const of = (strength: Strength): string[] =>
    chars.filter((c) => c.strength === strength).map((c) => c.char);
  return { chars, strong: of('strong'), weak: of('weak'), missing: of('missing') };
}
