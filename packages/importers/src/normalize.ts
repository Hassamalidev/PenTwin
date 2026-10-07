/**
 * Turns the typographic characters word processors produce into the plain ones a pen
 * writes, and reports everything it could not write. Nothing is ever dropped silently.
 */

export interface Replacement {
  from: string;
  to: string;
  count: number;
  /**
   * True when the replacement loses something the reader might care about, such as an
   * accent ("\u00e9" written as "e"). These should be shown to the user before export.
   */
  lossy: boolean;
}

export interface UnsupportedChar {
  char: string;
  count: number;
  /** What kind of character it is, for the warning: "emoji", "math symbol", and so on. */
  kind: string;
}

export interface NormalizeResult {
  text: string;
  replaced: Replacement[];
  /** Characters left in the text that the handwriting cannot write. A gap is left for each. */
  unsupported: UnsupportedChar[];
}

/** Characters with an exact plain-text equivalent. */
const EXACT: Record<string, string> = {
  '\u2018': "'", // left single quote
  '\u2019': "'", // right single quote, apostrophe
  '\u201a': "'",
  '\u2032': "'", // prime
  '\u201c': '"',
  '\u201d': '"',
  '\u201e': '"',
  '\u2033': '"',
  '\u00ab': '"', // guillemets
  '\u00bb': '"',
  '\u2010': '-', // hyphen
  '\u2011': '-', // non-breaking hyphen
  '\u2012': '-',
  '\u2013': '-', // en dash
  '\u2014': '-', // em dash
  '\u2015': '-',
  '\u2212': '-', // minus sign
  '\u2026': '...', // ellipsis
  '\u2022': '-', // bullet
  '\u25e6': '-',
  '\u25aa': '-',
  '\u00b7': '.', // middle dot
  '\u2044': '/', // fraction slash
  '\u00d7': 'x', // multiplication sign
  '\u00f7': '/', // division sign
  '\u00bd': '1/2',
  '\u00bc': '1/4',
  '\u00be': '3/4',
  ['\ufb00']: 'ff', // ligatures
  ['\ufb01']: 'fi',
  ['\ufb02']: 'fl',
  ['\ufb03']: 'ffi',
  ['\ufb04']: 'ffl',
  '\u00a9': '(c)',
  '\u00ae': '(R)',
  '\u2122': '(TM)',
};

/** Spaces of every width become an ordinary space. */
const SPACES = new Set([
  0x0009, 0x00a0, 0x1680, 0x2000, 0x2001, 0x2002, 0x2003, 0x2004, 0x2005, 0x2006, 0x2007, 0x2008,
  0x2009, 0x200a, 0x202f, 0x205f, 0x3000,
]);
/** Characters with no visible form: removed without comment, as nothing is lost. */
// Soft hyphen, zero-width spaces and joiners, byte-order mark, variation selectors.
const INVISIBLE = new Set([0x00ad, 0x200b, 0x200c, 0x200d, 0x2060, 0xfeff, 0xfe0e, 0xfe0f]);
const isInvisible = (segment: string): boolean =>
  [...segment].every((c) => INVISIBLE.has(c.codePointAt(0)!));
const COMBINING = /\p{M}/u;

function kindOf(char: string): string {
  if (/\p{Extended_Pictographic}/u.test(char)) return 'emoji';
  if (/\p{Sm}/u.test(char)) return 'math symbol';
  if (/\p{Sc}/u.test(char)) return 'currency symbol';
  if (/\p{L}/u.test(char)) return 'letter from another alphabet';
  if (/\p{N}/u.test(char)) return 'number form';
  return 'symbol';
}

/**
 * Normalizes text for handwriting. `canWrite` says whether the glyph bank has a
 * character; anything it cannot write and that has no sound plain equivalent is left in
 * place and listed in `unsupported`.
 */
export function normalizeText(text: string, canWrite: (char: string) => boolean): NormalizeResult {
  const replaced = new Map<string, Replacement>();
  const unsupported = new Map<string, UnsupportedChar>();
  const note = (from: string, to: string, lossy: boolean): void => {
    const entry = replaced.get(from);
    if (entry) entry.count++;
    else replaced.set(from, { from, to, count: 1, lossy });
  };

  let out = '';
  // Graphemes, so an emoji made of several code points is one character to the user.
  const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text);
  for (const { segment } of graphemes) {
    if (segment === '\n' || segment === '\r\n' || segment === ' ') {
      out += segment === ' ' ? ' ' : '\n';
      continue;
    }
    if (isInvisible(segment)) continue;
    if (segment.length === 1 && SPACES.has(segment.codePointAt(0)!)) {
      out += ' ';
      continue;
    }
    if (canWrite(segment)) {
      out += segment;
      continue;
    }

    const exact = EXACT[segment];
    if (exact !== undefined && [...exact].every(canWrite)) {
      note(segment, exact, false);
      out += exact;
      continue;
    }

    // An accented letter the bank lacks: write the plain letter, and say so.
    const base = [...segment.normalize('NFD')].filter((c) => !COMBINING.test(c)).join('');
    if (base !== segment && base !== '' && [...base].every(canWrite)) {
      note(segment, base, true);
      out += base;
      continue;
    }

    const entry = unsupported.get(segment);
    if (entry) entry.count++;
    else unsupported.set(segment, { char: segment, count: 1, kind: kindOf(segment) });
    out += segment;
  }

  return { text: out, replaced: [...replaced.values()], unsupported: [...unsupported.values()] };
}

/**
 * The warnings to show before export: one plain sentence per problem. Empty when the
 * whole text can be written faithfully.
 */
export function describeProblems(
  result: Pick<NormalizeResult, 'replaced' | 'unsupported'>,
): string[] {
  const times = (n: number): string => (n === 1 ? 'once' : `${n} times`);
  return [
    ...result.unsupported.map(
      (u) =>
        `"${u.char}" (${u.kind}) appears ${times(u.count)} and cannot be written in your handwriting. A gap will be left.`,
    ),
    ...result.replaced
      .filter((r) => r.lossy)
      .map((r) => `"${r.from}" appears ${times(r.count)} and will be written as "${r.to}".`),
  ];
}
