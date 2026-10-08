import mammoth from 'mammoth';
import { htmlToBlocks, type ImportResult } from './html';

/**
 * Reads a Word document into blocks: headings, paragraphs with bold and italic, lists,
 * tables and pictures. Page layout, fonts, colours, footnotes and comments are not kept;
 * the text is going to be handwritten, so only its structure matters.
 */
export async function importDocx(data: Uint8Array): Promise<ImportResult> {
  // mammoth reads `buffer` on the server and `arrayBuffer` in the browser, and ignores
  // the other. Both are given, because a bundler may provide a Buffer in the browser too.
  const arrayBuffer = data.buffer.slice(
    data.byteOffset,
    data.byteOffset + data.byteLength,
  ) as ArrayBuffer;
  const input = {
    arrayBuffer,
    ...(typeof Buffer !== 'undefined' ? { buffer: Buffer.from(data) } : {}),
  };
  const { value, messages } = await mammoth.convertToHtml(input);
  const result = htmlToBlocks(value);
  return {
    blocks: result.blocks,
    warnings: [
      ...result.warnings,
      ...messages
        .filter((m) => m.type === 'error')
        .map((m) => `Problem reading the document: ${m.message}`),
    ],
  };
}
