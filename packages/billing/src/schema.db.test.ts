import { afterAll, describe, expect, it } from 'vitest';
import { asUser, balanceOf, createTestPool, createUser } from './testing';

const pool = createTestPool();
afterAll(() => pool.end());

const reserve = async (user: string, pages: number, hash = `doc-${Math.random()}`) => {
  const { rows } = await pool.query(`select * from public.reserve_export($1, $2, $3)`, [
    user,
    pages,
    hash,
  ]);
  return rows[0] as { id: string; charged_pages: number; watermarked: boolean; status: string };
};
const errorOf = (promise: Promise<unknown>): Promise<string> =>
  promise.then(
    () => 'no error',
    (error: Error) => error.message,
  );
const ledgerOf = async (user: string) =>
  (
    await pool.query(
      `select amount, bucket, kind, reason from public.credit_ledger where user_id = $1 order by id`,
      [user],
    )
  ).rows as { amount: number; bucket: string; kind: string; reason: string }[];
/** Makes a user a paying subscriber, as the payment webhook would. */
const subscribe = (user: string, plan: string, days = 30) =>
  pool.query(
    `select public.apply_subscription($1, $2, 'month', 'active', now() + make_interval(days => $3), false, $4, $5)`,
    [user, plan, days, `ctm_${user}`, `sub_${user}`],
  );

describe('row-level security', () => {
  it('is switched on for every table', async () => {
    const { rows } = await pool.query(
      `select relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity`,
    );
    expect(rows).toEqual([]);
  });

  it("stops user A from reading any of user B's data", async () => {
    const a = await createUser(pool);
    const b = await createUser(pool);
    await subscribe(b, 'student');
    await reserve(b, 3);
    await pool.query(`select public.create_profile($1, 'Mine', $2, 1000, null, true)`, [
      b,
      `key-${b}`,
    ]);
    await pool.query(`select public.record_consent($1, 'terms', '2026-10-08', true, null)`, [b]);

    const tables = [
      'accounts',
      'credit_ledger',
      'credit_balances',
      'exports',
      'handwriting_profiles',
      'consents',
    ];
    for (const table of tables) {
      // B sees their own rows...
      const own = await asUser(pool, b, (q) => q(`select * from public.${table}`));
      expect(own.rows.length).toBeGreaterThan(0);
      expect(own.rows.every((row) => row.user_id === b)).toBe(true);
      // ...and A, asking for everything or for B by id, sees none of them.
      const all = await asUser(pool, a, (q) => q(`select * from public.${table}`));
      expect(all.rows.every((row) => row.user_id === a)).toBe(true);
      const targeted = await asUser(pool, a, (q) =>
        q(`select * from public.${table} where user_id = $1`, [b]),
      );
      expect(targeted.rows).toEqual([]);
    }
  });

  it('shows a visitor who is not signed in nothing but the plans', async () => {
    await createUser(pool);
    const plans = await asUser(pool, null, (q) => q(`select id from public.plans order by id`));
    expect(plans.rows.map((r) => r.id)).toEqual(['free', 'pro', 'student']);
    for (const table of [
      'accounts',
      'credit_ledger',
      'exports',
      'handwriting_profiles',
      'consents',
      'account_deletions',
    ]) {
      expect(await errorOf(asUser(pool, null, (q) => q(`select * from public.${table}`)))).toMatch(
        /permission denied/,
      );
    }
  });

  it('lets a signed-in user change nothing directly', async () => {
    const user = await createUser(pool);
    const attempts = [
      `update public.accounts set plan = 'pro' where user_id = '${user}'`,
      `insert into public.credit_ledger (user_id, amount, bucket, kind, reason)
         values ('${user}', 1000, 'extra', 'adjustment', 'free pages please')`,
      `delete from public.credit_ledger where user_id = '${user}'`,
      `update public.plans set monthly_pages = 100000 where id = 'free'`,
      `select public.grant_top_up('${user}', 1000, 'evt_fake')`,
      `select public.apply_subscription('${user}', 'pro', 'month', 'active', now() + interval '1 year', false, 'c', 's')`,
      `select public.reserve_export('${user}', 1, 'x')`,
      `select * from public.email_outbox`,
      `select * from public.webhook_events`,
      `select * from public.export_costs`,
      `select * from public.account_deletions`,
      `insert into public.consents (user_id, kind, version, granted)
         values ('${user}', 'terms', 'x', true)`,
      `select public.record_consent('${user}', 'terms', 'x', true, null)`,
      `select * from public.delete_account('${user}')`,
    ];
    for (const sql of attempts) {
      expect(await errorOf(asUser(pool, user, (q) => q(sql)))).toMatch(/permission denied/);
    }
    expect((await balanceOf(pool, user)).total).toBe(5);
  });
});

