import type { Block, Run } from '@pentwin/engine';
import {
  normalizeText,
  type NormalizeResult,
  type Replacement,
  type UnsupportedChar,
} from './normalize';

/** Plain text to blocks: paragraphs are separated by blank lines. */
export function textToBlocks(text: string): Block[] {
  return text
    .replace(/\r\n?/g, '\n')
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .map((paragraph): Block => ({ type: 'paragraph', text: paragraph }));
}

/** Applies `fn` to every piece of text in a block, leaving its structure alone. */
export function mapBlockText(block: Block, fn: (text: string) => string): Block {
  const content = (value: string | Run[]): string | Run[] =>
    typeof value === 'string' ? fn(value) : value.map((run) => ({ ...run, text: fn(run.text) }));
  switch (block.type) {
    case 'heading':
      return { ...block, text: fn(block.text) };
    case 'paragraph':
      return { ...block, text: content(block.text) };
    case 'list':
      return { ...block, items: block.items.map(content) };
    case 'table':
      return { ...block, rows: block.rows.map((row) => row.map(fn)) };
    default:
      return block;
  }
}

/**
 * Normalizes all the text in a document for handwriting, and gathers one combined list
 * of what was replaced and what cannot be written.
 */
export function normalizeBlocks(
  blocks: readonly Block[],
  canWrite: (char: string) => boolean,
): { blocks: Block[] } & Pick<NormalizeResult, 'replaced' | 'unsupported'> {
  const replaced = new Map<string, Replacement>();
  const unsupported = new Map<string, UnsupportedChar>();
  const merge = <T extends { count: number }>(into: Map<string, T>, key: string, item: T): void => {
    const existing = into.get(key);
    if (existing) existing.count += item.count;
    else into.set(key, { ...item });
  };

  const out = blocks.map((block) =>
    mapBlockText(block, (text) => {
      const result = normalizeText(text, canWrite);
      for (const r of result.replaced) merge(replaced, r.from, r);
      for (const u of result.unsupported) merge(unsupported, u.char, u);
      return result.text;
    }),
  );
  return { blocks: out, replaced: [...replaced.values()], unsupported: [...unsupported.values()] };
}

const MARKED = /(\*\*[^*\n]+\*\*|\*[^*\n]+\*)/;

/**
 * Text with its bold and italic shown as `**bold**` and `*italic*`, so it can be edited
 * in a plain text box without losing them.
 */
export function contentToMarkup(content: string | Run[]): string {
  if (typeof content === 'string') return content;
  return content
    .map((run) => {
      if (!run.bold && !run.italic) return run.text;
      // Keep surrounding spaces outside the markers, where they still read as markup.
      const [, lead = '', body = '', trail = ''] = /^(\s*)(.*?)(\s*)$/s.exec(run.text) ?? [];
      const mark = run.bold ? '**' : '*';
      return body ? `${lead}${mark}${body}${mark}${trail}` : run.text;
    })
    .join('');
}

/** The reverse of `contentToMarkup`. Text without any markup comes back as a plain string. */
export function markupToContent(markup: string): string | Run[] {
  const parts = markup.split(MARKED).filter((part) => part !== '');
  if (parts.every((part) => !MARKED.test(part))) return markup;
  return parts.map((part): Run => {
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
      return { text: part.slice(2, -2), bold: true };
    }
    if (part.startsWith('*') && part.endsWith('*') && part.length > 2) {
      return { text: part.slice(1, -1), italic: true };
    }
    return { text: part };
  });
}
