import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { Document, HeadingLevel, Packer, Paragraph, TextRun } from 'docx';
import { PDFDocument } from 'pdf-lib';
import { PRESETS, renderText } from '../packages/engine/src/index';
import { loadGlyphBank, sceneToPng } from '../packages/engine/src/node/index';

const SAMPLE = JSON.parse(readFileSync('docs/sample-text.json', 'utf8')) as {
  paragraphs: string[];
};

/**
 * The whole local flow in a real browser, at desktop and phone width:
 * photo of the handwriting sample -> glyph bank -> upload a Word file -> preview -> export.
 *
 * The "photo" is the sample text written by the engine with the synthetic test glyphs.
 * No real handwriting is involved.
 */

function samplePhoto(): Buffer {
  const { bank } = loadGlyphBank('tests/fixtures/glyphs/sample-user');
  const { pages } = renderText(SAMPLE.paragraphs.join('\n'), bank, {
    seed: 'e2e-photo',
    lineHeight: 10,
    xHeight: 3,
    penWidth: 0.5,
    inkColor: '#1a1a2e',
    jitter: PRESETS.normal,
  });
  return Buffer.from(sceneToPng(pages[0]!, 200));
}

async function sampleDocx(): Promise<Buffer> {
  const doc = new Document({
    sections: [
      {
        children: [
          new Paragraph({ text: 'Lab report', heading: HeadingLevel.HEADING_1 }),
          new Paragraph({
            children: [
              new TextRun('The liquid was '),
              new TextRun({ text: 'heated slowly', bold: true }),
              new TextRun(' and then left to cool.'),
            ],
          }),
          new Paragraph('Each reading was taken after the liquid had settled.'),
        ],
      },
    ],
  });
  return Packer.toBuffer(doc);
}

const previewSource = (page: Page): Promise<string | null> =>
  page.getByTestId('preview-image').getAttribute('src');

test('photo to glyph bank to Word upload to preview to exported PDF', async ({
  page,
  request,
}, testInfo) => {
  // 1. Make a handwriting profile from a photo of the sample.
  await page.goto('/sample');
  await page.getByTestId('sample-photo').setInputFiles({
    name: 'sample.png',
    mimeType: 'image/png',
    buffer: samplePhoto(),
  });
  await expect(page.getByTestId('review')).toBeVisible({ timeout: 90_000 });
  await expect(page.getByTestId('review-summary')).toContainText('good');
  await expect(page.getByTestId('test-sentence')).toBeVisible();
  // Every lowercase letter was found in the sample.
  for (const char of 'aegt') {
    await expect(page.getByTestId(`glyph-${char.codePointAt(0)}`)).toHaveAttribute(
      'data-status',
      'strong',
    );
  }
  // Characters the sample text does not contain are flagged, not silently filled.
  await expect(page.getByTestId(`glyph-${'#'.codePointAt(0)}`)).toHaveAttribute(
    'data-status',
    'missing',
  );
  await expect(page.getByTestId(`glyph-${'='.codePointAt(0)}`)).toHaveAttribute(
    'data-status',
    'derived',
  );
  await expect(page.getByTestId('top-up')).toBeVisible();

  // Fix a "bad g": open it, throw one sample away.
  await page.getByTestId(`glyph-${'g'.codePointAt(0)}`).click();
  const samples = page.getByTestId('glyph-detail').getByTestId('remove-variant');
  const before = await samples.count();
  expect(before).toBeGreaterThanOrEqual(3);
  await samples.first().click();
  await expect(samples).toHaveCount(before - 1);

  await page.screenshot({ path: testInfo.outputPath('review.png'), fullPage: true });

  // Saving needs the user to confirm the handwriting is their own.
  await expect(page.getByTestId('save-bank')).toBeDisabled();
  await page.getByTestId('own-handwriting').check();
  await page.getByTestId('save-bank').click();
  await expect(page.getByTestId('saved')).toBeVisible();

  // 2. Open the editor: it now writes in the saved handwriting, not the demo.
  await page.goto('/editor');
  await expect(page.getByTestId('preview-image')).toBeVisible();
  await expect(page.getByTestId('demo-notice')).toHaveCount(0);

  // 3. Upload a Word document.
  await page.getByTestId('file-input').setInputFiles({
    name: 'report.docx',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    buffer: await sampleDocx(),
  });
  await expect(page.getByTestId('block-heading').getByRole('textbox')).toHaveValue('Lab report');
  await expect(page.getByTestId('block-paragraph').first().getByRole('textbox')).toHaveValue(
    'The liquid was **heated slowly** and then left to cool.',
  );
  await expect(page.getByTestId('page-count')).toHaveText('Page 1 of 1');

  // 4. The preview follows the settings.
  const first = await previewSource(page);
  await page.getByTestId('reroll').click();
  await expect.poll(() => previewSource(page)).not.toBe(first);
  const rerolled = await previewSource(page);
  await page.getByTestId('paper').selectOption('plain');
  await expect.poll(() => previewSource(page)).not.toBe(rerolled);

  // 5. Per-block overrides: a page break after the first paragraph makes two pages.
  await page
    .getByTestId('block-paragraph')
    .first()
    .getByRole('button', { name: 'Break after' })
    .click();
  await expect(page.getByTestId('block-pageBreak')).toBeVisible();
  await expect(page.getByTestId('page-count')).toHaveText('Page 1 of 2');

  // A character the handwriting cannot write is listed before export.
  await page
    .getByTestId('block-paragraph')
    .last()
    .getByRole('textbox')
    .fill('Temperature \u2264 40 degrees.');
  await expect(page.getByTestId('problems')).toContainText('math symbol');

  // 6. Export: the dialog states pages and cost first, and the PDF matches.
  await page.getByTestId('export-open').click();
  await expect(page.getByTestId('quote')).toHaveText('2 pages, 2 credits');
  await page.screenshot({ path: testInfo.outputPath('export-dialog.png') });
  await page.getByTestId('export-confirm').click();
  await expect(page.getByTestId('export-result')).toContainText('2 pages', { timeout: 60_000 });

  const href = await page.getByTestId('download').getAttribute('href');
  const file = await request.get(href!);
  expect(file.status()).toBe(200);
  expect(file.headers()['content-type']).toBe('application/pdf');
  const pdf = await PDFDocument.load(await file.body());
  expect(pdf.getPageCount()).toBe(2);

  // 7. Exporting the very same document again is served from the cache, for free.
  await page.getByRole('button', { name: 'Close' }).click();
  await page.getByTestId('export-open').click();
  await page.getByTestId('export-confirm').click();
  await expect(page.getByTestId('export-result')).toContainText('free', { timeout: 60_000 });
});