describe('credit ledger', () => {
  it('starts a new user with the free allowance, once they are verified and activated', async () => {
    const unverified = await createUser(pool, { verified: false });
    expect((await balanceOf(pool, unverified)).total).toBe(0);
    expect(
      await errorOf(pool.query(`select public.activate_account($1, 'ip', 'dev')`, [unverified])),
    ).toMatch(/email_not_verified/);
    expect(await errorOf(reserve(unverified, 1))).toMatch(/account_not_activated/);

    const user = await createUser(pool);
    expect(await balanceOf(pool, user)).toEqual({ monthly: 5, extra: 0, total: 5 });
    // Activating again grants nothing more.
    await pool.query(`select public.activate_account($1, 'other-ip', 'other-dev')`, [user]);
    expect((await balanceOf(pool, user)).total).toBe(5);
  });

  it('is append-only, even for the server', async () => {
    const user = await createUser(pool);
    expect(
      await errorOf(
        pool.query(`update public.credit_ledger set amount = 999 where user_id = $1`, [user]),
      ),
    ).toMatch(/append-only/);
    expect(
      await errorOf(pool.query(`delete from public.credit_ledger where user_id = $1`, [user])),
    ).toMatch(/append-only/);
    expect((await balanceOf(pool, user)).total).toBe(5);
  });

  it('charges an export, and gives the pages back if it fails', async () => {
    const user = await createUser(pool);
    await subscribe(user, 'student');
    expect((await balanceOf(pool, user)).total).toBe(150);

    const ok = await reserve(user, 12);
    expect(ok).toMatchObject({ charged_pages: 12, status: 'reserved', watermarked: false });
    await pool.query(`select public.complete_export($1, 1500, 2000000)`, [ok.id]);
    expect((await balanceOf(pool, user)).total).toBe(138);

    const failed = await reserve(user, 30);
    expect((await balanceOf(pool, user)).total).toBe(108);
    await pool.query(`select public.fail_export($1)`, [failed.id]);
    expect((await balanceOf(pool, user)).total).toBe(138);
    // Failing or completing it again changes nothing.
    await pool.query(`select public.fail_export($1)`, [failed.id]);
    await pool.query(`select public.complete_export($1, 1, 1)`, [failed.id]);
    await pool.query(`select public.fail_export($1)`, [ok.id]);
    expect((await balanceOf(pool, user)).total).toBe(138);

    const kinds = (await ledgerOf(user)).map((row) => `${row.kind}:${row.amount}`);
    expect(kinds.slice(-3)).toEqual(['export:-12', 'export:-30', 'export_refund:30']);
  });

  it('refuses an export the user cannot pay for, and records nothing', async () => {
    const user = await createUser(pool);
    expect(await errorOf(reserve(user, 6))).toMatch(/insufficient_credits/);
    expect(await errorOf(reserve(user, 0))).toMatch(/invalid_page_count/);
    expect((await balanceOf(pool, user)).total).toBe(5);
    const { rows } = await pool.query(`select 1 from public.exports where user_id = $1`, [user]);
    expect(rows).toEqual([]);
  });

  it('never overspends when exports arrive at the same moment', async () => {
    const user = await createUser(pool);
    await subscribe(user, 'student'); // 150 pages
    // Twenty exports of 20 pages at once: 400 pages wanted, 150 available.
    const outcomes = await Promise.all(
      Array.from({ length: 20 }, () =>
        reserve(user, 20).then(
          () => 'ok',
          (error: Error) => error.message,
        ),
      ),
    );
    expect(outcomes.filter((o) => o === 'ok')).toHaveLength(7); // 7 x 20 = 140
    expect(outcomes.filter((o) => /insufficient_credits/.test(o))).toHaveLength(13);
    expect(await balanceOf(pool, user)).toEqual({ monthly: 10, extra: 0, total: 10 });

    // Mixed traffic: charges, failures and completions racing each other.
    const { rows } = await pool.query(
      `select id from public.exports where user_id = $1 and status = 'reserved'`,
      [user],
    );
    await Promise.all([
      ...rows.slice(0, 3).map((r) => pool.query(`select public.fail_export($1)`, [r.id])),
      ...rows.slice(0, 3).map((r) => pool.query(`select public.fail_export($1)`, [r.id])),
      ...rows.slice(3).map((r) => pool.query(`select public.complete_export($1, 10, 10)`, [r.id])),
      ...Array.from({ length: 10 }, () => reserve(user, 25).catch(() => undefined)),
    ]);
    const balance = await balanceOf(pool, user);
    expect(balance.total).toBeGreaterThanOrEqual(0);
    // Whatever order things ran in, the ledger adds up: grants minus what is still charged.
    const charged = await pool.query(
      `select coalesce(sum(charged_pages), 0)::int as pages from public.exports
        where user_id = $1 and status <> 'failed'`,
      [user],
    );
    expect(balance.total).toBe(150 - charged.rows[0].pages);
  });

  it('spends monthly pages before purchased ones', async () => {
    const user = await createUser(pool);
    await pool.query(`select public.grant_top_up($1, 100, $2)`, [user, `evt-${user}`]);
    expect(await balanceOf(pool, user)).toEqual({ monthly: 5, extra: 100, total: 105 });
    await reserve(user, 8);
    expect(await balanceOf(pool, user)).toEqual({ monthly: 0, extra: 97, total: 97 });
  });

  it('charges nothing for the same document again within 24 hours', async () => {
    const user = await createUser(pool);
    await subscribe(user, 'student');
    const first = await reserve(user, 10, 'same-document');
    // Not free until the first one actually succeeded.
    const early = await reserve(user, 10, 'same-document');
    expect(early.charged_pages).toBe(10);
    await pool.query(`select public.fail_export($1)`, [early.id]);
    await pool.query(`select public.complete_export($1, 5, 5)`, [first.id]);

    const repeat = await reserve(user, 10, 'same-document');
    expect(repeat.charged_pages).toBe(0);
    expect((await balanceOf(pool, user)).total).toBe(140);

    // Another user exporting identical content pays for it.
    const other = await createUser(pool);
    await subscribe(other, 'student');
    expect((await reserve(other, 10, 'same-document')).charged_pages).toBe(10);

    // After a day it is a new export.
    await pool.query(
      `update public.exports set finished_at = now() - interval '25 hours' where id = $1`,
      [first.id],
    );
    expect((await reserve(user, 10, 'same-document')).charged_pages).toBe(10);
  });
});

