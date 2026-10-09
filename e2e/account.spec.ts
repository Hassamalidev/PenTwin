import { expect, test, type Page, type Route } from '@playwright/test';
import { PLANS } from '../packages/shared/src/plans';

/**
 * Sign-in, the account page, and the editor when accounts are on.
 *
 * EVERYTHING THE PAGES TALK TO HERE IS A STAND-IN made by this file: Supabase's sign-in
 * service, Paddle's checkout script, and the worker's account routes. The stand-ins
 * answer the way the documentation (Supabase, Paddle) or the worker's own tests
 * (apps/worker/src/accounts.db.test.ts) say the real ones do. So this proves the pages
 * behave correctly given those answers. It does not prove a real sign-up or purchase.
 */

const SUPABASE = 'http://localhost:54399';
const WORKER = 'http://localhost:8787';
const USER = '3f2a9c1e-5b7d-4e2a-9c1e-5b7d4e2a9c1e';
const EMAIL = 'sara@example.test';
const PASSWORD = 'correct-horse-battery';

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': '*',
  'access-control-allow-methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'access-control-expose-headers': 'retry-after',
};
const encode = (value: unknown): string => Buffer.from(JSON.stringify(value)).toString('base64url');
/** Shaped like a Supabase access token. Nothing checks its signature in these tests. */
const ACCESS_TOKEN = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({
  sub: USER,
  email: EMAIL,
  role: 'authenticated',
  exp: 4_000_000_000,
})}.signature`;

const account = (overrides: Record<string, unknown> = {}) => ({
  userId: USER,
  plan: 'student',
  planName: 'Student',
  billingInterval: 'month',
  planStatus: 'active',
  cancelAtPeriodEnd: false,
  paidUntil: '2026-11-08T10:00:00.000Z',
  activated: true,
  monthlyPages: 150,
  monthlyUsed: 37,
  monthlyLeft: 113,
  extraPages: 0,
  totalPages: 113,
  creditsResetOn: '2026-11-08T10:00:00.000Z',
  watermark: false,
  maxProfiles: 3,
  referralCode: 'abc123def4',
  ...overrides,
});

interface Recorded {
  method: string;
  path: string;
  body: unknown;
  authorization: string | undefined;
}

/** Puts the stand-ins in place and returns everything the pages sent to them. */
const standIns = async (
  page: Page,
  options: {
    account?: Record<string, unknown>;
    /** Answers to POST /export, in order; the last one repeats. */
    exports?: { status: number; body: unknown; retryAfter?: string }[];
  } = {},
): Promise<Recorded[]> => {
  const calls: Recorded[] = [];
  const exportAnswers = [...(options.exports ?? [])];
  const answer = (route: Route, status: number, body: unknown, headers = {}): Promise<void> =>
    route.fulfill({
      status,
      headers: { ...CORS, ...headers },
      contentType: 'application/json',
      body: JSON.stringify(body),
    });
  const record = (route: Route, base: string): Recorded => {
    const request = route.request();
    const call = {
      method: request.method(),
      path: request.url().slice(base.length),
      body: request.postDataJSON() as unknown,
      authorization: request.headers().authorization,
    };
    if (call.method !== 'OPTIONS') calls.push(call);
    return call;
  };

  await page.route(`${SUPABASE}/**`, async (route) => {
    const call = record(route, SUPABASE);
    if (call.method === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    const sent = (call.body ?? {}) as { password?: string };
    if (call.path.startsWith('/auth/v1/token?grant_type=password')) {
      return sent.password === PASSWORD
        ? answer(route, 200, {
            access_token: ACCESS_TOKEN,
            refresh_token: 'refresh-1',
            expires_in: 3600,
            user: { id: USER, email: EMAIL },
          })
        : answer(route, 400, { error_code: 'invalid_credentials', msg: 'Invalid login' });
    }
    // The project asks new users to confirm their email: no session yet.
    if (call.path.startsWith('/auth/v1/signup')) {
      return answer(route, 200, { id: USER, email: EMAIL, confirmation_sent_at: 'now' });
    }
    return answer(route, 200, {});
  });

  await page.route('https://cdn.paddle.com/**', (route) =>
    route.fulfill({
      contentType: 'text/javascript',
      body: `window.paddleCalls = [];
        window.Paddle = {
          Environment: { set: (name) => window.paddleCalls.push(['environment', name]) },
          Initialize: (options) => window.paddleCalls.push(['initialize', options.token]),
          Checkout: { open: (options) => window.paddleCalls.push(['open', options]) },
        };`,
    }),
  );
  await page.route('https://customer-portal.paddle.test/**', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<h1>Billing portal stand-in</h1>' }),
  );

  await page.route(`${WORKER}/**`, async (route) => {
    const call = record(route, WORKER);
    if (call.method === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    const key = `${call.method} ${call.path}`;
    if (key === 'GET /info') return answer(route, 200, { accounts: true });
    if (call.path.startsWith('/download/')) return route.continue();
    if (key === 'GET /plans') {
      return answer(route, 200, {
        checkout: {
          environment: 'sandbox',
          prices: {
            plans: {
              student: { month: 'pri_student_month', year: 'pri_student_year' },
              pro: { month: 'pri_pro_month', year: 'pri_pro_year' },
            },
            topUp: 'pri_top_up',
          },
        },
      });
    }
    // Every other route needs the user's token, as on the real worker.
    if (call.authorization !== `Bearer ${ACCESS_TOKEN}`) {
      return answer(route, 401, { error: 'Please sign in.' });
    }
    if (key === 'GET /me') {
      return answer(route, 200, {
        account: account(options.account),
        ledger: [
          { amount: -3, reason: 'Export: 3 pages', at: '2026-10-07T09:00:00.000Z' },
          { amount: 150, reason: 'Student plan: 150 pages', at: '2026-10-01T09:00:00.000Z' },
        ],
      });
    }
    if (key === 'GET /profiles') {
      return answer(route, 200, {
        profiles: [{ id: 'p1', name: 'Exam hand', createdAt: '2026-10-02T09:00:00.000Z' }],
      });
    }
    if (key === 'POST /me/portal') {
      return answer(route, 200, { url: 'https://customer-portal.paddle.test/ctm_1' });
    }
    if (key === 'POST /export') {
      const next = exportAnswers.length > 1 ? exportAnswers.shift()! : exportAnswers[0];
      if (!next) return answer(route, 500, { error: 'no export answer set up' });
      return answer(
        route,
        next.status,
        next.body,
        next.retryAfter ? { 'retry-after': next.retryAfter } : {},
      );
    }
    if (key === 'GET /me/data') return answer(route, 200, { account: account(), ledger: [] });
    if (key === 'POST /feedback') return answer(route, 201, { feedback: { id: 1 } });
    return answer(route, 200, { ok: true });
  });
  return calls;
};

/** Starts the page already signed in, as after a successful sign-in on this device. */
const signedIn = async (page: Page): Promise<void> => {
  await page.addInitScript(
    ([token, user, email]) => {
      if (window.sessionStorage.getItem('signed-out-on-purpose')) return;
      window.localStorage.setItem(
        'pentwin.session.v1',
        JSON.stringify({
          accessToken: token,
          refreshToken: 'refresh-1',
          expiresAt: Date.now() + 3_600_000,
          userId: user,
          email,
        }),
      );
    },
    [ACCESS_TOKEN, USER, EMAIL] as const,
  );
};

