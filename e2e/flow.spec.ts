import { expect, test } from '@playwright/test';

/** Saved handwriting on this device, as if from an earlier visit. */
const returning = async (page: import('@playwright/test').Page): Promise<void> => {
  await page.goto('/');
  await page.evaluate(async () => {
    const bank = await (await fetch('/demo-bank.json')).text();
    localStorage.setItem('pentwin.bank.v1', bank);
  });
};

test('a new visitor can go on without a pen, and always sees where they are', async ({ page }) => {
  await page.goto('/sample');
  await expect(page.getByTestId('journey')).toBeVisible();
  await expect(page.getByTestId('returning')).toHaveCount(0);
  await page.getByRole('link', { name: /Try the editor with the sample handwriting/ }).click();
  await expect(page).toHaveURL(/\/editor/);
  await expect(page.getByTestId('preview-image')).toBeVisible();
  // Nothing has been photographed, so the first steps are not shown as done.
  await expect(page.getByTestId('journey').locator('li.done')).toHaveCount(0);
  await page.getByTestId('use-my-handwriting').click();
  await expect(page).toHaveURL(/\/sample/);
});

test('someone with saved handwriting goes straight on, or checks it, or starts again', async ({
  page,
}) => {
  await returning(page);
  await page.goto('/sample');
  await expect(page.getByTestId('returning')).toBeVisible();
  await expect(page.getByTestId('sample-photo')).toHaveCount(0);

  await page.getByTestId('review-saved').click();
  await expect(page.getByTestId('review')).toBeVisible();

  await page.goto('/sample');
  await page.getByTestId('replace-saved').click();
  await expect(page.getByTestId('sample-photo')).toBeAttached();

  await page.goto('/sample');
  await page.getByTestId('go-to-editor').click();
  await expect(page.getByTestId('preview-image')).toBeVisible();
  await expect(page.getByTestId('demo-notice')).toHaveCount(0);
  await expect(page.getByTestId('journey').locator('li.done')).toHaveCount(2);
});

test('the main choices are on view, and the rest are one tap away', async ({ page }) => {
  await page.goto('/editor');
  await expect(page.getByLabel('Writing style')).toBeVisible();
  await expect(page.getByTestId('finish')).toBeVisible();
  await expect(page.getByLabel('Page size')).toBeHidden();
  await page.getByTestId('more-settings').locator('summary').click();
  await expect(page.getByLabel('Page size')).toBeVisible();
});

test('on a phone, export stays in reach however long the page is', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'phone', 'phone layout only');
  await page.goto('/editor');
  await expect(page.getByTestId('preview-image')).toBeVisible();
  const bar = page.getByTestId('export-open-bar');
  await expect(bar).toBeInViewport();
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight / 2));
  await expect(bar).toBeInViewport();
  await bar.click();
  await expect(page.getByTestId('export-dialog')).toBeVisible();
  await expect(page.getByTestId('journey').locator('li.current')).toContainText('Export');
});