describe('credit periods and plans', () => {
  const endPeriod = (user: string) =>
    pool.query(
      `update public.accounts set credit_period_end = now() - interval '1 minute' where user_id = $1`,
      [user],
    );

  it('lapses unused monthly pages and grants a fresh allowance each period', async () => {
    const user = await createUser(pool);
    await subscribe(user, 'student', 365);
    await pool.query(`select public.grant_top_up($1, 100, $2)`, [user, `evt-${user}`]);
    await reserve(user, 40);
    expect(await balanceOf(pool, user)).toEqual({ monthly: 110, extra: 100, total: 210 });

    await endPeriod(user);
    await pool.query(`select public.refresh_account($1)`, [user]);
    // The 110 unused monthly pages are gone; purchased pages are untouched.
    expect(await balanceOf(pool, user)).toEqual({ monthly: 150, extra: 100, total: 250 });
    const tail = (await ledgerOf(user)).slice(-2).map((r) => `${r.kind}:${r.amount}`);
    expect(tail).toEqual(['monthly_expiry:-110', 'monthly_grant:150']);

    // Refreshing again inside the same period does nothing.
    await pool.query(`select public.refresh_account($1)`, [user]);
    expect((await balanceOf(pool, user)).total).toBe(250);
  });

  it('upgrades at once, and applies a downgrade from the next period', async () => {
    const user = await createUser(pool);
    await subscribe(user, 'student');
    await reserve(user, 50);
    await subscribe(user, 'pro');
    expect((await balanceOf(pool, user)).monthly).toBe(500);

    await subscribe(user, 'student');
    expect((await balanceOf(pool, user)).monthly).toBe(500); // kept until the period ends
    await endPeriod(user);
    await pool.query(`select public.refresh_account($1)`, [user]);
    expect((await balanceOf(pool, user)).monthly).toBe(150);
  });

  it('keeps a cancelled plan until the paid time runs out, then returns to free', async () => {
    const user = await createUser(pool);
    await subscribe(user, 'student');
    await pool.query(
      `select public.apply_subscription($1, 'student', 'month', 'cancelled', now() + interval '10 days', true, $2, $3)`,
      [user, `ctm_${user}`, `sub_${user}`],
    );
    let account = (await pool.query(`select * from public.refresh_account($1)`, [user])).rows[0];
    expect(account).toMatchObject({
      plan: 'student',
      plan_status: 'cancelled',
      cancel_at_period_end: true,
    });
    expect((await reserve(user, 5)).watermarked).toBe(false);

    await pool.query(
      `update public.accounts set paid_until = now() - interval '1 minute' where user_id = $1`,
      [user],
    );
    account = (await pool.query(`select * from public.refresh_account($1)`, [user])).rows[0];
    expect(account).toMatchObject({ plan: 'free', plan_status: 'active', paid_until: null });
    expect(await balanceOf(pool, user)).toMatchObject({ monthly: 5 });
    expect((await reserve(user, 2)).watermarked).toBe(true);
  });
});

