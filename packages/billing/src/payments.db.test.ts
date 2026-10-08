import { PLANS, type PlanId } from '@pentwin/shared';
import { afterAll, describe, expect, it } from 'vitest';
import { getAccount, recentLedger, reserveExport } from './accounts';
import { COST_PER_PAGE_LIMIT, costReport } from './costs';
import { sendPendingEmails, type Email } from './emails';
import {
  handlePaddleWebhook,
  signPaddlePayload,
  WebhookSignatureError,
  type PaddleConfig,
} from './paddle';
import { balanceOf, createTestPool, createUser } from './testing';

const pool = createTestPool();
afterAll(() => pool.end());

const config: PaddleConfig = {
  webhookSecret: 'pdl_ntfset_test_secret',
  prices: {
    pri_student_month: { kind: 'plan', plan: 'student', interval: 'month' },
    pri_pro_year: { kind: 'plan', plan: 'pro', interval: 'year' },
    pri_top_up: { kind: 'top_up', pages: 100 },
  },
};

let eventCounter = 0;
const inDays = (days: number): string => new Date(Date.now() + days * 86_400_000).toISOString();

/** A notification shaped the way Paddle sends them. */
const event = (
  type: string,
  data: Record<string, unknown>,
  id = `evt_${Date.now()}_${eventCounter++}`,
) =>
  JSON.stringify({
    event_id: id,
    event_type: type,
    occurred_at: new Date().toISOString(),
    notification_id: `ntf_${id}`,
    data,
  });
const deliver = (body: string, secret = config.webhookSecret) =>
  handlePaddleWebhook(pool, body, signPaddlePayload(body, secret, Date.now()), config);

const subscription = (user: string, overrides: Record<string, unknown> = {}) => ({
  id: `sub_${user}`,
  status: 'active',
  customer_id: `ctm_${user}`,
  items: [{ price: { id: 'pri_student_month' }, quantity: 1 }],
  current_billing_period: { starts_at: inDays(0), ends_at: inDays(30) },
  scheduled_change: null,
  canceled_at: null,
  custom_data: { user_id: user },
  ...overrides,
});
const outbox = async (user: string): Promise<string[]> =>
  (
    await pool.query(`select kind from public.email_outbox where user_id = $1 order by id`, [user])
  ).rows.map((r) => r.kind);

describe('plan configuration', () => {
  it('matches the entitlements seeded in the database', async () => {
    const { rows } = await pool.query(`select * from public.plans order by id`);
    expect(rows).toHaveLength(Object.keys(PLANS).length);
    for (const row of rows) {
      const plan = PLANS[row.id as PlanId];
      expect(row).toEqual({
        id: plan.id,
        monthly_pages: plan.monthlyPages,
        max_profiles: plan.maxProfiles,
        watermark: plan.watermark,
        basic_options_only: plan.basicOptionsOnly,
      });
    }
  });
});

