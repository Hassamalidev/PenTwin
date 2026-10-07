import type { Box, Segment, Segmentation } from './segment';

export interface LabeledGlyph extends Box {
  char: string;
  /** The pen marks making up this glyph. Only their pixels inside the box belong to it. */
  componentIds: number[];
  /** 0 to 1: how sure we are that this cut is exactly this character. */
  confidence: number;
  line: number;
  /** Index of the expected word this came from. */
  word: number;
  /**
   * How the cut was made. `clean`: one separate mark. `merged`: several marks joined
   * (the two ticks of a double quote). `split`: cut out of two touching letters.
   */
  cut: 'clean' | 'merged' | 'split';
}

export interface FlaggedWord {
  expected: string;
  line: number;
  reason: 'not-found' | 'letters-joined' | 'unclear';
}

export interface Alignment {
  glyphs: LabeledGlyph[];
  /** Words (or parts of words) left unlabeled rather than guessed. */
  flagged: FlaggedWord[];
  expectedChars: number;
}

const NARROW = new Set("iljtfrI1.,;:!'|()/-");
const WIDE = new Set('mwMW&');

/** Rough width of a character relative to an average lowercase letter. */
const relativeWidth = (char: string): number => {
  if (NARROW.has(char)) return 0.45;
  if (WIDE.has(char)) return 1.45;
  if (char === '"') return 0.7;
  return char >= 'A' && char <= 'Z' ? 1.2 : 1;
};

/** A double quote is written as two separate ticks; everything else as one segment. */
const marksIn = (char: string): number => (char === '"' ? 2 : 1);
const marksInWord = (word: string): number => [...word].reduce((sum, c) => sum + marksIn(c), 0);

interface DetectedWord {
  line: number;
  segments: Segment[];
  /** Rough x-height of the writing, in pixels. */
  xHeight: number;
}

const TALL = new Set('bdfhklt0123456789ij!?/()$&');
const DEEP = new Set('gjpqy');
const isLetterOrDigit = (char: string): boolean => /[a-zA-Z0-9]/.test(char) || TALL.has(char);

/**
 * How badly a word on the page disagrees with a word of the text about which letters
 * stick up (b, d, capitals) and which hang down (g, p, y). 0 is a perfect match, 1 is
 * none. Two words of the same length, like "quick" and "brown", are told apart this way.
 * Only comparable when both have the same number of marks; otherwise returns 0.
 */
function shapeMismatch(word: DetectedWord, text: string): number {
  const chars = [...text].flatMap((c) => (c === '"' ? [c, c] : [c]));
  if (chars.length !== word.segments.length) return 0;
  // Measured from the word's own baseline, so a sloping line does not matter.
  const bottoms = word.segments
    .filter((s) => s.y1 - s.y0 > word.xHeight * 0.5)
    .map((s) => s.y1)
    .sort((a, b) => a - b);
  if (bottoms.length === 0) return 0;
  const baseline = bottoms[Math.floor(bottoms.length / 2)]!;
  let compared = 0;
  let wrong = 0;
  chars.forEach((char, i) => {
    if (!isLetterOrDigit(char)) return;
    const segment = word.segments[i]!;
    const tall = baseline - segment.y0 > word.xHeight * 1.05;
    const deep = segment.y1 - baseline > word.xHeight * 0.2;
    const expectTall = TALL.has(char) || (char >= 'A' && char <= 'Z');
    compared++;
    if (tall !== expectTall || deep !== DEEP.has(char)) wrong++;
  });
  return compared > 0 ? wrong / compared : 0;
}

interface Group {
  detected: number[];
  expected: number[];
}

/**
 * Matches the words found on the page to the words of the known text, in order, by how
 * many letters each seems to have. This is an edit-distance alignment, so a word that
 * was missed, or two that ran together, costs a little locally and everything after it
 * still lines up.
 */