test('signing up, a wrong password, then signing in to the account page', async ({
  page,
}, testInfo) => {
  const calls = await standIns(page);
  await page.goto('/account');
  // Nobody is signed in: the account page sends them to sign in.
  await expect(page).toHaveURL(/\/signin\?next=\/account$/);

  // Create an account. The box must be ticked; then they are told to check their email.
  await page.getByRole('button', { name: 'Create an account' }).click();
  await expect(page.locator('h1')).toHaveText('Create your account');
  await page.getByTestId('auth-email').fill(EMAIL);
  await page.getByTestId('auth-password').fill(PASSWORD);
  await page.getByTestId('auth-submit').click();
  expect(calls.filter((call) => call.path.startsWith('/auth/v1/signup'))).toHaveLength(0);
  await page.getByTestId('auth-agree').check();
  await page.getByTestId('auth-submit').click();
  await expect(page.getByTestId('auth-notice')).toContainText('we have sent you an email');
  const signup = calls.find((call) => call.path.startsWith('/auth/v1/signup'))!;
  expect(signup.body).toEqual({ email: EMAIL, password: PASSWORD });

  // A wrong password is explained in plain words, not the service's own.
  await page.getByTestId('auth-password').fill('not-the-password');
  await page.getByTestId('auth-submit').click();
  await expect(page.getByTestId('auth-error')).toHaveText(
    'That email and password do not match. Please check them and try again.',
  );

  await page.getByTestId('auth-password').fill(PASSWORD);
  await page.getByTestId('auth-submit').click();
  await expect(page).toHaveURL(/\/account$/);
  await expect(page.getByTestId('account-email')).toHaveText(EMAIL);

  // What they have and when it renews, always visible.
  await expect(page.getByTestId('usage')).toHaveText('37 / 150 pages used this month');
  await expect(page.getByTestId('pages-left')).toHaveText('113 pages left');
  await expect(page.getByTestId('reset')).toHaveText('Your pages reset on 8 November 2026.');
  await expect(page.getByTestId('renewal')).toHaveText('Renews on 8 November 2026 (monthly).');
  await expect(page.getByTestId('ledger-card')).toContainText('Student plan: 150 pages');
  await expect(page.getByTestId('profile')).toContainText('Exam hand');

  // The agreement ticked at sign-up was recorded against the account, with its version.
  const consents = calls.filter((call) => call.path === '/me/consents');
  expect(consents.map((call) => (call.body as { kind: string }).kind)).toEqual([
    'terms',
    'privacy',
  ]);
  expect((consents[0]!.body as { granted: boolean; version: string }).granted).toBe(true);
  expect((consents[0]!.body as { version: string }).version).toMatch(/\d{4}$/);
  expect(calls.some((call) => call.path === '/me/activate')).toBe(true);

  // Nothing sticks out sideways on a phone.
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);
  await page.screenshot({ path: testInfo.outputPath('account.png'), fullPage: true });
});