describe('Paddle webhooks', () => {
  it('rejects a notification that is not signed by Paddle, and records nothing', async () => {
    const user = await createUser(pool);
    const body = event('subscription.created', subscription(user), 'evt_forged');
    await expect(deliver(body, 'someone-elses-secret')).rejects.toBeInstanceOf(
      WebhookSignatureError,
    );
    await expect(handlePaddleWebhook(pool, body, undefined, config)).rejects.toBeInstanceOf(
      WebhookSignatureError,
    );
    expect((await getAccount(pool, user)).plan).toBe('free');
    const { rows } = await pool.query(
      `select 1 from public.webhook_events where event_id = 'evt_forged'`,
    );
    expect(rows).toEqual([]);
  });

  it('does not double-grant when the same notification arrives twice', async () => {
    const user = await createUser(pool);
    const created = event('subscription.created', subscription(user));
    expect(await deliver(created)).toBe('processed');
    expect(await deliver(created)).toBe('duplicate');
    expect(await deliver(created)).toBe('duplicate');
    expect(await balanceOf(pool, user)).toEqual({ monthly: 150, extra: 0, total: 150 });

    const topUp = event('transaction.completed', {
      id: 'txn_1',
      status: 'completed',
      customer_id: `ctm_${user}`,
      subscription_id: null,
      items: [{ price: { id: 'pri_top_up' }, quantity: 1 }],
      custom_data: { user_id: user },
      details: { totals: { total: '300', currency_code: 'USD' } },
    });
    expect(await deliver(topUp)).toBe('processed');
    expect(await deliver(topUp)).toBe('duplicate');
    // Both at once: still only one grant.
    const again = event('transaction.completed', JSON.parse(topUp).data);
    const outcomes = await Promise.all([deliver(again), deliver(again), deliver(again)]);
    expect(outcomes.sort()).toEqual(['duplicate', 'duplicate', 'processed']);
    expect(await balanceOf(pool, user)).toEqual({ monthly: 150, extra: 200, total: 350 });

    const grants = (await recentLedger(pool, user)).filter((row) => row.kind === 'top_up');
    expect(grants.map((row) => row.reason)).toEqual(['Top-up: 100 pages', 'Top-up: 100 pages']);
  });

  it('follows a subscription from purchase through renewal, cancellation and downgrade', async () => {
    const user = await createUser(pool);

    // Purchase.
    await deliver(event('subscription.created', subscription(user)));
    let account = await getAccount(pool, user);
    expect(account).toMatchObject({
      plan: 'student',
      planStatus: 'active',
      billingInterval: 'month',
      monthlyPages: 150,
      monthlyUsed: 0,
      totalPages: 150,
      watermark: false,
      cancelAtPeriodEnd: false,
    });

    // Use some pages.
    const reservation = await reserveExport(pool, user, 37, 'doc');
    expect(reservation).toMatchObject({ chargedPages: 37, watermarked: false });
    account = await getAccount(pool, user);
    expect(`${account.monthlyUsed} / ${account.monthlyPages} pages`).toBe('37 / 150 pages');

    // Renewal: the paid time moves on. Later notifications carry no custom data.
    await deliver(
      event(
        'subscription.updated',
        subscription(user, {
          custom_data: null,
          current_billing_period: { starts_at: inDays(30), ends_at: inDays(60) },
        }),
      ),
    );
    account = await getAccount(pool, user);
    expect(new Date(account.paidUntil!).getTime()).toBeGreaterThan(Date.now() + 59 * 86_400_000);
    expect(account.totalPages).toBe(113); // a renewal alone grants nothing extra

    // The user cancels: access continues until the end of the paid period.
    await deliver(
      event(
        'subscription.updated',
        subscription(user, { scheduled_change: { action: 'cancel', effective_at: inDays(30) } }),
      ),
    );
    account = await getAccount(pool, user);
    expect(account).toMatchObject({ plan: 'student', cancelAtPeriodEnd: true, totalPages: 113 });

    // The period ends and Paddle reports the subscription as cancelled.
    await deliver(
      event(
        'subscription.canceled',
        subscription(user, {
          status: 'canceled',
          current_billing_period: null,
          // Well in the past, so a small clock difference between machines cannot matter.
          canceled_at: new Date(Date.now() - 300_000).toISOString(),
        }),
      ),
    );
    account = await getAccount(pool, user);
    expect(account).toMatchObject({
      plan: 'free',
      planStatus: 'active',
      paidUntil: null,
      monthlyPages: 5,
      monthlyLeft: 5,
      watermark: true,
    });
    expect((await reserveExport(pool, user, 2, 'doc-2')).watermarked).toBe(true);
  });

  it('marks a failed payment and tells the user', async () => {
    const user = await createUser(pool);
    await deliver(event('subscription.created', subscription(user)));
    expect(
      await deliver(
        event('transaction.payment_failed', {
          id: 'txn_failed',
          status: 'past_due',
          customer_id: `ctm_${user}`,
          subscription_id: `sub_${user}`,
          items: [{ price: { id: 'pri_student_month' }, quantity: 1 }],
          custom_data: null,
        }),
      ),
    ).toBe('processed');
    const account = await getAccount(pool, user);
    expect(account).toMatchObject({ plan: 'student', planStatus: 'past_due', totalPages: 150 });
    expect(await outbox(user)).toContain('payment_failed');
  });

  it('ignores what it does not understand, without failing', async () => {
    const user = await createUser(pool);
    const unknownPrice = subscription(user, { items: [{ price: { id: 'pri_unknown' } }] });
    expect(await deliver(event('subscription.created', unknownPrice))).toBe('ignored');
    expect(await deliver(event('customer.created', { id: 'ctm_x' }))).toBe('ignored');
    const stranger = subscription('5b1f3c9e-5d4a-4b7c-9e1f-0a1b2c3d4e5f');
    expect(await deliver(event('subscription.created', stranger))).toBe('ignored');
    // custom_data cannot be used to point a payment at an account id that is not a uuid.
    const injected = subscription(user, {
      custom_data: { user_id: "x'; drop table accounts; --" },
    });
    expect(
      await deliver(
        event('subscription.created', { ...injected, id: 'sub_none', customer_id: 'ctm_none' }),
      ),
    ).toBe('ignored');
    expect((await getAccount(pool, user)).plan).toBe('free');
  });
});

