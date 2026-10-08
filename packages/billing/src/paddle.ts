import { createHmac, timingSafeEqual } from 'node:crypto';
import { TOP_UP, type BillingInterval, type PlanId } from '@pentwin/shared';
import type { Pool, PoolClient } from 'pg';

/** What each Paddle price stands for. Filled from the environment; see .env.example. */
export type PriceMeaning =
  | { kind: 'plan'; plan: Exclude<PlanId, 'free'>; interval: BillingInterval }
  | { kind: 'top_up'; pages: number };

export interface PaddleConfig {
  /** The secret key of the notification destination, from the Paddle dashboard. */
  webhookSecret: string;
  prices: Record<string, PriceMeaning>;
  /** How old a signed notification may be, in seconds. Guards against replays. */
  toleranceSeconds?: number;
}

export class WebhookSignatureError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WebhookSignatureError';
  }
}

/**
 * Checks a `Paddle-Signature` header against the raw request body, as Paddle documents
 * it: the header is `ts=<unix seconds>;h1=<hex>`, and h1 is the HMAC-SHA256 of
 * `<ts>:<raw body>` keyed with the destination's secret. Throws if it does not match
 * or is too old.
 */
export function verifyPaddleSignature(
  rawBody: string,
  header: string | undefined,
  secret: string,
  nowMs: number,
  toleranceSeconds = 30,
): void {
  const parts = Object.fromEntries(
    (header ?? '').split(';').map((part) => part.split('=', 2) as [string, string]),
  );
  const timestamp = Number(parts.ts);
  if (!parts.ts || !parts.h1 || !Number.isFinite(timestamp)) {
    throw new WebhookSignatureError('The signature header is missing or malformed.');
  }
  const expected = createHmac('sha256', secret).update(`${parts.ts}:${rawBody}`).digest();
  const given = Buffer.from(parts.h1, 'hex');
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    throw new WebhookSignatureError('The signature does not match.');
  }
  if (Math.abs(nowMs / 1000 - timestamp) > toleranceSeconds) {
    throw new WebhookSignatureError('The notification is too old.');
  }
}

/** Builds the header Paddle would send. Used by tests and local development. */
export function signPaddlePayload(rawBody: string, secret: string, nowMs: number): string {
  const ts = Math.floor(nowMs / 1000);
  const h1 = createHmac('sha256', secret).update(`${ts}:${rawBody}`).digest('hex');
  return `ts=${ts};h1=${h1}`;
}

interface PaddleEvent {
  event_id: string;
  event_type: string;
  occurred_at: string;
  data: {
    id: string;
    status?: string;
    customer_id?: string;
    subscription_id?: string | null;
    items?: { price?: { id?: string }; quantity?: number }[];
    current_billing_period?: { starts_at: string; ends_at: string } | null;
    scheduled_change?: { action: string; effective_at: string } | null;
    canceled_at?: string | null;
    custom_data?: { user_id?: string } | null;
    details?: { totals?: { total?: string; currency_code?: string } };
  };
}

export type WebhookOutcome = 'processed' | 'duplicate' | 'ignored';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Finds which of our users a notification is about. */
async function findUser(db: PoolClient, data: PaddleEvent['data']): Promise<string | undefined> {
  // The user id is attached to the checkout as custom data. Later notifications about
  // the same subscription or customer may not carry it, so fall back to what we stored.
  const claimed = data.custom_data?.user_id;
  if (claimed && UUID.test(claimed)) {
    const { rows } = await db.query(`select user_id from public.accounts where user_id = $1`, [
      claimed,
    ]);
    if (rows[0]) return rows[0].user_id;
  }
  const subscription = data.subscription_id ?? (data.id.startsWith('sub_') ? data.id : null);
  const { rows } = await db.query(
    `select user_id from public.accounts
      where ($1::text is not null and provider_subscription_id = $1)
         or ($2::text is not null and provider_customer_id = $2)
      limit 1`,
    [subscription, data.customer_id ?? null],
  );
  return rows[0]?.user_id;
}

const PLAN_STATUS: Record<string, 'active' | 'past_due' | 'cancelled'> = {
  active: 'active',
  trialing: 'active',
  past_due: 'past_due',
  canceled: 'cancelled',
  paused: 'cancelled',
};

