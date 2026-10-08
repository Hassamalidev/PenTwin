import type { Block } from '@pentwin/engine';
import { importDocx, importPdf, textToBlocks } from '@pentwin/importers';

export interface ImportedFile {
  blocks: Block[];
  warnings: string[];
}

export const ACCEPTED_FILES = '.docx,.pdf,.txt';
/** Larger files are refused before reading: they would only stall a phone. */
export const MAX_FILE_BYTES = 20 * 1024 * 1024;

/** Reads a Word, PDF or text file chosen by the user. Everything happens in the browser. */
export async function importFile(file: File): Promise<ImportedFile> {
  if (file.size > MAX_FILE_BYTES) {
    throw new Error('This file is larger than 20 MB. Please use a smaller one.');
  }
  const name = file.name.toLowerCase();
  const bytes = new Uint8Array(await file.arrayBuffer());

  if (name.endsWith('.docx')) return importDocx(bytes);
  if (name.endsWith('.pdf')) {
    // pdf.js does its parsing in a web worker, which has to be pointed at its script.
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    pdfjs.GlobalWorkerOptions.workerSrc = new URL(
      'pdfjs-dist/legacy/build/pdf.worker.mjs',
      import.meta.url,
    ).toString();
    const { blocks, warnings } = await importPdf(bytes);
    return { blocks, warnings };
  }
  if (name.endsWith('.txt')) {
    return { blocks: textToBlocks(new TextDecoder().decode(bytes)), warnings: [] };
  }
  if (name.endsWith('.doc')) {
    throw new Error('Old .doc files are not supported. Save the document as .docx and try again.');
  }
  throw new Error('This file type is not supported. Use a .docx, .pdf or .txt file.');
}
