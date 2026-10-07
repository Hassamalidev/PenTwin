import {
  parsePath,
  pathBounds,
  REQUIRED_CHARS,
  serializePath,
  transformPath,
  type GlyphMetadata,
  type PathCommand,
  type PointFn,
} from '@pentwin/engine';
import type { ExtractedBank } from './extract';

type Variant = GlyphMetadata['glyphs'][string][number];

export interface DerivedGlyph {
  char: string;
  /**
   * `reused`: a copy of the user's own glyph for this character, slightly reshaped.
   * `transformed`: built from a different character.
   */
  method: 'reused' | 'transformed';
  /** Plain description, shown to the user. */
  from: string;
}

export interface FallbackResult {
  bank: ExtractedBank;
  /** Every glyph that was added. Nothing is ever added without appearing here. */
  derived: DerivedGlyph[];
  topUp: {
    /** Characters that could not be made at all. The user has to write these. */
    required: string[];
    /** Characters now covered only by derived glyphs. Writing them would improve the bank. */
    recommended: string[];
  };
}

/** A glyph in writing coordinates: x from the pen, y from the baseline (down is positive). */
interface Shape {
  path: PathCommand[];
  lsb: number;
  rsb: number;
}

const PATH_D = /<path\b[^>]*?\sd="([^"]*)"/;

function loadShape(bank: ExtractedBank, variant: Variant): Shape {
  const d = PATH_D.exec(bank.files[variant.file] ?? '')?.[1] ?? '';
  return {
    path: transformPath(parsePath(d), (x, y) => [x, y - variant.baseline]),
    lsb: variant.lsb,
    rsb: variant.rsb,
  };
}

const map = (shape: Shape, fn: PointFn): Shape => ({
  ...shape,
  path: transformPath(shape.path, fn),
});
const scale = (shape: Shape, sx: number, sy = sx): Shape => map(shape, (x, y) => [x * sx, y * sy]);
const shift = (shape: Shape, dx: number, dy: number): Shape =>
  map(shape, (x, y) => [x + dx, y + dy]);
const join = (a: Shape, b: Shape): Shape => ({
  path: [...a.path, ...b.path],
  lsb: a.lsb,
  rsb: b.rsb,
});
const mirror = (shape: Shape): Shape => {
  const { minX, maxX } = pathBounds(shape.path);
  return {
    path: transformPath(shape.path, (x, y) => [minX + maxX - x, y]),
    lsb: shape.rsb,
    rsb: shape.lsb,
  };
};
/** Turns a shape a quarter turn about its own centre. */
const quarterTurn = (shape: Shape): Shape => {
  const b = pathBounds(shape.path);
  const cx = (b.minX + b.maxX) / 2;
  const cy = (b.minY + b.maxY) / 2;
  return map(shape, (x, y) => [cx - (y - cy), cy + (x - cx)]);
};
/** Moves a shape vertically so its top edge is at `y`. */
const topAt = (shape: Shape, y: number): Shape => shift(shape, 0, y - pathBounds(shape.path).minY);

interface Recipe {
  /** Characters this recipe is built from. All must be in the bank. */
  sources: string[];
  describe: string;
  build: (shapes: Shape[], sizes: { x: number; cap: number }) => Shape;
}

const grow: Recipe['build'] = ([s], { x, cap }) => scale(s!, cap / x);
const shrink: Recipe['build'] = ([s], { x, cap }) => scale(s!, x / cap);
const same: Recipe['build'] = ([s]) => s!;

/** For a missing character, the ways to make it, best first. */
const RECIPES: Record<string, Recipe[]> = {
  // Capitals that are their lowercase letter written larger, and the reverse.
  ...Object.fromEntries(
    [...'cosvwxz'].flatMap((lower) => {
      const upper = lower.toUpperCase();
      return [
        [upper, [{ sources: [lower], describe: `"${lower}" written larger`, build: grow }]],
        [lower, [{ sources: [upper], describe: `"${upper}" written smaller`, build: shrink }]],
      ];
    }),
  ),
  '0': [
    { sources: ['O'], describe: '"O" made narrower', build: ([s]) => scale(s!, 0.8, 1) },
    {
      sources: ['o'],
      describe: '"o" written larger and narrower',
      build: ([s], { x, cap }) => scale(s!, (cap / x) * 0.8, cap / x),
    },
  ],
  I: [{ sources: ['l'], describe: '"l"', build: same }],
  l: [{ sources: ['I'], describe: '"I"', build: same }],
  '1': [
    { sources: ['l'], describe: '"l"', build: same },
    { sources: ['I'], describe: '"I"', build: same },
  ],
  ':': [
    {
      sources: ['.', '.'],
      describe: 'two "." one above the other',
      build: ([a, b], { x }) => join(a!, shift(b!, 0, -0.7 * x)),
    },
  ],
  ';': [
    {
      sources: [',', '.'],
      describe: '"." above ","',
      build: ([comma, dot], { x }) => join(comma!, shift(dot!, 0, -0.7 * x)),
    },
  ],
  '=': [
    {
      sources: ['-', '-'],
      describe: 'two "-" one above the other',
      build: ([a, b], { x }) => join(shift(a!, 0, -0.15 * x), shift(b!, 0, 0.15 * x)),
    },
  ],
  '+': [
    {
      sources: ['-', '-'],
      describe: 'two "-" crossed',
      build: ([a, b]) => join(a!, quarterTurn(b!)),
    },
  ],
  '"': [
    {
      sources: ["'", "'"],
      describe: `two "'" side by side`,
      build: ([a, b], { x }) => join(a!, shift(b!, 0.3 * x, 0)),
    },
  ],
  "'": [{ sources: [','], describe: '"," raised', build: ([s], { cap }) => topAt(s!, -cap) }],
  ',': [{ sources: ["'"], describe: `"'" lowered`, build: ([s], { x }) => topAt(s!, -0.12 * x) }],
  '(': [{ sources: [')'], describe: '")" mirrored', build: ([s]) => mirror(s!) }],
  ')': [{ sources: ['('], describe: '"(" mirrored', build: ([s]) => mirror(s!) }],
};