describe('transactional email', () => {
  it('queues each email on the right event', async () => {
    const user = await createUser(pool);
    expect(await outbox(user)).toEqual(['welcome']);

    await deliver(event('subscription.created', subscription(user)));
    await deliver(
      event('transaction.completed', {
        id: 'txn_sub',
        status: 'completed',
        customer_id: `ctm_${user}`,
        subscription_id: `sub_${user}`,
        items: [{ price: { id: 'pri_student_month' }, quantity: 1 }],
        custom_data: { user_id: user },
        details: { totals: { total: '400', currency_code: 'USD' } },
      }),
    );
    expect(await outbox(user)).toEqual(['welcome', 'receipt']);

    // A long export: "ready" email. A short one: none.
    const long = await reserveExport(pool, user, 24, 'long');
    await pool.query(`select public.complete_export($1, 3000, 4000000)`, [long.exportId]);
    const short = await reserveExport(pool, user, 3, 'short');
    await pool.query(`select public.complete_export($1, 300, 400000)`, [short.exportId]);
    expect(await outbox(user)).toEqual(['welcome', 'receipt', 'export_ready']);

    // Running low: one warning per credit period, however many exports follow.
    await reserveExport(pool, user, 110, 'big');
    await reserveExport(pool, user, 2, 'more');
    await reserveExport(pool, user, 2, 'even-more');
    expect(await outbox(user)).toEqual(['welcome', 'receipt', 'export_ready', 'low_credits']);
  });

  it('sends what is waiting once, and retries what failed', async () => {
    const user = await createUser(pool);
    const address = (await pool.query(`select email from auth.users where id = $1`, [user])).rows[0]
      .email;
    const mine = (emails: Email[]): Email[] => emails.filter((email) => email.to === address);

    const delivered: Email[] = [];
    let failNext = true;
    const flaky = async (email: Email): Promise<void> => {
      if (email.to === address && failNext) {
        failNext = false;
        throw new Error('mail service is down');
      }
      delivered.push(email);
    };

    await sendPendingEmails(pool, flaky, 1000);
    expect(mine(delivered)).toEqual([]);
    const failed = await pool.query(
      `select error, sent_at from public.email_outbox where user_id = $1`,
      [user],
    );
    expect(failed.rows[0]).toEqual({ error: 'mail service is down', sent_at: null });

    await sendPendingEmails(pool, flaky, 1000);
    expect(mine(delivered).map((email) => email.subject)).toEqual(['Welcome to PenTwin']);
    // Nothing is sent twice.
    await sendPendingEmails(pool, flaky, 1000);
    await Promise.all([sendPendingEmails(pool, flaky, 1000), sendPendingEmails(pool, flaky, 1000)]);
    expect(mine(delivered)).toHaveLength(1);
  });
});

describe('cost tracking', () => {
  it('reports cost per page and margin per plan, and alerts above one cent a page', async () => {
    const user = await createUser(pool);
    await deliver(event('subscription.created', subscription(user)));
    const cheap = await reserveExport(pool, user, 10, 'cheap');
    await pool.query(`select public.complete_export($1, 1300, 1700000)`, [cheap.exportId]);

    const report = await costReport(pool);
    const student = report.plans.find((p) => p.plan === 'student')!;
    expect(student.pages).toBeGreaterThanOrEqual(10);
    expect(student.costPerPage).toBeGreaterThan(0);
    expect(student.costPerPage).toBeLessThan(COST_PER_PAGE_LIMIT);
    expect(student.marginAtFullUse).toBeGreaterThan(3.5);
    expect(student.marginAtFullUse).toBeLessThan(4);

    // The same data with compute made absurdly dear trips the alert, however many other
    // exports (from other tests) share the report.
    const dear = await costReport(pool, {
      dollarsPerComputeSecond: 1e6,
      dollarsPerOutputMegabyte: 0,
    });
    expect(dear.alerts.some((alert) => /student plan .* above the \$0\.01 limit/.test(alert))).toBe(
      true,
    );
    expect(report.alerts.filter((alert) => alert.includes('student'))).toEqual([]);
  });
});
