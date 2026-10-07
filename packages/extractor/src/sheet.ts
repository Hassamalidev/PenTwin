import { BRAND, MM_TO_PT, PAGE_SIZES } from '@pentwin/shared';
import { PDFDocument, rgb, StandardFonts, type PDFFont } from 'pdf-lib';
import type { SampleText } from './sample-text';

export const SAMPLE_INSTRUCTIONS: readonly string[] = [
  'Use plain white paper with no lines, and a dark pen (blue or black).',
  'Copy the text below in your normal handwriting, at your normal speed.',
  "Don't try to be neat. Your everyday writing gives the best result.",
  'Keep the letters separate where you can; joined-up writing is harder to read back.',
  'Leave a little space between lines. Use a second page if you run out of room.',
  'Photograph the page flat, in good light, with the whole page in the picture.',
];

const wrap = (text: string, font: PDFFont, size: number, maxWidth: number): string[] => {
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const next = line ? `${line} ${word}` : word;
    if (line && font.widthOfTextAtSize(next, size) > maxWidth) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines;
};

/**
 * Builds the one-page A4 sheet a user reads from while writing their sample: the
 * instructions, then the text to copy in a large, clear typeface.
 */
export async function buildSampleSheet(
  sample: Pick<SampleText, 'title' | 'paragraphs'>,
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(`${BRAND.name}: ${sample.title}`);
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  const { widthMm, heightMm } = PAGE_SIZES.A4;
  const page = doc.addPage([widthMm * MM_TO_PT, heightMm * MM_TO_PT]);
  const margin = 20 * MM_TO_PT;
  const maxWidth = page.getWidth() - margin * 2;
  const ink = rgb(0.1, 0.1, 0.12);
  const muted = rgb(0.35, 0.35, 0.4);
  let y = page.getHeight() - margin;

  const write = (text: string, font: PDFFont, size: number, leading: number, color = ink): void => {
    for (const line of wrap(text, font, size, maxWidth)) {
      y -= leading;
      page.drawText(line, { x: margin, y, font, size, color });
    }
  };

  write(`${BRAND.name}: ${sample.title.toLowerCase()}`, bold, 20, 22);
  y -= 10;
  write('How to write your sample', bold, 12, 16);
  SAMPLE_INSTRUCTIONS.forEach((line, i) => write(`${i + 1}. ${line}`, regular, 11, 16, muted));

  y -= 16;
  page.drawLine({
    start: { x: margin, y },
    end: { x: page.getWidth() - margin, y },
    thickness: 0.75,
    color: rgb(0.8, 0.8, 0.84),
  });
  y -= 8;
  write('Copy this text', bold, 12, 18);
  for (const paragraph of sample.paragraphs) {
    y -= 6;
    write(paragraph, regular, 14, 21);
  }

  if (y < margin) throw new Error('Sample text does not fit on one A4 sheet');
  return doc.save();
}
