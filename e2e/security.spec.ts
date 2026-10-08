import { expect, test } from '@playwright/test';

/** Protections a visitor's browser and the worker enforce. */

const WORKER = 'http://localhost:8787';

test('every page is served with the security headers', async ({ request }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'not a layout test');
  for (const path of ['/', '/editor', '/sample', '/pricing', '/legal/privacy']) {
    const headers = (await request.get(path)).headers();
    const policy = headers['content-security-policy']!;
    expect(policy, path).toContain("default-src 'self'");
    expect(policy).toContain("object-src 'none'");
    expect(policy).toContain("frame-ancestors 'none'");
    expect(policy).toContain("base-uri 'self'");
    // Data may only be sent to the site itself and the export worker.
    expect(policy).toContain(`connect-src 'self' ${WORKER}`);
    expect(policy).not.toContain('*');
    expect(policy).not.toContain('unsafe-eval');

    expect(headers['strict-transport-security']).toContain('max-age=63072000');
    expect(headers['x-content-type-options']).toBe('nosniff');
    expect(headers['x-frame-options']).toBe('DENY');
    expect(headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
    expect(headers['permissions-policy']).toContain('camera=()');
    expect(headers['x-powered-by']).toBeUndefined();
  }
});

test('the pages work under that policy: nothing is blocked', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'not a layout test');
  const blocked: string[] = [];
  page.on('console', (message) => {
    if (/Content Security Policy|Refused to/i.test(message.text())) blocked.push(message.text());
  });
  await page.goto('/');
  await page.getByTestId('demo-text').fill('Checking the policy.');
  await expect(page.getByTestId('demo-image')).toHaveAttribute('src', /^data:image/);
  await page.goto('/editor');
  await expect(page.getByTestId('preview-image')).toBeVisible();
  expect(blocked).toEqual([]);
});

test('the worker answers with strict headers and only to the web app', async ({
  request,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'not a layout test');
  const headers = (await request.get(`${WORKER}/health`)).headers();
  expect(headers['content-security-policy']).toBe("default-src 'none'; frame-ancestors 'none'");
  expect(headers['x-content-type-options']).toBe('nosniff');
  expect(headers['x-frame-options']).toBe('DENY');
  expect(headers['cache-control']).toBe('no-store');
  expect(headers['referrer-policy']).toBe('no-referrer');
  expect(headers['strict-transport-security']).toContain('max-age=');
  // Browsers on any other site are not given permission to read the answers.
  expect(headers['access-control-allow-origin']).toBe('http://localhost:3100');
});

test('a file dressed up as another kind is refused before it is parsed', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'not a layout test');
  await page.goto('/editor');
  await expect(page.getByTestId('preview-image')).toBeVisible();

  // A web page named like a PDF.
  await page.getByTestId('file-input').setInputFiles({
    name: 'homework.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('<html><script>alert(1)</script></html>'),
  });
  await expect(page.getByText('named like a PDF but is not one')).toBeVisible();

  // A program named like a Word document.
  await page.getByTestId('file-input').setInputFiles({
    name: 'essay.docx',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    buffer: Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00]),
  });
  await expect(page.getByText('named like a Word document but is not one')).toBeVisible();

  // A program named like a photo of handwriting.
  await page.goto('/sample');
  await page.getByTestId('sample-photo').setInputFiles({
    name: 'page.jpg',
    mimeType: 'image/jpeg',
    buffer: Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00, 0x04, 0x00]),
  });
  await expect(page.getByText('not a picture we can read')).toBeVisible();
});