describe('free tier', () => {
  it('allows five watermarked pages a month and one profile', async () => {
    const user = await createUser(pool);
    const first = await reserve(user, 5);
    expect(first).toMatchObject({ charged_pages: 5, watermarked: true });
    expect(await errorOf(reserve(user, 1))).toMatch(/insufficient_credits/);

    await pool.query(`select public.create_profile($1, 'Mine', $2, 500, null, true)`, [
      user,
      `k1-${user}`,
    ]);
    expect(
      await errorOf(
        pool.query(`select public.create_profile($1, 'Second', $2, 500, null, true)`, [
          user,
          `k2-${user}`,
        ]),
      ),
    ).toMatch(/profile_limit_reached/);
  });

  it('raises the profile limit with the plan and insists on the own-handwriting confirmation', async () => {
    const user = await createUser(pool);
    await subscribe(user, 'student');
    for (let i = 0; i < 3; i++) {
      await pool.query(`select public.create_profile($1, $2, $3, 500, null, true)`, [
        user,
        `Profile ${i}`,
        `k${i}-${user}`,
      ]);
    }
    expect(
      await errorOf(
        pool.query(`select public.create_profile($1, 'Fourth', $2, 500, null, true)`, [
          user,
          `k4-${user}`,
        ]),
      ),
    ).toMatch(/profile_limit_reached/);

    const other = await createUser(pool);
    expect(
      await errorOf(
        pool.query(`select public.create_profile($1, 'Theirs', $2, 500, null, false)`, [
          other,
          `x-${other}`,
        ]),
      ),
    ).toMatch(/own_handwriting_not_confirmed/);
  });

  it('limits how many accounts one address or device can activate', async () => {
    const tag = `shared-${Date.now()}`;
    const activate = async (ip: string, device: string): Promise<string> => {
      const user = await createUser(pool, { activate: false });
      return errorOf(pool.query(`select public.activate_account($1, $2, $3)`, [user, ip, device]));
    };
    // Same address, different devices: three are fine, the fourth is refused.
    for (let i = 0; i < 3; i++)
      expect(await activate(`ip-${tag}`, `dev-${tag}-${i}`)).toBe('no error');
    expect(await activate(`ip-${tag}`, `dev-${tag}-3`)).toMatch(/activation_rate_limited/);
    // Same device, different addresses: two are fine, the third is refused.
    for (let i = 0; i < 2; i++)
      expect(await activate(`ip2-${tag}-${i}`, `same-dev-${tag}`)).toBe('no error');
    expect(await activate(`ip2-${tag}-2`, `same-dev-${tag}`)).toMatch(/activation_rate_limited/);
  });
});