async function handle(db: PoolClient, event: PaddleEvent, config: PaddleConfig): Promise<boolean> {
  const { data } = event;
  const user = await findUser(db, data);
  if (!user) return false;
  const meaning = config.prices[data.items?.[0]?.price?.id ?? ''];

  if (event.event_type.startsWith('subscription.')) {
    const status = PLAN_STATUS[data.status ?? ''];
    if (!status || meaning?.kind !== 'plan') return false;
    // A cancelled subscription has no current period: it ended when it was cancelled.
    const paidUntil = data.current_billing_period?.ends_at ?? data.canceled_at ?? event.occurred_at;
    await db.query(`select public.apply_subscription($1, $2, $3, $4, $5, $6, $7, $8)`, [
      user,
      meaning.plan,
      meaning.interval,
      status,
      paidUntil,
      data.scheduled_change?.action === 'cancel',
      data.customer_id ?? null,
      data.id,
    ]);
    return true;
  }

  if (event.event_type === 'transaction.completed') {
    const total = data.details?.totals;
    const receipt = {
      amount: total?.total ? Number(total.total) / 100 : null,
      currency: total?.currency_code ?? null,
      description: '',
    };
    if (meaning?.kind === 'top_up') {
      const pages = meaning.pages * Math.max(1, data.items?.[0]?.quantity ?? 1);
      await db.query(`select public.grant_top_up($1, $2, $3)`, [user, pages, event.event_id]);
      receipt.description = `${pages} extra pages`;
    } else if (meaning?.kind === 'plan') {
      // The plan itself is set by the subscription notifications; this is just the receipt.
      receipt.description = `${meaning.plan} plan, billed every ${meaning.interval}`;
    } else {
      return false;
    }
    await db.query(`select public.queue_email($1, 'receipt', $2)`, [user, JSON.stringify(receipt)]);
    return true;
  }

  if (event.event_type === 'transaction.payment_failed') {
    await db.query(
      `update public.accounts set plan_status = 'past_due' where user_id = $1 and plan <> 'free'`,
      [user],
    );
    await db.query(`select public.queue_email($1, 'payment_failed', '{}')`, [user]);
    return true;
  }
  return false;
}

/**
 * Receives one Paddle notification: verifies it, makes sure it is handled only once,
 * and applies it. Everything happens in one database transaction, so a failure
 * half-way leaves no trace and Paddle's retry starts clean.
 */
export async function handlePaddleWebhook(
  pool: Pool,
  rawBody: string,
  signatureHeader: string | undefined,
  config: PaddleConfig,
  nowMs = Date.now(),
): Promise<WebhookOutcome> {
  verifyPaddleSignature(
    rawBody,
    signatureHeader,
    config.webhookSecret,
    nowMs,
    config.toleranceSeconds,
  );
  const event = JSON.parse(rawBody) as PaddleEvent;
  if (!event.event_id || !event.event_type || !event.data?.id) return 'ignored';

  const db = await pool.connect();
  try {
    await db.query('begin');
    const { rows } = await db.query(`select public.record_webhook_event($1, $2) as fresh`, [
      event.event_id,
      event.event_type,
    ]);
    if (!rows[0].fresh) {
      await db.query('rollback');
      return 'duplicate';
    }
    const handled = await handle(db, event, config);
    // Unhandled notifications are still recorded, so they are not looked at again.
    await db.query('commit');
    return handled ? 'processed' : 'ignored';
  } catch (error) {
    await db.query('rollback').catch(() => undefined);
    throw error;
  } finally {
    db.release();
  }
}

/** Reads the price ids from the environment. Unset ones are simply not recognised. */
export function pricesFromEnv(env: Record<string, string | undefined>): PaddleConfig['prices'] {
  const prices: PaddleConfig['prices'] = {};
  const add = (name: string, meaning: PriceMeaning): void => {
    const id = env[name];
    if (id) prices[id] = meaning;
  };
  add('PADDLE_PRICE_STUDENT_MONTH', { kind: 'plan', plan: 'student', interval: 'month' });
  add('PADDLE_PRICE_STUDENT_YEAR', { kind: 'plan', plan: 'student', interval: 'year' });
  add('PADDLE_PRICE_PRO_MONTH', { kind: 'plan', plan: 'pro', interval: 'month' });
  add('PADDLE_PRICE_PRO_YEAR', { kind: 'plan', plan: 'pro', interval: 'year' });
  add('PADDLE_PRICE_TOP_UP', { kind: 'top_up', pages: TOP_UP.pages });
  return prices;
}
