import { randomUUID } from 'node:crypto';
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { signAccessToken, signPaddlePayload, type PaddleConfig } from '@pentwin/billing';
import { createTestPool, createUser } from '@pentwin/billing/testing';
import { PDFDocument } from 'pdf-lib';
import { afterAll, describe, expect, it } from 'vitest';
import { createExportService } from './export';
import { createLimiter } from './limiter';
import { createProfileStore } from './profiles';
import { createRateLimiter } from './rate-limit';
import type { ExportRequest } from './schema';
import { createWorkerServer } from './server';

/**
 * The worker with accounts switched on, over HTTP, against a real Postgres.
 * This is the Phase 5 gate as far as it can go without live accounts: the payment
 * notifications are built and signed here exactly as Paddle documents them.
 */
const JWT_SECRET = 'test-jwt-secret-with-enough-length-0123456789';
const paddle: PaddleConfig = {
  webhookSecret: 'pdl_ntfset_test_secret',
  prices: {
    pri_student_month: { kind: 'plan', plan: 'student', interval: 'month' },
    pri_top_up: { kind: 'top_up', pages: 100 },
  },
};

const glyphDir = fileURLToPath(
  new URL('../../../tests/fixtures/glyphs/sample-user', import.meta.url),
);
const bank: ExportRequest['bank'] = {
  metadata: JSON.parse(readFileSync(join(glyphDir, 'metadata.json'), 'utf8')),
  files: Object.fromEntries(
    readdirSync(glyphDir)
      .filter((name) => name.endsWith('.svg'))
      .map((name) => [name, readFileSync(join(glyphDir, name), 'utf8')]),
  ),
};
/** A document of exactly `pages` pages. */
const document = (
  pages: number,
  options: Record<string, unknown> = {},
  text = 'One page of text.',
) => ({
  blocks: Array.from({ length: pages * 2 - 1 }, (_, i) =>
    i % 2 === 0 ? { type: 'paragraph', text: `${text} ${i / 2 + 1}` } : { type: 'pageBreak' },
  ),
  bank,
  options: { seed: 'accounts', ...options },
});