function alignWords(detected: DetectedWord[], expected: string[]): Group[] {
  const n = detected.length;
  const m = expected.length;
  const counts = detected.map((w) => w.segments.length);
  const marks = expected.map(marksInWord);
  const mismatch = (found: number, wanted: number): number =>
    Math.abs(found - wanted) / Math.max(found, wanted, 1);

  const SKIP = 1;
  // Joining is only plausible when the letter counts then agree closely, so a
  // disagreement costs double here: otherwise a skipped word would be explained away
  // as its neighbour being two words run together.
  const JOIN_PENALTY = 0.4;
  const cost = Array.from({ length: n + 1 }, () => new Float64Array(m + 1).fill(Infinity));
  const step = Array.from({ length: n + 1 }, () => new Uint8Array(m + 1));
  cost[0]![0] = 0;

  const relax = (i: number, j: number, value: number, op: number): void => {
    if (value < cost[i]![j]!) {
      cost[i]![j] = value;
      step[i]![j] = op;
    }
  };
  for (let i = 0; i <= n; i++) {
    for (let j = 0; j <= m; j++) {
      const here = cost[i]![j]!;
      if (here === Infinity) continue;
      if (i < n && j < m) {
        const shape = shapeMismatch(detected[i]!, expected[j]!);
        relax(i + 1, j + 1, here + mismatch(counts[i]!, marks[j]!) + 0.5 * shape, 1);
      }
      if (i < n) relax(i + 1, j, here + SKIP, 2);
      if (j < m) relax(i, j + 1, here + SKIP, 3);
      // One blob on the page is really two words (the gap was too small to see).
      if (i < n && j + 1 < m) {
        relax(
          i + 1,
          j + 2,
          here + JOIN_PENALTY + 2 * mismatch(counts[i]!, marks[j]! + marks[j + 1]!),
          4,
        );
      }
      // Two blobs on the page are really one word (a wide gap inside it).
      if (i + 1 < n && j < m && detected[i]!.line === detected[i + 1]!.line) {
        relax(
          i + 2,
          j + 1,
          here + JOIN_PENALTY + 2 * mismatch(counts[i]! + counts[i + 1]!, marks[j]!),
          5,
        );
      }
    }
  }

  const groups: Group[] = [];
  let i = n;
  let j = m;
  while (i > 0 || j > 0) {
    switch (step[i]![j]) {
      case 1:
        groups.push({ detected: [i - 1], expected: [j - 1] });
        i--;
        j--;
        break;
      case 2:
        i--;
        break;
      case 3:
        groups.push({ detected: [], expected: [j - 1] });
        j--;
        break;
      case 4:
        groups.push({ detected: [i - 1], expected: [j - 2, j - 1] });
        i--;
        j -= 2;
        break;
      default:
        groups.push({ detected: [i - 2, i - 1], expected: [j - 1] });
        i -= 2;
        j--;
    }
  }
  return groups.reverse();
}

type CharStep = 'clean' | 'merged' | 'split';

/**
 * Inside one matched word, decides which segment is which letter. Usually it is one
 * segment per letter. Where the counts differ, widths decide which letters touch
 * (one wide segment for two letters) or which letter is in two pieces.
 */
function alignChars(segments: Segment[], chars: string[]): CharStep[] | undefined {
  const k = segments.length;
  const n = chars.length;
  const widths = segments.map((s) => s.x1 - s.x0);
  const wanted = chars.map(relativeWidth);
  const scale =
    widths.reduce((a, b) => a + b, 0) /
    Math.max(
      0.1,
      wanted.reduce((a, b) => a + b, 0),
    );
  const fit = (width: number, relative: number): number =>
    0.15 * Math.min(4, ((width - scale * relative) / scale) ** 2);

  const cost = Array.from({ length: k + 1 }, () => new Float64Array(n + 1).fill(Infinity));
  const from = Array.from({ length: k + 1 }, () => new Array<CharStep | undefined>(n + 1));
  cost[0]![0] = 0;
  const relax = (s: number, c: number, value: number, op: CharStep): void => {
    if (value < cost[s]![c]!) {
      cost[s]![c] = value;
      from[s]![c] = op;
    }
  };
  for (let s = 0; s <= k; s++) {
    for (let c = 0; c <= n; c++) {
      const here = cost[s]![c]!;
      if (here === Infinity) continue;
      if (s < k && c < n) {
        const quote = chars[c] === '"';
        relax(s + 1, c + 1, here + fit(widths[s]!, wanted[c]!) + (quote ? 0.5 : 0), 'clean');
        if (s + 1 < k) {
          const joined = segments[s + 1]!.x1 - segments[s]!.x0;
          relax(s + 2, c + 1, here + fit(joined, wanted[c]!) + (quote ? 0 : 1), 'merged');
        }
        if (c + 1 < n) {
          relax(s + 1, c + 2, here + fit(widths[s]!, wanted[c]! + wanted[c + 1]!) + 1, 'split');
        }
      }
    }
  }
  if (cost[k]![n] === Infinity) return undefined;

  const steps: CharStep[] = [];
  let s = k;
  let c = n;
  while (s > 0 || c > 0) {
    const op = from[s]![c]!;
    steps.push(op);
    s -= op === 'merged' ? 2 : 1;
    c -= op === 'split' ? 2 : 1;
  }
  return steps.reverse();
}

const union = (a: Box, b: Box): Box => ({
  x0: Math.min(a.x0, b.x0),
  y0: Math.min(a.y0, b.y0),
  x1: Math.max(a.x1, b.x1),
  y1: Math.max(a.y1, b.y1),
});

