import { extractGlyphBank, type ExtractedBank, type Extraction } from './extract';
import type { RgbaImage } from './image';
import { buildSampleSheet } from './sheet';

/**
 * A short word written at the start of every top-up line. Symbols on their own give no
 * clue about letter size or where the baseline is; these ordinary letters do.
 */
export const TOP_UP_ANCHOR = 'none';

/**
 * The text of a "write these characters" sheet: each character several times in a row,
 * a few groups per line, every line starting with the anchor word.
 */
export function topUpText(chars: readonly string[], repeats = 4, groupsPerLine = 5): string {
  const lines: string[] = [];
  for (let i = 0; i < chars.length; i += groupsPerLine) {
    const groups = chars.slice(i, i + groupsPerLine).map((char) => char.repeat(repeats));
    lines.push([TOP_UP_ANCHOR, ...groups].join(' '));
  }
  return lines.join('\n');
}

/** The printable top-up sheet for the given characters. */
export function buildTopUpSheet(chars: readonly string[]): Promise<Uint8Array> {
  return buildSampleSheet({
    title: `Top-up: ${chars.length} more character${chars.length === 1 ? '' : 's'}`,
    paragraphs: topUpText(chars).split('\n'),
  });
}

/** Extracts the glyphs from a photo of a filled-in top-up sheet. */
export function extractTopUp(photo: RgbaImage, chars: readonly string[]): Extraction {
  return extractGlyphBank(photo, topUpText(chars), { sparse: true });
}

export interface MergeResult {
  bank: ExtractedBank;
  /** How many handwritten variants each character gained. */
  added: Record<string, number>;
  /** How many derived stand-ins were dropped in favour of handwritten glyphs. */
  replaced: Record<string, number>;
}

/**
 * Adds the top-up glyphs for `chars` to an existing bank.
 *
 * Handwritten glyphs already in the bank are always kept. Derived stand-ins for a
 * character are dropped once a handwritten one arrives. Only the requested characters
 * are taken from the top-up; the anchor word is ignored. Neither input is modified.
 */
export function mergeTopUp(
  base: ExtractedBank,
  topUp: ExtractedBank,
  chars: readonly string[],
  maxVariants = 6,
): MergeResult {
  if (base.metadata.xHeight !== topUp.metadata.xHeight) {
    throw new Error('Banks use different glyph units and cannot be merged');
  }
  const bank: ExtractedBank = {
    metadata: structuredClone(base.metadata),
    files: { ...base.files },
  };
  const added: Record<string, number> = {};
  const replaced: Record<string, number> = {};

  for (const char of chars) {
    const incoming = (topUp.metadata.glyphs[char] ?? []).filter((v) => !v.derivedFrom);
    if (incoming.length === 0) continue;

    const existing = bank.metadata.glyphs[char] ?? [];
    const kept = existing.filter((v) => !v.derivedFrom);
    for (const variant of existing.filter((v) => v.derivedFrom)) delete bank.files[variant.file];
    if (existing.length > kept.length) replaced[char] = existing.length - kept.length;

    const code = char.codePointAt(0)!.toString(16).padStart(4, '0');
    const room = Math.max(0, maxVariants - kept.length);
    const taken = incoming.slice(0, room).map((variant) => {
      let n = 1;
      while (bank.files[`u${code}-t${n}.svg`]) n++;
      const file = `u${code}-t${n}.svg`;
      bank.files[file] = topUp.files[variant.file]!;
      return { ...variant, file };
    });
    bank.metadata.glyphs[char] = [...kept, ...taken];
    if (taken.length > 0) added[char] = taken.length;
  }
  return { bank, added, replaced };
}