const pool = createTestPool();
const exportsDir = mkdtempSync(join(tmpdir(), 'pentwin-acc-exports-'));
const profilesDir = mkdtempSync(join(tmpdir(), 'pentwin-acc-profiles-'));
let failRendering = false;
const service = createExportService({
  storageDir: exportsDir,
  secret: 'export-signing-secret-for-tests-only',
  // Real PDFs are covered elsewhere; here a stub keeps many-page exports fast.
  toPdf: async (scenes, options) => {
    if (failRendering) throw new Error('renderer crashed');
    const doc = await PDFDocument.create();
    scenes.forEach(() => doc.addPage([200, 200]));
    doc.setSubject(options?.watermark ?? 'clean');
    return doc.save();
  },
});
const profiles = createProfileStore(pool, {
  directory: profilesDir,
  key: 'profile-encryption-key-for-tests-0123456789',
});
const server = createWorkerServer({
  service,
  // These tests send many exports from one address at once; the queue and the rate
  // limits have their own tests (export.test.ts) and would only get in the way here.
  limiter: createLimiter(1, 1000),
  rateLimits: {
    all: createRateLimiter({ limit: 1_000_000, windowMs: 60_000 }),
    exports: createRateLimiter({ limit: 1_000_000, windowMs: 60_000 }),
  },
  accounts: {
    pool,
    jwtSecret: JWT_SECRET,
    paddle,
    profiles,
    hashSalt: 'salt',
    adminToken: 'admin-token',
  },
});
const ready = new Promise<string>((resolve) =>
  server.listen(0, () => resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}`)),
);
afterAll(async () => {
  server.close();
  await pool.end();
  rmSync(exportsDir, { recursive: true, force: true });
  rmSync(profilesDir, { recursive: true, force: true });
});

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const call = async (
  method: string,
  path: string,
  options: { user?: string; token?: string; body?: unknown; headers?: Record<string, string> } = {},
): Promise<{ status: number; body: Json }> => {
  const token =
    options.token ??
    (options.user && signAccessToken(options.user, JWT_SECRET, Date.now() + 60_000));
  const response = await fetch(`${await ready}${path}`, {
    method,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(options.body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...options.headers,
    },
    body:
      options.body === undefined
        ? undefined
        : typeof options.body === 'string'
          ? options.body
          : JSON.stringify(options.body),
  });
  return { status: response.status, body: (await response.json()) as Json };
};
const me = async (user: string): Promise<Json> => (await call('GET', '/me', { user })).body.account;

let eventCounter = 0;
const inDays = (days: number): string => new Date(Date.now() + days * 86_400_000).toISOString();
const paddleEvent = (type: string, data: Json, secret = paddle.webhookSecret, id?: string) => {
  const body = JSON.stringify({
    event_id: id ?? `evt_http_${Date.now()}_${eventCounter++}`,
    event_type: type,
    occurred_at: new Date().toISOString(),
    data,
  });
  return call('POST', '/webhooks/paddle', {
    body,
    headers: { 'paddle-signature': signPaddlePayload(body, secret, Date.now()) },
  });
};
const subscription = (user: string, overrides: Json = {}): Json => ({
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

describe('signing in', () => {
  it('refuses account routes without a valid token', async () => {
    const user = await createUser(pool);
    for (const [method, path] of [
      ['GET', '/me'],
      ['POST', '/export'],
      ['GET', '/profiles'],
      ['POST', '/referrals/redeem'],
    ] as const) {
      expect((await call(method, path, { body: method === 'POST' ? {} : undefined })).status).toBe(
        401,
      );
    }
    const expired = signAccessToken(user, JWT_SECRET, Date.now() - 1000);
    expect((await call('GET', '/me', { token: expired })).status).toBe(401);
    const forged = signAccessToken(user, 'not-the-real-secret-0123456789', Date.now() + 60_000);
    expect((await call('GET', '/me', { token: forged })).status).toBe(401);
    expect((await call('GET', '/me', { user })).status).toBe(200);
    // Public routes stay public.
    expect((await call('GET', '/health')).status).toBe(200);
    expect((await call('GET', '/plans')).body.plans).toHaveLength(3);
  });
});

describe('the paid flow, end to end', { timeout: 120_000 }, () => {
  it('payment -> pages granted -> export -> pages deducted -> cancellation -> downgrade', async () => {
    const user = await createUser(pool, { activate: false });

    // A verified user who has not opened the app yet has no pages and cannot export.
    expect(await me(user)).toMatchObject({ plan: 'free', activated: false, totalPages: 0 });
    expect((await call('POST', '/export', { user, body: document(1) })).status).toBe(403);

    // Opening the app activates the account: five free pages.
    const activated = await call('POST', '/me/activate', {
      user,
      body: { device: `device-${user}` },
    });
    expect(activated.body.account).toMatchObject({
      activated: true,
      totalPages: 5,
      watermark: true,
    });

    // A free export is watermarked and uses the free pages.
    const free = await call('POST', '/export', { user, body: document(2) });
    expect(free.status).toBe(200);
    expect(free.body).toMatchObject({ pageCount: 2, billablePages: 2, watermarked: true });
    expect(free.body.account.totalPages).toBe(3);

    // More than is left is refused, and costs nothing.
    const tooMany = await call('POST', '/export', { user, body: document(4) });
    expect(tooMany.status).toBe(402);
    expect(tooMany.body.code).toBe('insufficient_credits');
    expect((await me(user)).totalPages).toBe(3);

    // --- Test-mode payment: Paddle reports the new subscription. ---
    expect((await paddleEvent('subscription.created', subscription(user))).body).toEqual({
      outcome: 'processed',
    });
    let account = await me(user);
    expect(account).toMatchObject({
      plan: 'student',
      planName: 'Student',
      monthlyPages: 150,
      monthlyLeft: 150,
      watermark: false,
    });

    // --- Export: clean, and the pages are deducted. ---
    const paid = await call('POST', '/export', { user, body: document(37) });
    expect(paid.body).toMatchObject({ pageCount: 37, billablePages: 37, watermarked: false });
    account = paid.body.account;
    expect(`${account.monthlyUsed} / ${account.monthlyPages} pages`).toBe('37 / 150 pages');
    expect(new Date(account.creditsResetOn).getTime()).toBeGreaterThan(
      Date.now() + 27 * 86_400_000,
    );

    // The link works without signing in, and gives the PDF.
    const file = await fetch(`${await ready}${paid.body.downloadPath}`);
    expect(file.status).toBe(200);
    const pdf = await PDFDocument.load(new Uint8Array(await file.arrayBuffer()));
    expect(pdf.getPageCount()).toBe(37);
    expect(pdf.getSubject()).toBe('clean');

    // The same document again within a day is free.
    const repeat = await call('POST', '/export', { user, body: document(37) });
    expect(repeat.body).toMatchObject({ billablePages: 0, cached: true });
    expect(repeat.body.account.monthlyUsed).toBe(37);

    // --- Cancellation: access stays until the paid period ends. ---
    await paddleEvent(
      'subscription.updated',
      subscription(user, { scheduled_change: { action: 'cancel', effective_at: inDays(30) } }),
    );
    account = await me(user);
    expect(account).toMatchObject({ plan: 'student', cancelAtPeriodEnd: true, monthlyLeft: 113 });
    expect(
      (await call('POST', '/export', { user, body: document(1, {}, 'Still paid.') })).body
        .watermarked,
    ).toBe(false);

    // --- Downgrade: the period ends, Paddle reports the subscription cancelled. ---
    await paddleEvent(
      'subscription.canceled',
      subscription(user, {
        status: 'canceled',
        current_billing_period: null,
        canceled_at: new Date(Date.now() - 300_000).toISOString(),
      }),
    );
    account = await me(user);
    expect(account).toMatchObject({
      plan: 'free',
      monthlyPages: 5,
      monthlyLeft: 5,
      watermark: true,
      cancelAtPeriodEnd: false,
      paidUntil: null,
    });
    const after = await call('POST', '/export', { user, body: document(1, {}, 'Free again.') });
    expect(after.body).toMatchObject({ watermarked: true, billablePages: 1 });

    // The ledger tells the whole story, with reasons.
    const { ledger } = (await call('GET', '/me', { user })).body;
    const kinds = (ledger as Json[]).map((row) => row.kind).reverse();
    expect(kinds).toEqual([
      'monthly_grant', // free allowance
      'export', // 2 free pages
      'monthly_expiry', // free pages replaced by the plan's
      'monthly_grant', // 150
      'export', // 37
      'export', // 1
      'monthly_expiry', // unused paid pages lapse on downgrade
      'monthly_grant', // free allowance again
      'export', // 1
    ]);
    expect((ledger as Json[]).every((row) => row.reason.length > 0)).toBe(true);
  });
});

describe('payment notifications over HTTP', () => {
  it('rejects forged ones and does not double-grant replays', async () => {
    const user = await createUser(pool);
    const forged = await paddleEvent('subscription.created', subscription(user), 'attacker-secret');
    expect(forged.status).toBe(401);
    expect((await me(user)).plan).toBe('free');

    const data = {
      id: 'txn_http',
      status: 'completed',
      customer_id: `ctm_${user}`,
      items: [{ price: { id: 'pri_top_up' }, quantity: 1 }],
      custom_data: { user_id: user },
      details: { totals: { total: '300', currency_code: 'USD' } },
    };
    const id = `evt_replay_${user}`;
    expect((await paddleEvent('transaction.completed', data, undefined, id)).body.outcome).toBe(
      'processed',
    );
    expect((await paddleEvent('transaction.completed', data, undefined, id)).body.outcome).toBe(
      'duplicate',
    );
    expect(await me(user)).toMatchObject({ extraPages: 100, totalPages: 105 });
  });
});

describe('free tier enforcement', { timeout: 60_000 }, () => {
  it('is decided by the server whatever the client sends', async () => {
    const user = await createUser(pool);
    const basic = document(1, { ink: 'ballpoint-blue' });

    // Claiming a plan, a price or a watermark setting in the request is refused outright.
    for (const extra of [
      { plan: 'pro' },
      { watermark: false },
      { billablePages: 0 },
      { user_id: 'x' },
    ]) {
      const tampered = await call('POST', '/export', { user, body: { ...basic, ...extra } });
      expect(tampered.status).toBe(400);
    }
    for (const option of [{ watermark: false }, { plan: 'pro' }]) {
      const tampered = await call('POST', '/export', {
        user,
        body: { ...basic, options: { ...basic.options, ...option } },
      });
      expect(tampered.status).toBe(400);
    }

    // Asking for paid options on the free plan gets the basic ones instead: the result
    // is the very same file as the basic request, watermarked, and the repeat is free.
    const first = await call('POST', '/export', { user, body: basic });
    expect(first.body).toMatchObject({ watermarked: true, billablePages: 1 });
    const greedy = await call('POST', '/export', {
      user,
      body: document(1, {
        ink: 'fountain',
        inkColor: '#aa0000',
        corrections: 0.05,
        header: [{ label: 'Name', value: 'Sara' }],
      }),
    });
    expect(greedy.body).toMatchObject({ id: first.body.id, watermarked: true, billablePages: 0 });

    const file = await fetch(`${await ready}${greedy.body.downloadPath}`);
    const pdf = await PDFDocument.load(new Uint8Array(await file.arrayBuffer()));
    expect(pdf.getSubject()).toBe('PenTwin free plan');
    expect(await me(user)).toMatchObject({ plan: 'free', totalPages: 4 });
  });
});

describe('exports and pages', { timeout: 120_000 }, () => {
  it('returns the pages when an export fails', async () => {
    const user = await createUser(pool);
    await paddleEvent('subscription.created', subscription(user));
    failRendering = true;
    const failed = await call('POST', '/export', { user, body: document(10, {}, 'Will fail.') });
    failRendering = false;
    expect(failed.status).toBe(500);
    expect(failed.body.error).toContain('Nothing was charged');
    expect(await me(user)).toMatchObject({ monthlyLeft: 150, monthlyUsed: 0 });
    // And it can be exported normally afterwards, at the normal price.
    const retry = await call('POST', '/export', { user, body: document(10, {}, 'Will fail.') });
    expect(retry.body).toMatchObject({ billablePages: 10, cached: false });
  });

  it('never lets simultaneous exports overspend', async () => {
    const user = await createUser(pool);
    await paddleEvent('subscription.created', subscription(user)); // 150 pages
    // Ten different 20-page documents at once: 200 pages wanted.
    const answers = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        call('POST', '/export', { user, body: document(20, {}, `Document ${i}.`) }),
      ),
    );
    expect(answers.filter((a) => a.status === 200)).toHaveLength(7);
    expect(answers.filter((a) => a.status === 402)).toHaveLength(3);
    expect(await me(user)).toMatchObject({ monthlyLeft: 10, totalPages: 10 });
  });
});

describe('handwriting profiles', () => {
  const body = { name: 'My handwriting', bank, ownHandwriting: true, style: { slant: 3 } };

  it('saves, reloads and deletes a profile, encrypted on disk', async () => {
    const user = await createUser(pool);
    const saved = await call('POST', '/profiles', { user, body });
    expect(saved.status).toBe(201);
    const { id } = saved.body.profile;

    expect((await call('GET', '/profiles', { user })).body.profiles).toEqual([saved.body.profile]);
    const loaded = await call('GET', `/profiles/${id}`, { user });
    expect(loaded.body.bank).toEqual(bank);

    // What is on disk is not readable: no glyph name, no path data.
    const [file] = readdirSync(profilesDir).filter((name) => name.endsWith('.bin'));
    const raw = readFileSync(join(profilesDir, file!)).toString('latin1');
    expect(raw).not.toContain('sample-user');
    expect(raw).not.toContain('<svg');

    expect((await call('DELETE', `/profiles/${id}`, { user })).status).toBe(200);
    expect((await call('GET', `/profiles/${id}`, { user })).status).toBe(404);
    expect((await call('GET', '/profiles', { user })).body.profiles).toEqual([]);
  });

  it('keeps profiles private and within the plan limit', async () => {
    const owner = await createUser(pool);
    const other = await createUser(pool);
    const { id } = (await call('POST', '/profiles', { user: owner, body })).body.profile;

    expect((await call('GET', `/profiles/${id}`, { user: other })).status).toBe(404);
    expect((await call('DELETE', `/profiles/${id}`, { user: other })).status).toBe(404);
    expect((await call('GET', `/profiles/${id}`, { user: owner })).status).toBe(200);

    // The free plan allows one profile.
    const second = await call('POST', '/profiles', {
      user: owner,
      body: { ...body, name: 'Second' },
    });
    expect(second.status).toBe(403);
    expect(second.body.code).toBe('profile_limit_reached');
    // Nothing is left on disk for the refused one.
    // Every file on disk belongs to a profile that exists, and the owner still has one.
    const keys = (await pool.query(`select storage_key from public.handwriting_profiles`)).rows.map(
      (row) => `${row.storage_key}.bin`,
    );
    for (const file of readdirSync(profilesDir)) expect(keys).toContain(file);
    expect((await call('GET', '/profiles', { user: owner })).body.profiles).toHaveLength(1);

    // Not without confirming it is the user's own handwriting.
    const unconfirmed = await call('POST', '/profiles', {
      user: other,
      body: { ...body, ownHandwriting: false },
    });
    expect(unconfirmed.status).toBe(400);
    expect(unconfirmed.body.code).toBe('own_handwriting_not_confirmed');
    expect(
      (await call('POST', '/profiles', { user: other, body: { name: 'x', bank: { nope: 1 } } }))
        .status,
    ).toBe(400);
  });
});

describe('referrals and the cost report', () => {
  it('redeems an invite code once', async () => {
    const inviter = await createUser(pool);
    const friend = await createUser(pool);
    const code = (await me(inviter)).referralCode;
    expect(
      (await call('POST', '/referrals/redeem', { user: friend, body: { code } })).body,
    ).toEqual({
      result: 'granted',
    });
    const again = await call('POST', '/referrals/redeem', { user: friend, body: { code } });
    expect(again.status).toBe(409);
    expect(again.body.result).toBe('already_referred');
    expect((await me(inviter)).extraPages).toBe(20);
    expect((await me(friend)).extraPages).toBe(20);
  });

  it('shows the cost report to the administrator only', async () => {
    const user = await createUser(pool);
    expect((await call('GET', '/admin/costs')).status).toBe(404);
    expect((await call('GET', '/admin/costs', { user })).status).toBe(404);
    const report = await call('GET', '/admin/costs', { token: 'admin-token' });
    expect(report.status).toBe(200);
    expect(report.body.plans.length).toBeGreaterThan(0);
    expect(report.body).toHaveProperty('costPerPage');
    expect(JSON.stringify(report.body)).not.toContain('One page of text');
  });
});

describe('privacy: consent, a copy of your data, and deletion', { timeout: 120_000 }, () => {
  const profile = (name: string) => ({ name, bank, ownHandwriting: true });
  const rowsFor = async (table: string, column: string, user: string): Promise<number> =>
    Number(
      (await pool.query(`select count(*) as n from public.${table} where ${column} = $1`, [user]))
        .rows[0].n,
    );
  /** Every handwriting file on disk that no profile row points to. */
  const orphanFiles = async (): Promise<string[]> => {
    const keys = readdirSync(profilesDir).flatMap(
      (name) => /^([0-9a-f-]{36})\.bin$/i.exec(name)?.[1] ?? [],
    );
    const { rows } = await pool.query(`select storage_key from public.handwriting_profiles`);
    const known = new Set(rows.map((row) => row.storage_key));
    return keys.filter((key) => !known.has(key));
  };

  it('keeps an append-only consent log that the user can read back', async () => {
    const user = await createUser(pool);
    const given = await call('POST', '/me/consents', {
      user,
      body: { kind: 'terms', version: '2026-10-08', granted: true },
    });
    expect(given.status).toBe(201);
    expect(given.body.consent).toMatchObject({
      kind: 'terms',
      version: '2026-10-08',
      granted: true,
    });
    expect((await call('POST', '/me/consents', { user, body: { kind: 'cookies' } })).status).toBe(
      400,
    );
    // Saving handwriting records the "my own handwriting" confirmation too.
    expect((await call('POST', '/profiles', { user, body: profile('Mine') })).status).toBe(201);

    // Nobody, not even the server, can quietly change or remove a consent row.
    await expect(
      pool.query(`update public.consents set granted = false where user_id = $1`, [user]),
    ).rejects.toThrow('consents is append-only');
    await expect(
      pool.query(`delete from public.consents where user_id = $1`, [user]),
    ).rejects.toThrow('consents is append-only');

    const copy = await call('GET', '/me/data', { user });
    expect(copy.status).toBe(200);
    expect((copy.body.consents as Json[]).map((row) => [row.kind, row.granted])).toEqual([
      ['terms', true],
      ['own_handwriting', true],
    ]);
  });

  it('gives the user everything held about them, and nothing about anyone else', async () => {
    const user = await createUser(pool);
    const other = await createUser(pool);
    await call('POST', '/profiles', { user, body: profile('Exam hand') });
    await call('POST', '/export', { user, body: document(1, {}, 'A private letter.') });

    const copy = (await call('GET', '/me/data', { user })).body;
    expect(copy.account.email).toMatch(/@example\.test$/);
    expect(copy.account.plan).toBe('free');
    expect(copy.ledger.length).toBeGreaterThan(0);
    expect(copy.exports).toHaveLength(1);
    expect(copy.profiles[0]).toMatchObject({ name: 'Exam hand', bank });
    expect(copy.referrals).toEqual({ youWereReferred: false, peopleYouReferred: 0 });

    const text = JSON.stringify(copy);
    // Exported documents are listed without their content: it was never stored.
    expect(text).not.toContain('A private letter');
    const otherEmail = (await pool.query(`select email from auth.users where id = $1`, [other]))
      .rows[0].email;
    expect(text).not.toContain(otherEmail);
    expect(text).not.toContain(other);
  });

  it('deletes an account with every row and file, and leaves nothing orphaned', async () => {
    const user = await createUser(pool);
    await paddleEvent('subscription.created', subscription(user));
    const first = await call('POST', '/profiles', { user, body: profile('First') });
    const second = await call('POST', '/profiles', { user, body: profile('Second') });
    expect([first.status, second.status]).toEqual([201, 201]);
    await call('POST', '/me/consents', {
      user,
      body: { kind: 'privacy', version: '2026-10-08', granted: true },
    });
    const exported = await call('POST', '/export', {
      user,
      body: document(2, {}, 'Please forget this.'),
    });
    expect(exported.status).toBe(200);

    const storageKeys = (
      await pool.query(`select storage_key from public.handwriting_profiles where user_id = $1`, [
        user,
      ])
    ).rows.map((row) => row.storage_key as string);
    expect(storageKeys).toHaveLength(2);
    const pdf = join(exportsDir, `${exported.body.id}.pdf`);
    expect(existsSync(pdf)).toBe(true);
    for (const key of storageKeys) expect(existsSync(join(profilesDir, `${key}.bin`))).toBe(true);
    const countDeletions = async (): Promise<number> =>
      Number((await pool.query(`select count(*) as n from public.account_deletions`)).rows[0].n);
    const deletionsBefore = await countDeletions();

    // A slip of the finger is not enough, and neither is a subscription still renewing.
    expect((await call('DELETE', '/me', { user, body: { confirm: 'yes' } })).body.code).toBe(
      'confirmation_required',
    );
    const renewing = await call('DELETE', '/me', { user, body: { confirm: 'delete my account' } });
    expect(renewing.status).toBe(409);
    expect(renewing.body.code).toBe('subscription_active');
    expect(await rowsFor('accounts', 'user_id', user)).toBe(1);

    await paddleEvent(
      'subscription.updated',
      subscription(user, { scheduled_change: { action: 'cancel', effective_at: inDays(30) } }),
    );
    const deleted = await call('DELETE', '/me', { user, body: { confirm: 'delete my account' } });
    expect(deleted.status).toBe(200);
    expect(deleted.body).toEqual({ deleted: true, profilesDeleted: 2 });

    // Rows: all gone, in every table that can hold something about the user.
    for (const [table, column] of [
      ['accounts', 'user_id'],
      ['credit_ledger', 'user_id'],
      ['exports', 'user_id'],
      ['handwriting_profiles', 'user_id'],
      ['consents', 'user_id'],
      ['email_outbox', 'user_id'],
      ['referral_redemptions', 'referred'],
      ['referral_rejections', 'user_id'],
    ] as const) {
      expect(await rowsFor(table, column, user), table).toBe(0);
    }
    expect((await pool.query(`select 1 from auth.users where id = $1`, [user])).rowCount).toBe(0);
    // The token is still valid, but there is no longer anyone behind it.
    expect((await call('GET', '/me', { user })).status).toBe(404);

    // Files: the handwriting and the exported PDF are gone, and nothing is orphaned.
    for (const key of storageKeys) expect(existsSync(join(profilesDir, `${key}.bin`))).toBe(false);
    expect(existsSync(pdf)).toBe(false);
    expect(existsSync(`${pdf.slice(0, -4)}.json`)).toBe(false);
    expect(await orphanFiles()).toEqual([]);
    expect(await profiles.sweepOrphans(0)).toBe(0);

    // What remains is a count, with nothing that says whose account it was.
    expect(await countDeletions()).toBe(deletionsBefore + 1);
    const deletions = await pool.query(
      `select profiles, exports from public.account_deletions order by id desc limit 1`,
    );
    expect(deletions.rows[0]).toEqual({ profiles: 2, exports: 1 });
    const columns = (
      await pool.query(
        `select column_name from information_schema.columns
          where table_schema = 'public' and table_name = 'account_deletions'`,
      )
    ).rows.map((row) => row.column_name);
    expect(columns).not.toContain('user_id');
    expect(columns).not.toContain('email');
  });

  it('sweeps stray handwriting files, but not one that is still being saved', async () => {
    const user = await createUser(pool);
    await call('POST', '/profiles', { user, body: profile('Kept') });
    const old = join(profilesDir, `${randomUUID()}.bin`);
    const fresh = join(profilesDir, `${randomUUID()}.bin`);
    writeFileSync(old, 'left behind by a crash');
    writeFileSync(fresh, 'being written right now');
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
    utimesSync(old, twoHoursAgo, twoHoursAgo);

    expect(await profiles.sweepOrphans()).toBe(1);
    expect(existsSync(old)).toBe(false);
    expect(existsSync(fresh)).toBe(true);
    expect((await call('GET', '/profiles', { user })).body.profiles).toHaveLength(1);

    rmSync(fresh);
    expect(await orphanFiles()).toEqual([]);
  });
});