test('an unusable photo is turned away with advice', async ({ page }) => {
  await page.goto('/sample');
  // A blank white page: no writing on it.
  const blank = await page.evaluate(async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 1200;
    canvas.height = 1600;
    const context = canvas.getContext('2d')!;
    context.fillStyle = '#f2f2f2';
    context.fillRect(0, 0, 1200, 1600);
    const blob = await new Promise<Blob>((resolve) =>
      canvas.toBlob((b) => resolve(b!), 'image/png'),
    );
    return Array.from(new Uint8Array(await blob.arrayBuffer()));
  });
  await page.getByTestId('sample-photo').setInputFiles({
    name: 'blank.png',
    mimeType: 'image/png',
    buffer: Buffer.from(blank),
  });
  await expect(page.getByTestId('photo-issues')).toContainText("couldn't find any handwriting");
  await expect(page.getByTestId('review')).toHaveCount(0);
});

test('a PDF uploads into editable paragraphs', async ({ page }) => {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont('Helvetica');
  const sheet = doc.addPage([595, 842]);
  sheet.drawText('Measuring density', { x: 72, y: 770, size: 18, font });
  sheet.drawText('The experiment was repeated three times and the', {
    x: 72,
    y: 730,
    size: 11,
    font,
  });
  sheet.drawText('results were recorded in a table.', { x: 72, y: 716, size: 11, font });

  await page.goto('/editor');
  await expect(page.getByTestId('preview-image')).toBeVisible();
  await page.getByTestId('file-input').setInputFiles({
    name: 'notes.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from(await doc.save()),
  });
  await expect(page.getByTestId('block-heading').getByRole('textbox')).toHaveValue(
    'Measuring density',
  );
  await expect(page.getByTestId('block-paragraph').getByRole('textbox')).toHaveValue(
    'The experiment was repeated three times and the results were recorded in a table.',
  );
});

test('a file of the wrong kind is refused with a clear message', async ({ page }) => {
  await page.goto('/editor');
  await expect(page.getByTestId('preview-image')).toBeVisible();
  await page.getByTestId('file-input').setInputFiles({
    name: 'old.doc',
    mimeType: 'application/msword',
    buffer: Buffer.from('not really a document'),
  });
  await expect(page.getByText('Save the document as .docx')).toBeVisible();
});