test('asking for a password reset says the same thing whether or not the address exists', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'not a layout test');
  const calls = await standIns(page);
  await page.goto('/signin');
  await page.getByRole('button', { name: 'Forgot your password?' }).click();
  await page.getByTestId('auth-email').fill('nobody@example.test');
  await page.getByTestId('auth-submit').click();
  await expect(page.getByTestId('auth-notice')).toHaveText(
    'If there is an account for that address, a reset link is on its way.',
  );
  expect(calls.find((call) => call.path.startsWith('/auth/v1/recover'))!.body).toEqual({
    email: 'nobody@example.test',
  });

  // Following the link in that email opens the page afresh, signed in, to choose a new
  // password.
  await page.goto('/pricing');
  await page.goto(
    `/signin#access_token=${ACCESS_TOKEN}&refresh_token=refresh-2&expires_in=3600&type=recovery`,
  );
  await expect(page.locator('h1')).toHaveText('Choose a new password');
  // The tokens do not stay in the address bar.
  expect(page.url()).not.toContain('access_token');
  await page.getByTestId('auth-password').fill('a-brand-new-password');
  await page.getByTestId('auth-submit').click();
  await expect(page).toHaveURL(/\/account$/);
  const change = calls.find((call) => call.method === 'PUT' && call.path === '/auth/v1/user')!;
  expect(change.body).toEqual({ password: 'a-brand-new-password' });
  expect(change.authorization).toBe(`Bearer ${ACCESS_TOKEN}`);
});

test('the account page: buying, managing the subscription, a free user, and deleting', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'not a layout test');
  await signedIn(page);
  const calls = await standIns(page);
  await page.goto('/account');
  await expect(page.getByTestId('usage')).toBeVisible();

  // A Student user is offered Pro, at the price in the plan config, and extra pages.
  await expect(page.getByTestId('buy-student')).toHaveCount(0);
  await expect(page.getByTestId('buy-pro')).toContainText(`$${PLANS.pro.price.month} / month`);
  await page.getByRole('button', { name: 'Yearly' }).click();
  await expect(page.getByTestId('buy-pro')).toContainText(`$${PLANS.pro.price.year} / year`);
  await page.getByTestId('buy-pro').click();
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { paddleCalls?: unknown[] }).paddleCalls))
    .toEqual([
      ['environment', 'sandbox'],
      ['initialize', 'test_client_token'],
      [
        'open',
        {
          items: [{ priceId: 'pri_pro_year', quantity: 1 }],
          customer: { email: EMAIL },
          // How the payment finds the account. Nothing here says what the user gets:
          // the server decides that from the price that was paid.
          customData: { user_id: USER },
        },
      ],
    ]);

  // Deleting needs the exact words.
  await expect(page.getByTestId('delete-account')).toBeDisabled();
  await page.getByTestId('delete-words').fill('delete');
  await expect(page.getByTestId('delete-account')).toBeDisabled();

  // Change card, invoices, cancel: the payment provider's own pages.
  await page.getByTestId('manage').click();
  await expect(page.locator('h1')).toHaveText('Billing portal stand-in');

  await page.goBack();
  await page.getByTestId('delete-words').fill('Delete my account');
  await page.evaluate(() => window.sessionStorage.setItem('signed-out-on-purpose', '1'));
  await page.getByTestId('delete-account').click();
  await expect(page).toHaveURL(/\/\?account=deleted$/);
  const deletion = calls.find((call) => call.method === 'DELETE' && call.path === '/me')!;
  expect(deletion.body).toEqual({ confirm: 'delete my account' });
  expect(await page.evaluate(() => window.localStorage.getItem('pentwin.session.v1'))).toBeNull();
});