const fileFor = (char: string, index: number, files: Record<string, string>): string => {
  const code = char.codePointAt(0)!.toString(16).padStart(4, '0');
  let n = index;
  while (files[`u${code}-d${n}.svg`]) n++;
  return `u${code}-d${n}.svg`;
};

const round = (v: number): number => Math.round(v * 10) / 10;

/** Writes a shape into the bank as a new, marked variant. */
function addVariant(bank: ExtractedBank, char: string, shape: Shape, derivedFrom: string): void {
  const b = pathBounds(shape.path);
  const local = transformPath(shape.path, (x, y) => [x - b.minX, y - b.minY]);
  const width = b.maxX - b.minX;
  const variants = (bank.metadata.glyphs[char] ??= []);
  const file = fileFor(char, variants.length + 1, bank.files);
  bank.files[file] =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${round(width)} ${round(b.maxY - b.minY)}">` +
    `<path d="${serializePath(local, 1)}"/></svg>`;
  variants.push({
    file,
    advance: Math.max(round(width * 0.2), round(shape.lsb + width + shape.rsb)),
    lsb: round(shape.lsb),
    rsb: round(shape.rsb),
    baseline: round(-b.minY),
    derivedFrom,
  });
}

/** Small, fixed reshapings, so a reused glyph is not a pixel-identical twin. */
const RESHAPE: PointFn[] = [
  (x, y) => [x * 1.04 - y * 0.03, y * 0.97],
  (x, y) => [x * 0.96 + y * 0.03, y * 1.03],
];

/**
 * Fills the gaps in an extracted bank, in order of how faithful the result is:
 *
 * 1. A character with only one or two variants gets reshaped copies of its own.
 * 2. A character with none is built from related characters where a sound recipe exists.
 * 3. Whatever is left is listed for the user to write on a top-up sheet.
 *
 * Every glyph added is marked `derivedFrom` in the bank and listed in the result. The
 * input bank is not modified.
 */
export function applyFallbacks(
  input: ExtractedBank,
  required: readonly string[] = REQUIRED_CHARS,
  minVariants = 3,
): FallbackResult {
  const bank: ExtractedBank = {
    metadata: structuredClone(input.metadata),
    files: { ...input.files },
  };
  const sizes = { x: bank.metadata.xHeight, cap: bank.metadata.capHeight };
  const derived: DerivedGlyph[] = [];
  const stillMissing: string[] = [];
  const own = (char: string): Variant[] =>
    (input.metadata.glyphs[char] ?? []).filter((v) => !v.derivedFrom);

  // Missing characters are built only from what the user actually wrote.
  for (const char of required) {
    if ((bank.metadata.glyphs[char]?.length ?? 0) > 0) continue;
    const recipe = RECIPES[char]?.find((r) => r.sources.every((s) => own(s).length > 0));
    if (!recipe) {
      stillMissing.push(char);
      continue;
    }
    const count = Math.min(minVariants, ...recipe.sources.map((s) => own(s).length));
    for (let i = 0; i < count; i++) {
      // Different variants for each use of a source, so ":" is not the same dot twice.
      const shapes = recipe.sources.map((s, k) => {
        const variants = own(s);
        return loadShape(input, variants[(i + k) % variants.length]!);
      });
      addVariant(bank, char, recipe.build(shapes, sizes), recipe.describe);
      derived.push({ char, method: 'transformed', from: recipe.describe });
    }
  }

  for (const char of required) {
    const originals = own(char);
    const have = bank.metadata.glyphs[char]?.length ?? 0;
    if (originals.length === 0 || have >= minVariants) continue;
    for (let i = 0; have + i < minVariants; i++) {
      const source = loadShape(input, originals[i % originals.length]!);
      const from = `your own "${char}", reshaped slightly`;
      addVariant(bank, char, map(source, RESHAPE[i % RESHAPE.length]!), from);
      derived.push({ char, method: 'reused', from });
    }
  }

  return {
    bank,
    derived,
    topUp: {
      required: stillMissing,
      recommended: [
        ...new Set(derived.filter((d) => d.method === 'transformed').map((d) => d.char)),
      ],
    },
  };
}
