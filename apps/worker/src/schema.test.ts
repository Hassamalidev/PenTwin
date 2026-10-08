import { describe, expect, it } from 'vitest';
import { exportRequestSchema, MAX_IMAGE_CHARS, MAX_IMAGES } from './schema';

const PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const JPEG_START = '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBD';
const bank = {
  metadata: { version: 1, unitsPerEm: 1000, baseline: 800, glyphs: {} },
  files: {},
};
const picture = (href: string) => ({ type: 'image', href, width: 40, height: 30 });

/** The first problem found with the request's blocks, or undefined when it is accepted. */
const problem = (blocks: unknown[]): string | undefined => {
  const parsed = exportRequestSchema.safeParse({ blocks, bank, options: { seed: 1 } });
  if (parsed.success) return undefined;
  const issue = parsed.error.issues.find((item) => item.path[0] === 'blocks');
  // Any other problem would be with this test's bank, not with the pictures.
  return issue ? issue.message : undefined;
};

describe('pictures in an export request', () => {
  it('accepts real PNG and JPEG data', () => {
    expect(problem([picture(`data:image/png;base64,${PNG}`)])).toBeUndefined();
    expect(problem([picture(`data:image/jpeg;base64,${JPEG_START}`)])).toBeUndefined();
    expect(problem([picture(`data:image/jpg;base64,${JPEG_START}`)])).toBeUndefined();
  });

  it('refuses data that is not the picture it claims to be', () => {
    const html = Buffer.from('<html><script>alert(1)</script></html>').toString('base64');
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>').toString('base64');
    for (const href of [
      `data:image/png;base64,${html}`,
      `data:image/png;base64,${svg}`,
      // A real JPEG labelled as a PNG, and the other way round.
      `data:image/png;base64,${JPEG_START}`,
      `data:image/jpeg;base64,${PNG}`,
    ]) {
      expect(problem([picture(href)]), href.slice(0, 40)).toBe(
        'The picture is not a valid PNG or JPEG.',
      );
    }
  });

  it('refuses anything that is not carried in the request itself', () => {
    for (const href of [
      'https://example.com/a.png',
      'file:///etc/passwd',
      'data:image/svg+xml;base64,PHN2Zy8+',
      `data:text/html;base64,${PNG}`,
      `data:image/png,${PNG}`,
    ]) {
      expect(problem([picture(href)]), href).toBeDefined();
    }
  });

  it('limits how large one picture is and how many there are', () => {
    const huge = `data:image/png;base64,${PNG}${'A'.repeat(MAX_IMAGE_CHARS)}`;
    expect(problem([picture(huge)])).toBe('The picture is too large.');

    const one = picture(`data:image/png;base64,${PNG}`);
    expect(problem(Array.from({ length: MAX_IMAGES }, () => one))).toBeUndefined();
    expect(problem(Array.from({ length: MAX_IMAGES + 1 }, () => one))).toBe(
      `A document can hold at most ${MAX_IMAGES} pictures.`,
    );
  });
});