/**
 * Looks for a place to cut a segment that holds two touching letters: the thinnest
 * column of ink near where the boundary should be. Returns undefined when the letters
 * are joined by more than a thin stroke, in which case they are left alone.
 */
function findCut(
  segment: Segment,
  boundary: number,
  page: Segmentation,
  width: number,
): number | undefined {
  const ids = new Set(segment.componentIds);
  const span = segment.x1 - segment.x0;
  const from = Math.max(segment.x0 + 2, Math.round(segment.x0 + span * (boundary - 0.25)));
  const to = Math.min(segment.x1 - 2, Math.round(segment.x0 + span * (boundary + 0.25)));
  let best: number | undefined;
  let bestInk = Infinity;
  for (let x = from; x < to; x++) {
    let ink = 0;
    for (let y = segment.y0; y < segment.y1; y++) {
      if (ids.has(page.labels[y * width + x]!)) ink++;
    }
    if (ink < bestInk) {
      bestInk = ink;
      best = x;
    }
  }
  // A connecting stroke crossed once is thin; anything thicker is part of a letter.
  return best !== undefined && bestInk <= Math.max(2, page.bandHeight * 0.14) ? best : undefined;
}

/**
 * Labels the candidate characters on the page with the characters of the known text.
 * Anything it cannot place with reasonable certainty is flagged, never guessed.
 */
export function alignToText(
  page: Segmentation,
  imageWidth: number,
  expectedText: string,
): Alignment {
  const detected: DetectedWord[] = page.lines.flatMap((line, lineIndex) =>
    line.words.map((word) => ({
      line: lineIndex,
      segments: word.segments,
      xHeight: page.bandHeight,
    })),
  );
  const expected = expectedText.split(/\s+/).filter(Boolean);
  const glyphs: LabeledGlyph[] = [];
  const flagged: FlaggedWord[] = [];

  for (const group of alignWords(detected, expected)) {
    const text = group.expected.map((j) => expected[j]!).join('');
    const wordIndex = group.expected[0]!;
    const line = group.detected.length > 0 ? detected[group.detected[0]!]!.line : -1;
    if (group.detected.length === 0) {
      flagged.push({ expected: text, line, reason: 'not-found' });
      continue;
    }

    const segments = group.detected.flatMap((i) => detected[i]!.segments);
    const chars = [...text];
    const steps = alignChars(segments, chars);
    // A repair is any letter that did not come from exactly one segment. The two ticks of
    // a double quote are expected, so they do not count.
    let repairs = 0;
    let at = 0;
    for (const op of steps ?? []) {
      if (op !== 'clean' && !(op === 'merged' && chars[at] === '"')) repairs++;
      at += op === 'split' ? 2 : 1;
    }
    // Too many repairs means the match itself is doubtful: leave the word out.
    if (!steps || repairs > Math.max(1, Math.floor(chars.length * 0.34))) {
      flagged.push({ expected: text, line, reason: 'unclear' });
      continue;
    }

    const exactWords = group.detected.length === 1 && group.expected.length === 1;
    const certainty = (exactWords ? 1 : 0.9) * (repairs === 0 ? 1 : 0.9);
    const emit = (
      char: string,
      box: Box,
      ids: number[],
      cut: CharStep,
      confidence: number,
    ): void => {
      glyphs.push({ ...box, char, componentIds: ids, cut, line, word: wordIndex, confidence });
    };

    let s = 0;
    let c = 0;
    for (const op of steps) {
      const segment = segments[s]!;
      if (op === 'clean') {
        emit(chars[c]!, segment, segment.componentIds, 'clean', 0.9 * certainty);
        s++;
        c++;
      } else if (op === 'merged') {
        const next = segments[s + 1]!;
        const ids = [...segment.componentIds, ...next.componentIds];
        emit(
          chars[c]!,
          union(segment, next),
          ids,
          'merged',
          (chars[c] === '"' ? 0.9 : 0.6) * certainty,
        );
        s += 2;
        c++;
      } else {
        const [left, right] = [relativeWidth(chars[c]!), relativeWidth(chars[c + 1]!)];
        const cutAt = findCut(segment, left / (left + right), page, imageWidth);
        if (cutAt === undefined) {
          flagged.push({ expected: chars[c]! + chars[c + 1]!, line, reason: 'letters-joined' });
        } else {
          emit(
            chars[c]!,
            { ...segment, x1: cutAt },
            segment.componentIds,
            'split',
            0.5 * certainty,
          );
          emit(
            chars[c + 1]!,
            { ...segment, x0: cutAt },
            segment.componentIds,
            'split',
            0.5 * certainty,
          );
        }
        s++;
        c += 2;
      }
    }
  }

  return { glyphs, flagged, expectedChars: expected.join('').length };
}
