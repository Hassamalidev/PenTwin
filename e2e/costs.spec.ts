import { expect, test } from '@playwright/test';

/**
 * The cost dashboard, with the worker's answer stood in for: the real report needs a
 * database and is covered by the database tests.
 */
const report = {
  costPerPage: 0.0031,
  alerts: ['Cost per page on the pro plan is $0.0142, above the $0.01 limit.'],
  plans: [
    {
      plan: 'free',
      exports: 40,
      pages: 120,
      chargedPages: 120,
      computeSeconds: 18.4,
      cost: 0.02,
      costPerPage: 0.0002,
      marginAtFullUse: -0.001,
      overLimit: false,
    },
    {
      plan: 'student',
      exports: 12,
      pages: 610,
      chargedPages: 590,
      computeSeconds: 96.2,
      cost: 0.61,
      costPerPage: 0.001,
      marginAtFullUse: 3.85,
      overLimit: false,
    },
    {
      plan: 'pro',
      exports: 3,
      pages: 900,
      chargedPages: 900,
      computeSeconds: 4100,
      cost: 12.78,
      costPerPage: 0.0142,
      marginAtFullUse: 1.9,
      overLimit: true,
    },
  ],
};

test('the cost dashboard shows cost per page, margin per plan and alerts', async ({ page }) => {
  // Only the worker's address is stood in for, not the page itself.
  const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' };
  await page.route('http://localhost:8787/admin/costs', async (route) => {
    if (route.request().method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers: cors });
      return;
    }
    const authorized = route.request().headers().authorization === 'Bearer right-token';
    await route.fulfill(
      authorized
        ? { status: 200, json: report, headers: cors }
        : { status: 404, json: { error: 'Not found.' }, headers: cors },
    );
  });
  await page.goto('/admin/costs');

  await page.getByLabel('Admin token').fill('wrong-token');
  await page.getByRole('button', { name: 'Show report' }).click();
  await expect(page.getByText('the token is wrong')).toBeVisible();
  await expect(page.getByTestId('cost-report')).toHaveCount(0);

  await page.getByLabel('Admin token').fill('right-token');
  await page.getByRole('button', { name: 'Show report' }).click();
  await expect(page.getByTestId('cost-overall')).toHaveText('$0.0031 per page overall');
  await expect(page.getByTestId('cost-alerts')).toContainText('pro plan is $0.0142');

  const rows = page.getByTestId('cost-report').locator('tbody tr');
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(1)).toContainText('Student');
  await expect(rows.nth(1)).toContainText('$0.0010'); // per page
  await expect(rows.nth(1)).toContainText('$3.85'); // margin
  await expect(rows.nth(2)).toHaveClass(/over-limit/);
});
