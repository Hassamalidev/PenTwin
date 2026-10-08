import { PLANS, type BillingInterval, type PlanId } from '@pentwin/shared';
import type { Pool } from 'pg';

/** A problem the user can do something about; the code is stable, the message is for them. */
export class BillingError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 400,
  ) {
    super(message);
    this.name = 'BillingError';
  }
}

/** What the database functions raise, turned into something to tell the user. */
const MESSAGES: Record<string, [message: string, status: number]> = {
  insufficient_credits: ['You do not have enough pages left for this export.', 402],
  account_not_activated: ['Please verify your email address before exporting.', 403],
  email_not_verified: ['Please verify your email address first.', 403],
  activation_rate_limited: [
    'Too many new accounts from this device or network. Please try again later, or contact support.',
    429,
  ],
  profile_limit_reached: [
    'You have reached the number of handwriting profiles your plan allows. Delete one, or upgrade.',
    403,
  ],
  own_handwriting_not_confirmed: ['Please confirm that this is your own handwriting.', 400],
  account_not_found: ['This account does not exist.', 404],
  invalid_page_count: ['There is nothing to export.', 400],
};

/** Runs a query, turning the errors our SQL functions raise into `BillingError`s. */
export async function call<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    const code = (error as Error).message?.split(/\s/)[0] ?? '';
    const known = MESSAGES[code];
    if (known) throw new BillingError(code, known[0], known[1]);
    throw error;
  }
}

export interface AccountSummary {
  userId: string;
  plan: PlanId;
  planName: string;
  billingInterval: BillingInterval | null;
  planStatus: 'active' | 'past_due' | 'cancelled';
  cancelAtPeriodEnd: boolean;
  /** When paid access ends or renews. Null on the free plan. */
  paidUntil: string | null;
  activated: boolean;
  /** Pages included each month on this plan. */
  monthlyPages: number;
  /** Monthly pages used in the current period, for the "37 / 150 pages" meter. */
  monthlyUsed: number;
  monthlyLeft: number;
  /** Purchased and bonus pages, which do not lapse. */
  extraPages: number;
  totalPages: number;
  /** When the monthly pages reset. */
  creditsResetOn: string;
  watermark: boolean;
  maxProfiles: number;
  referralCode: string;
}

/** The user's plan and pages as of now. Brings the account up to date first. */
export async function getAccount(pool: Pool, userId: string): Promise<AccountSummary> {
  // Two statements on purpose: a query does not see changes made by a function it calls
  // itself, so reading the balance in the same statement would show it one step behind.
  const account = await call(() =>
    pool.query(`select * from public.refresh_account($1)`, [userId]),
  );
  const balance = await pool.query(
    `select monthly, extra, total from public.credit_balances where user_id = $1`,
    [userId],
  );
  const row = { ...account.rows[0], ...balance.rows[0] };
  const plan = PLANS[row.plan as PlanId];
  return {
    userId,
    plan: plan.id,
    planName: plan.name,
    billingInterval: row.billing_interval,
    planStatus: row.plan_status,
    cancelAtPeriodEnd: row.cancel_at_period_end,
    paidUntil: row.paid_until?.toISOString() ?? null,
    activated: row.activated_at !== null,
    monthlyPages: plan.monthlyPages,
    monthlyUsed: Math.max(0, plan.monthlyPages - row.monthly),
    monthlyLeft: row.monthly,
    extraPages: row.extra,
    totalPages: row.total,
    creditsResetOn: row.credit_period_end.toISOString(),
    watermark: plan.watermark,
    maxProfiles: plan.maxProfiles,
    referralCode: row.referral_code,
  };
}

export interface LedgerEntry {
  amount: number;
  bucket: 'monthly' | 'extra';
  kind: string;
  reason: string;
  at: string;
}

/** The most recent ledger rows: what the user was given and what they spent, with reasons. */
export async function recentLedger(pool: Pool, userId: string, limit = 30): Promise<LedgerEntry[]> {
  const { rows } = await pool.query(
    `select amount, bucket, kind, reason, created_at from public.credit_ledger
      where user_id = $1 order by id desc limit $2`,
    [userId, limit],
  );
  return rows.map((row) => ({
    amount: row.amount,
    bucket: row.bucket,
    kind: row.kind,
    reason: row.reason,
    at: row.created_at.toISOString(),
  }));
}

export const activateAccount = (
  pool: Pool,
  userId: string,
  ipHash: string,
  deviceHash: string,
): Promise<unknown> =>
  call(() =>
    pool.query(`select public.activate_account($1, $2, $3)`, [userId, ipHash, deviceHash]),
  );

export interface Reservation {
  exportId: string;
  chargedPages: number;
  watermarked: boolean;
}

/** Sets pages aside for an export. Throws `insufficient_credits` if there are not enough. */
export async function reserveExport(
  pool: Pool,
  userId: string,
  pages: number,
  requestHash: string,
): Promise<Reservation> {
  const { rows } = await call(() =>
    pool.query(`select * from public.reserve_export($1, $2, $3)`, [userId, pages, requestHash]),
  );
  return {
    exportId: rows[0].id,
    chargedPages: rows[0].charged_pages,
    watermarked: rows[0].watermarked,
  };
}

/** Marks an export as delivered and records what it cost to produce. */
export const completeExport = (
  pool: Pool,
  exportId: string,
  computeMs: number,
  outputBytes: number,
): Promise<unknown> =>
  pool.query(`select public.complete_export($1, $2, $3)`, [
    exportId,
    Math.round(computeMs),
    outputBytes,
  ]);

/** Gives the pages of a failed export back. Safe to call more than once. */
export const failExport = (pool: Pool, exportId: string): Promise<unknown> =>
  pool.query(`select public.fail_export($1)`, [exportId]);

/** Redeems an invite code. Returns 'granted' or the reason it was refused. */
export async function redeemReferral(pool: Pool, userId: string, code: string): Promise<string> {
  const { rows } = await call(() =>
    pool.query(`select public.redeem_referral($1, $2) as result`, [userId, code]),
  );
  return rows[0].result;
}