describe('referrals', () => {
  const codeOf = async (user: string): Promise<string> =>
    (await pool.query(`select referral_code from public.accounts where user_id = $1`, [user]))
      .rows[0].referral_code;
  const redeem = async (user: string, code: string): Promise<string> =>
    (await pool.query(`select public.redeem_referral($1, $2) as result`, [user, code])).rows[0]
      .result;

  it('gives both people 20 pages, with the reason in the ledger', async () => {
    const inviter = await createUser(pool);
    const friend = await createUser(pool);
    expect(await redeem(friend, await codeOf(inviter))).toBe('granted');
    expect((await balanceOf(pool, inviter)).extra).toBe(20);
    expect((await balanceOf(pool, friend)).extra).toBe(20);
    expect((await ledgerOf(inviter)).at(-1)).toEqual({
      amount: 20,
      bucket: 'extra',
      kind: 'referral_bonus',
      reason: 'Referral bonus: a friend you invited joined',
    });
    expect((await ledgerOf(friend)).at(-1)!.reason).toBe(
      'Referral bonus: you joined with an invite',
    );
  });

  it('refuses abuse, logs why, and grants nothing', async () => {
    const inviter = await createUser(pool);
    const code = await codeOf(inviter);
    const friend = await createUser(pool);
    await redeem(friend, code);

    expect(await redeem(friend, code)).toBe('already_referred');
    expect(await redeem(inviter, code)).toBe('own_code');
    const stranger = await createUser(pool);
    expect(await redeem(stranger, 'no-such-code')).toBe('unknown_code');

    // A "friend" on the inviter's own device or network.
    const twin = await createUser(pool, { activate: false });
    const { rows } = await pool.query(
      `select activation_ip_hash, activation_device_hash from public.accounts where user_id = $1`,
      [inviter],
    );
    await pool.query(`select public.activate_account($1, $2, 'another-device')`, [
      twin,
      rows[0].activation_ip_hash,
    ]);
    expect(await redeem(twin, code)).toBe('same_device_or_network');

    const idle = await createUser(pool, { activate: false });
    expect(await redeem(idle, code)).toBe('not_activated');

    expect((await balanceOf(pool, inviter)).extra).toBe(20); // only the one genuine referral
    expect((await balanceOf(pool, twin)).extra).toBe(0);
    const log = await pool.query(
      `select reason from public.referral_rejections where code = $1 order by id`,
      [code],
    );
    expect(log.rows.map((r) => r.reason)).toEqual([
      'already_referred',
      'own_code',
      'same_device_or_network',
      'not_activated',
    ]);
  });
});