test('a free user who has not confirmed their email is told what to do', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'not a layout test');
  await signedIn(page);
  await standIns(page, {
    account: {
      plan: 'free',
      planName: 'Free',
      activated: false,
      paidUntil: null,
      billingInterval: null,
      monthlyPages: 5,
      monthlyUsed: 0,
      monthlyLeft: 0,
      totalPages: 0,
      watermark: true,
      maxProfiles: 1,
    },
  });
  await page.goto('/account');
  await expect(page.getByTestId('not-activated')).toContainText('confirm your email address');
  await expect(page.getByTestId('plan-card')).toContainText('Watermark on exports');
  await expect(page.getByTestId('manage')).toHaveCount(0);
  await expect(page.getByTestId('renewal')).toHaveCount(0);
  // Both paid plans are on offer, at the prices in the plan config.
  await expect(page.getByTestId('buy-student')).toContainText(
    `${PLANS.student.monthlyPages} pages a month, $${PLANS.student.price.month} / month`,
  );
  await expect(page.getByTestId('buy-pro')).toBeVisible();
});

test('the editor with accounts on: sign in to export, wait when busy, report a result', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'not a layout test');
  const calls = await standIns(page, {
    exports: [
      // Busy twice, then served: the page waits and retries without being asked.
      { status: 503, body: { error: 'We are busy right now.' }, retryAfter: '0.2' },
      { status: 503, body: { error: 'We are busy right now.' }, retryAfter: '0.2' },
      {
        status: 200,
        body: {
          downloadPath: '/download/abc?expires=1&sig=x',
          pageCount: 1,
          billablePages: 1,
          watermarked: false,
          account: { totalPages: 112 },
        },
      },
    ],
  });

  // Signed out: the export window asks for an account and offers no Export button.
  await page.goto('/editor');
  await expect(page.getByTestId('preview-image')).toBeVisible();
  await page.getByTestId('export-open').click();
  await expect(page.getByTestId('sign-in-needed')).toBeVisible();
  await expect(page.getByTestId('sign-in-link')).toHaveAttribute('target', '_blank');
  await expect(page.getByTestId('export-confirm')).toHaveCount(0);
  expect(calls.filter((call) => call.path === '/export')).toHaveLength(0);

  // Signed in (as after signing in in the other tab and coming back).
  await signedIn(page);
  await page.reload();
  await expect(page.getByTestId('preview-image')).toBeVisible();
  await page.getByTestId('export-open').click();
  await expect(page.getByTestId('balance')).toHaveText('You have 113 pages left.');
  await page.getByTestId('export-confirm').click();
  await expect(page.getByTestId('export-waiting')).toContainText('waiting its turn');
  await expect(page.getByTestId('export-result')).toContainText('Your PDF is ready: 1 page');
  await expect(page.getByTestId('pages-left')).toContainText('You have 112 pages left.');
  const attempts = calls.filter((call) => call.path === '/export');
  expect(attempts).toHaveLength(3);
  expect(attempts.every((call) => call.authorization === `Bearer ${ACCESS_TOKEN}`)).toBe(true);
  // The request says nothing about plans or prices; those are the server's to decide.
  const sent = attempts[0]!.body as Record<string, unknown>;
  expect(Object.keys(sent).sort()).toEqual(['bank', 'blocks', 'options']);

  // Reporting a bad result sends the user's words and the settings, never the document.
  await page.getByTestId('report-open').click();
  await page.getByTestId('feedback-kind').selectOption('bad_glyph');
  await page.getByTestId('feedback-character').fill('g');
  await page.getByTestId('feedback-message').fill('The g looks like a q.');
  await page.getByTestId('feedback-send').click();
  await expect(page.getByTestId('feedback-sent')).toBeVisible();
  const feedback = calls.find((call) => call.path === '/feedback')!.body as {
    kind: string;
    message: string;
    context: Record<string, unknown>;
  };
  expect(feedback.kind).toBe('bad_glyph');
  expect(feedback.message).toBe('The g looks like a q.');
  expect(Object.keys(feedback.context).sort()).toEqual([
    'character',
    'ink',
    'pages',
    'paper',
    'screen',
    'style',
  ]);
  expect(JSON.stringify(feedback)).not.toContain('handwriting preview');
});

test('running out of pages is explained, with a way to get more', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'not a layout test');
  await signedIn(page);
  await standIns(page, {
    account: { totalPages: 0, monthlyLeft: 0, monthlyUsed: 150 },
    exports: [
      {
        status: 402,
        body: {
          error: 'You do not have enough pages left for this export.',
          code: 'insufficient_credits',
        },
      },
    ],
  });
  await page.goto('/editor');
  await expect(page.getByTestId('preview-image')).toBeVisible();
  await page.getByTestId('export-open').click();
  await expect(page.getByTestId('balance')).toHaveText('You have 0 pages left.');
  await page.getByTestId('export-confirm').click();
  await expect(page.getByTestId('export-error')).toContainText(
    'You do not have enough pages left for this export.',
  );
  await expect(page.getByTestId('get-pages')).toHaveAttribute('href', '/account');
});
