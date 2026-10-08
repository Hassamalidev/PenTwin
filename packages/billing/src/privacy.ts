import type { Pool } from 'pg';
import { BillingError, call } from './accounts';

export const CONSENT_KINDS = ['terms', 'privacy', 'own_handwriting'] as const;
export type ConsentKind = (typeof CONSENT_KINDS)[number];

export interface Consent {
  kind: ConsentKind;
  /** Which version of the text was agreed to. */
  version: string;
  granted: boolean;
  at: string;
}

/** Adds a row to the consent log. The log is append-only: a withdrawal is a new row. */
export async function recordConsent(
  pool: Pool,
  userId: string,
  consent: { kind: string; version: string; granted: boolean },
  ipHash?: string,
): Promise<Consent> {
  const version = consent.version.trim().slice(0, 40);
  if (!(CONSENT_KINDS as readonly string[]).includes(consent.kind) || !version) {
    throw new BillingError('invalid_consent', 'This consent is not valid.', 400);
  }
  const { rows } = await call(() =>
    pool.query(`select * from public.record_consent($1, $2, $3, $4, $5)`, [
      userId,
      consent.kind,
      version,
      consent.granted,
      ipHash ?? null,
    ]),
  );
  return {
    kind: rows[0].kind,
    version: rows[0].version,
    granted: rows[0].granted,
    at: rows[0].created_at.toISOString(),
  };
}

export async function listConsents(pool: Pool, userId: string): Promise<Consent[]> {
  const { rows } = await pool.query(
    `select kind, version, granted, created_at from public.consents
      where user_id = $1 order by id`,
    [userId],
  );
  return rows.map((row) => ({
    kind: row.kind,
    version: row.version,
    granted: row.granted,
    at: row.created_at.toISOString(),
  }));
}

/** Everything the database holds about one user, in plain terms. No other user's data. */
export interface AccountData {
  account: Record<string, unknown>;
  ledger: Record<string, unknown>[];
  exports: Record<string, unknown>[];
  profiles: Record<string, unknown>[];
  consents: Consent[];
  referrals: { youWereReferred: boolean; peopleYouReferred: number };
}

const iso = (value: unknown): unknown => (value instanceof Date ? value.toISOString() : value);
const plain = (row: Record<string, unknown>): Record<string, unknown> =>
  Object.fromEntries(Object.entries(row).map(([name, value]) => [name, iso(value)]));

/**
 * Collects a user's data for them to download. Exports are listed without their
 * content, because the content was never stored. The handwriting itself is added by the
 * caller, which holds the key it is encrypted with.
 */
export async function exportAccountData(pool: Pool, userId: string): Promise<AccountData> {
  const account = await pool.query(
    `select a.plan, a.billing_interval, a.plan_status, a.cancel_at_period_end, a.paid_until,
            a.credit_period_start, a.credit_period_end, a.activated_at, a.referral_code,
            a.created_at, u.email
       from public.accounts a join auth.users u on u.id = a.user_id
      where a.user_id = $1`,
    [userId],
  );
  if (account.rowCount === 0) {
    throw new BillingError('account_not_found', 'This account does not exist.', 404);
  }
  const [ledger, exports, profiles, referred, referrer] = await Promise.all([
    pool.query(
      `select amount, bucket, kind, reason, created_at from public.credit_ledger
        where user_id = $1 order by id`,
      [userId],
    ),
    pool.query(
      `select status, pages, charged_pages, watermarked, plan, created_at, finished_at
         from public.exports where user_id = $1 order by created_at`,
      [userId],
    ),
    pool.query(
      `select id, name, size_bytes, style, own_handwriting_confirmed, created_at
         from public.handwriting_profiles where user_id = $1 order by created_at`,
      [userId],
    ),
    pool.query(`select 1 from public.referral_redemptions where referred = $1`, [userId]),
    pool.query(
      `select count(*)::integer as n from public.referral_redemptions where referrer = $1`,
      [userId],
    ),
  ]);
  return {
    account: plain(account.rows[0]),
    ledger: ledger.rows.map(plain),
    exports: exports.rows.map(plain),
    profiles: profiles.rows.map(plain),
    consents: await listConsents(pool, userId),
    referrals: {
      youWereReferred: (referred.rowCount ?? 0) > 0,
      peopleYouReferred: referrer.rows[0].n,
    },
  };
}

/** What was stored outside the database for a deleted account, for the caller to remove. */
export interface DeletedAccountFiles {
  profileKeys: string[];
  exportHashes: string[];
}

/**
 * Deletes an account and every row that belongs to it, in one transaction. Refuses
 * while a subscription is still renewing. The caller must then delete the returned files.
 */
export async function deleteAccount(pool: Pool, userId: string): Promise<DeletedAccountFiles> {
  let rows: { kind: string; key: string }[];
  try {
    ({ rows } = await call(() =>
      pool.query(`select kind, key from public.delete_account($1)`, [userId]),
    ));
  } catch (error) {
    if ((error as Error).message?.startsWith('subscription_active')) {
      throw new BillingError(
        'subscription_active',
        'Please cancel your subscription first, then delete your account. Otherwise you would keep being charged.',
        409,
      );
    }
    throw error;
  }
  return {
    profileKeys: rows.filter((row) => row.kind === 'profile').map((row) => row.key),
    exportHashes: rows.filter((row) => row.kind === 'export').map((row) => row.key),
  };
}
