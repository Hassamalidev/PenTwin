import type { Block, Run } from '@pentwin/engine';

export interface ImportResult {
  blocks: Block[];
  /** Things that could not be brought across, in plain words. */
  warnings: string[];
}

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

const decode = (text: string): string =>
  text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, code: string) => {
    if (code[0] === '#') {
      const point =
        code[1]?.toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : Number(code.slice(1));
      return Number.isFinite(point) ? String.fromCodePoint(point) : whole;
    }
    return ENTITIES[code.toLowerCase()] ?? whole;
  });

/** Width and height in pixels of a PNG or JPEG, read from its header. */
export function imagePixelSize(bytes: Uint8Array): { width: number; height: number } | undefined {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length > 24 && view.getUint32(0) === 0x89504e47) {
    return { width: view.getUint32(16), height: view.getUint32(20) };
  }
  if (bytes.length > 4 && view.getUint16(0) === 0xffd8) {
    // Walk the JPEG segments to the frame header, which holds the size.
    let at = 2;
    while (at + 9 < bytes.length && bytes[at] === 0xff) {
      const marker = bytes[at + 1]!;
      if (
        marker >= 0xc0 &&
        marker <= 0xcf &&
        marker !== 0xc4 &&
        marker !== 0xc8 &&
        marker !== 0xcc
      ) {
        return { width: view.getUint16(at + 7), height: view.getUint16(at + 5) };
      }
      at += 2 + view.getUint16(at + 2);
    }
  }
  return undefined;
}

/** Screen pixels to millimetres, at the 96 pixels per inch documents assume. */
const PX_TO_MM = 25.4 / 96;

function imageBlock(src: string, warnings: string[]): Block | undefined {
  const match = /^data:image\/([a-z0-9.+-]+);base64,(.+)$/i.exec(src);
  const type = match?.[1]?.toLowerCase();
  if (!match || !['png', 'jpeg', 'jpg'].includes(type ?? '')) {
    warnings.push(
      `A picture${type ? ` of type "${type}"` : ''} could not be imported. Only PNG and JPEG pictures are supported.`,
    );
    return undefined;
  }
  const bytes = Uint8Array.from(atob(match[2]!), (c) => c.charCodeAt(0));
  const size = imagePixelSize(bytes);
  return {
    type: 'image',
    href: src,
    width: (size?.width ?? 240) * PX_TO_MM,
    height: (size?.height ?? 160) * PX_TO_MM,
  };
}

const TAG = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)((?:[^>"']|"[^"]*"|'[^']*')*)>|([^<]+)/g;

/**
 * Converts the simple, well-formed HTML that document converters produce into blocks:
 * headings, paragraphs with bold and italic runs, lists, tables and pictures.
 * This is not a general HTML parser; unknown tags are ignored and their text kept.
 */
export function htmlToBlocks(html: string): ImportResult {
  const blocks: Block[] = [];
  const warnings: string[] = [];

  let runs: Run[] = [];
  let bold = 0;
  let italic = 0;
  let heading: 1 | 2 | undefined;
  /** Open lists, innermost last. Nested lists are flattened into their parent. */
  const lists: { ordered: boolean; items: (string | Run[])[] }[] = [];
  let inItem = false;
  let table: string[][] | undefined;
  let cell: string | undefined;

  const addText = (raw: string): void => {
    const text = decode(raw).replace(/\s+/g, ' ');
    if (!text) return;
    if (cell !== undefined) {
      cell += text;
      return;
    }
    const last = runs.at(-1);
    const style = { ...(bold > 0 ? { bold: true } : {}), ...(italic > 0 ? { italic: true } : {}) };
    if (last && Boolean(last.bold) === bold > 0 && Boolean(last.italic) === italic > 0) {
      last.text += text;
    } else {
      runs.push({ text, ...style });
    }
  };

  /** The collected runs as content, or undefined if they hold no text. */
  const takeContent = (): string | Run[] | undefined => {
    const content = runs
      .map((run) => ({ ...run, text: run.text }))
      .filter((run) => run.text.trim() !== '');
    runs = [];
    if (content.length === 0) return undefined;
    content[0]!.text = content[0]!.text.trimStart();
    content.at(-1)!.text = content.at(-1)!.text.trimEnd();
    const plain = content.every((run) => !run.bold && !run.italic);
    return plain ? content.map((run) => run.text).join('') : content;
  };

  const flushParagraph = (): void => {
    const content = takeContent();
    if (content === undefined) return;
    if (heading) {
      const text = typeof content === 'string' ? content : content.map((r) => r.text).join('');
      blocks.push({ type: 'heading', text, level: heading });
    } else if (inItem && lists.length > 0) {
      lists.at(-1)!.items.push(content);
    } else {
      blocks.push({ type: 'paragraph', text: content });
    }
  };

  for (const match of html.matchAll(TAG)) {
    if (match[4] !== undefined) {
      addText(match[4]);
      continue;
    }
    const closing = match[1] === '/';
    const tag = match[2]!.toLowerCase();

    switch (tag) {
      case 'strong':
      case 'b':
        bold += closing ? -1 : 1;
        break;
      case 'em':
      case 'i':
        italic += closing ? -1 : 1;
        break;
      case 'br':
        addText(' ');
        break;
      case 'h1':
      case 'h2':
      case 'h3':
      case 'h4':
      case 'h5':
      case 'h6':
        flushParagraph();
        heading = closing ? undefined : tag === 'h1' ? 1 : 2;
        break;
      case 'p':
        // Inside a list item or table cell a paragraph is just more of the same text.
        if (cell !== undefined) cell += closing ? ' ' : '';
        else if (!inItem) flushParagraph();
        else if (closing) addText(' ');
        break;
      case 'ul':
      case 'ol':
        flushParagraph();
        if (!closing) {
          lists.push({ ordered: tag === 'ol', items: [] });
        } else {
          const done = lists.pop();
          if (!done) break;
          const parent = lists.at(-1);
          if (parent) parent.items.push(...done.items);
          else if (done.items.length > 0) blocks.push({ type: 'list', ...done });
        }
        inItem = false;
        break;
      case 'li':
        flushParagraph();
        inItem = !closing;
        break;
      case 'table':
        flushParagraph();
        if (!closing) table = [];
        else {
          if (table && table.length > 0) blocks.push({ type: 'table', rows: table });
          table = undefined;
        }
        break;
      case 'tr':
        if (!closing) table?.push([]);
        break;
      case 'td':
      case 'th':
        if (!closing) cell = '';
        else {
          table?.at(-1)?.push((cell ?? '').replace(/\s+/g, ' ').trim());
          cell = undefined;
        }
        break;
      case 'img': {
        const src = /\ssrc\s*=\s*("([^"]*)"|'([^']*)')/i.exec(match[3] ?? '');
        flushParagraph();
        const block = imageBlock(decode(src?.[2] ?? src?.[3] ?? ''), warnings);
        if (block) blocks.push(block);
        break;
      }
    }
  }
  flushParagraph();
  return { blocks, warnings };
}
