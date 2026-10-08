import { expect, test } from '@playwright/test';

test('the editor opens with a live preview in the demo handwriting', async ({ page }, testInfo) => {
  await page.goto('/editor');
  await expect(page.getByTestId('demo-notice')).toBeVisible();
  await expect(page.getByTestId('preview-image')).toBeVisible();
  await expect(page.getByTestId('page-count')).toHaveText('Page 1 of 1');
  await page.screenshot({ path: testInfo.outputPath('editor.png'), fullPage: true });
});
