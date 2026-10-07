/** The paragraph a user copies out by hand, with the coverage it has to guarantee. */
export interface SampleText {
  version: 1;
  title: string;
  paragraphs: string[];
  targets: {
    /** Minimum occurrences of every letter a-z. */
    lowercaseMin: number;
    /** Minimum occurrences of every letter A-Z. */
    uppercaseMin: number;
    /** Minimum occurrences of every digit 0-9. */
    digitMin: number;
    /** Punctuation marks that must each appear at least once. */
    punctuation: string;
    /** Letter sequences that must each appear at least once. */
    pairs: string[];
  };
}

export interface SampleCoverage {
  counts: Record<string, number>;
  wordCount: number;
  /** Human-readable description of every target the text misses. Empty means it passes. */
  failures: string[];
}

const range = (from: string, count: number): string[] =>
  Array.from({ length: count }, (_, i) => String.fromCharCode(from.charCodeAt(0) + i));

export const sampleTextOf = (sample: SampleText): string => sample.paragraphs.join('\n');

/** Counts characters and pairs in the sample and lists every target it falls short of. */
export function checkSampleText(sample: SampleText): SampleCoverage {
  const text = sampleTextOf(sample);
  const counts: Record<string, number> = {};
  for (const char of text) {
    if (!/\s/.test(char)) counts[char] = (counts[char] ?? 0) + 1;
  }

  const failures: string[] = [];
  const need = (chars: string[], min: number, kind: string): void => {
    for (const char of chars) {
      const have = counts[char] ?? 0;
      if (have < min) failures.push(`${kind} "${char}" appears ${have} times, needs ${min}`);
    }
  };
  need(range('a', 26), sample.targets.lowercaseMin, 'lowercase');
  need(range('A', 26), sample.targets.uppercaseMin, 'capital');
  need(range('0', 10), sample.targets.digitMin, 'digit');
  need([...sample.targets.punctuation], 1, 'punctuation');
  for (const pair of sample.targets.pairs) {
    if (!text.includes(pair)) failures.push(`pair "${pair}" does not appear`);
  }

  return { counts, wordCount: text.split(/\s+/).filter(Boolean).length, failures };
}
