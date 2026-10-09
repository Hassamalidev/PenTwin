import { expect, test } from '@playwright/test';

test('the editor opens with a live preview in the demo handwriting', async ({ page }, testInfo) => {
  await page.goto('/editor');
  await expect(page.getByTestId('demo-notice')).toBeVisible();
  await expect(page.getByTestId('preview-image')).toBeVisible();
  await expect(page.getByTestId('page-count')).toHaveText('Page 1 of 1');
  await page.screenshot({ path: testInfo.outputPath('editor.png'), fullPage: true });
});

test('what you typed and chose is still there after a reload, until you start over', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'not a layout test');
  await page.goto('/editor');
  await expect(page.getByTestId('preview-image')).toBeVisible();
  await expect(page.getByTestId('draft-note')).toContainText('kept in this browser');

  const first = page.getByTestId('block-paragraph').first().locator('textarea');
  await first.fill('Notes for Thursday: bring the lab book.');
  await page.getByLabel('Writing style').selectOption('rushed');
  // Saved shortly after the last change.
  await expect
    .poll(() => page.evaluate(() => window.localStorage.getItem('pentwin.draft.v1') ?? ''))
    .toContain('Notes for Thursday');

  await page.reload();
  await expect(first).toHaveValue('Notes for Thursday: bring the lab book.');
  await expect(page.getByLabel('Writing style')).toHaveValue('rushed');
  await expect(page.getByTestId('draft-note')).toContainText('We brought back');

  await page.getByTestId('start-over').click();
  await expect(first).toHaveValue(/This is your handwriting preview/);
  await expect(page.getByLabel('Writing style')).toHaveValue('normal');
  await page.reload();
  await expect(first).toHaveValue(/This is your handwriting preview/);
});

test('a closer look shows the page larger and sharper, and back again', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'not a layout test');
  await page.goto('/editor');
  const image = page.getByTestId('preview-image');
  await expect(image).toBeVisible();
  const size = (): Promise<{ shown: number; real: number }> =>
    image.evaluate((img: HTMLImageElement) => ({
      shown: img.getBoundingClientRect().width,
      real: img.naturalWidth,
    }));
  const whole = await size();

  await page.getByTestId('zoom').click();
  await expect(page.getByTestId('zoom')).toHaveText('Whole page');
  // Drawn again with more detail, not just stretched.
  await expect.poll(async () => (await size()).real).toBeGreaterThan(whole.real * 1.5);
  expect((await size()).shown).toBeGreaterThan(whole.shown * 1.5);
  // The larger page scrolls inside its frame; the screen itself does not scroll sideways.
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);

  await page.getByTestId('zoom').click();
  await expect.poll(async () => (await size()).real).toBe(whole.real);
});

test('the header marks the page you are on', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'not a layout test');
  const main = page.getByRole('navigation', { name: 'Main' });
  await page.goto('/pricing');
  await expect(main.getByRole('link', { name: 'Pricing' })).toHaveAttribute('aria-current', 'page');
  await expect(main.getByRole('link', { name: 'FAQ' })).not.toHaveAttribute('aria-current');
  await page.goto('/editor');
  await expect(main.getByRole('link', { name: 'Open editor' })).toHaveAttribute(
    'aria-current',
    'page',
  );
  await expect(main.getByRole('link', { name: 'Pricing' })).not.toHaveAttribute('aria-current');
});
