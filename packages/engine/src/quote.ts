import { renderDocument, type Block } from './document';
import type { GlyphBank } from './glyphs';
import type { RenderOptions } from './render';

/** One exported page costs one credit. Previews are free. */
export const CREDITS_PER_PAGE = 1;

export interface ExportQuote {
  /** Exactly how many pages the export will have. */
  pageCount: number;
  /** What the export will cost. */
  credits: number;
  /** The settings that will be used, one short line each, for the user to check. */
  settings: string[];
  /** Characters that cannot be written, with how often each occurs. */
  unknownChars: Record<string, number>;
}

const PAPER_NAMES = { plain: 'Plain', ruled: 'Lined', graph: 'Squared', dotted: 'Dotted' } as const;
const INK_NAMES = {
  'ballpoint-blue': 'Blue ballpoint',
  'ballpoint-black': 'Black ballpoint',
  gel: 'Gel pen',
  fountain: 'Fountain pen',
  pencil: 'Pencil',
} as const;

/**
 * Works out what an export will produce before it is made: the page count, the cost,
 * and a summary of the settings.
 *
 * It lays the document out with the same code, bank, options and seed the export itself
 * uses, so the page count shown is the page count delivered, not an estimate.
 */
export function quoteExport(
  blocks: readonly Block[],
  bank: GlyphBank,
  options: RenderOptions,
): ExportQuote {
  const { pages, report } = renderDocument(blocks, bank, options);
  const paper = options.paper ?? { kind: 'plain' };
  const ink = typeof options.ink === 'string' ? INK_NAMES[options.ink] : 'Custom ink';
  const skipped = blocks.filter((block) => block.skip).length;

  return {
    pageCount: pages.length,
    credits: pages.length * CREDITS_PER_PAGE,
    unknownChars: report.unknownChars,
    settings: [
      `Page size: ${options.pageSize ?? 'A4'}`,
      `Paper: ${PAPER_NAMES[paper.kind]}${paper.kind === 'ruled' ? ` (${paper.ruling ?? 'college'} ruled)` : ''}${paper.marginLine ? ', with margin line' : ''}`,
      `Pen: ${options.ink ? ink : 'Plain blue'}`,
      ...(options.header?.length
        ? [`Header: ${options.header.map((f) => f.label ?? f.value).join(', ')}`]
        : []),
      ...(options.pageNumbers ? ['Page numbers: on'] : []),
      ...(options.corrections ? ['Occasional corrections: on'] : []),
      ...(skipped > 0 ? [`${skipped} block${skipped === 1 ? '' : 's'} left out`] : []),
    ],
  };
}
