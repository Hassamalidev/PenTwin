/**
 * Load and abuse test for the export worker (Phase 7.8).
 *
 *   pnpm db:up && pnpm load:test
 *
 * Starts the worker exactly as it ships (the bundled file the container runs), with
 * accounts switched on against the throwaway test database, and attacks it over HTTP:
 * 50 exports at once, attempts to get pages without paying, replayed and forged payment
 * notifications, oversized requests and races to spend the same pages twice.
 *
 * Prints a report and exits with an error if any check fails. It wipes the TEST
 * database first; it never touches any other.
 */
import { execSync, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { cpus, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { PDFDocument } from 'pdf-lib';
import { signAccessToken, signPaddlePayload } from '../packages/billing/src/index';
import {
  createTestPool,
  createUser,
  resetDatabase,
  TEST_DATABASE_URL,
} from '../packages/billing/src/testing';

const PORT = 8795;
const BASE = `http://127.0.0.1:${PORT}`;
const JWT_SECRET = 'load-test-jwt-secret-0123456789-0123456789';
const WEBHOOK_SECRET = 'load-test-webhook-secret';
const CONCURRENT = 50;
const PAGES_EACH = 3;

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

// --- Report -----------------------------------------------------------------------------
let failures = 0;
const lines: string[] = [];
const say = (line = ''): void => {
  lines.push(line);
  console.log(line);
};
const check = (label: string, passed: boolean, detail = ''): void => {
  if (!passed) failures++;
  say(`| ${passed ? 'pass' : '**FAIL**'} | ${label} | ${detail} |`);
};
const section = (title: string): void => {
  say(`\n### ${title}\n`);
  say('| Result | Check | Measured |');
  say('| --- | --- | --- |');
};
const percentile = (values: number[], p: number): number => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)] ?? 0;
};
const seconds = (ms: number): string => `${(ms / 1000).toFixed(1)} s`;

// --- The worker, as it ships -------------------------------------------------------------
execSync('pnpm worker:build', { stdio: 'ignore', shell: process.env.ComSpec ?? '/bin/sh' });
const exportsDir = mkdtempSync(join(tmpdir(), 'pentwin-load-exports-'));
const profilesDir = mkdtempSync(join(tmpdir(), 'pentwin-load-profiles-'));
const runDir = mkdtempSync(join(tmpdir(), 'pentwin-load-run-'));

await resetDatabase();
const pool = createTestPool();

const worker: ChildProcessWithoutNullStreams = spawn(
  process.execPath,
  [resolve('dist/worker/main.cjs')],
  {
    // An empty folder, so no .env file from the repository is picked up.
    cwd: runDir,
    env: {
      PATH: process.env.PATH,
      SystemRoot: process.env.SystemRoot,
      NODE_ENV: 'production',
      APP_ENV: 'development',
      WORKER_PORT: String(PORT),
      DATABASE_URL: TEST_DATABASE_URL,
      SUPABASE_JWT_SECRET: JWT_SECRET,
      PADDLE_WEBHOOK_SECRET: WEBHOOK_SECRET,
      PADDLE_PRICE_STUDENT_MONTH: 'pri_student_month',
      PADDLE_PRICE_TOP_UP: 'pri_top_up',
      PROFILE_ENCRYPTION_KEY: 'load-test-profile-key-0123456789-0123456789',
      FINGERPRINT_SALT: 'load-test-fingerprint-salt',
      EXPORT_SIGNING_SECRET: 'load-test-signing-secret-0123456789-0123',
      EXPORT_STORAGE_DIR: exportsDir,
      PROFILE_STORAGE_DIR: profilesDir,
      // Lets this test play many visitors, each with their own address and rate limit.
      CLIENT_IP_HEADER: 'x-load-client',
    },
    stdio: 'pipe',
  },
);
let workerLog = '';
worker.stdout.on('data', (chunk: Buffer) => (workerLog += chunk.toString()));
worker.stderr.on('data', (chunk: Buffer) => (workerLog += chunk.toString()));
let workerExit: number | null | undefined;
worker.on('exit', (code: number | null) => (workerExit = code));

const healthy = async (): Promise<boolean> =>
  fetch(`${BASE}/health`).then(
    (response) => response.ok,
    () => false,
  );
for (let i = 0; i < 100 && !(await healthy()); i++) {
  await new Promise((done) => setTimeout(done, 100));
}
if (!(await healthy())) {
  console.error(`The worker did not start:\n${workerLog}`);
  process.exit(1);
}

// --- Helpers ----------------------------------------------------------------------------
const glyphDir = 'tests/fixtures/glyphs/sample-user';
const bank = {
  metadata: JSON.parse(readFileSync(join(glyphDir, 'metadata.json'), 'utf8')) as unknown,
  files: Object.fromEntries(
    readdirSync(glyphDir)
      .filter((name) => name.endsWith('.svg'))
      .map((name) => [name, readFileSync(join(glyphDir, name), 'utf8')]),
  ),
};
const paragraph = readFileSync('tests/sample.txt', 'utf8').trim();

/** A document of exactly `pages` full pages of real text; `tag` makes it unique. */
const document = (pages: number, tag: string, full = true): Json => ({
  blocks: Array.from({ length: pages }, (_, page) => [
    ...(page > 0 ? [{ type: 'pageBreak' }] : []),
    { type: 'paragraph', text: `${tag}, page ${page + 1}.` },
    ...(full ? [1, 2, 3].map(() => ({ type: 'paragraph', text: paragraph })) : []),
  ]).flat(),
  bank,
  options: { seed: tag, pageSize: 'A4' },
});

const tokenOf = (user: string): string => signAccessToken(user, JWT_SECRET, Date.now() + 600_000);

interface Answer {
  status: number;
  body: Json;
  ms: number;
  retryAfter: number;
}
const api = async (
  method: string,
  path: string,
  options: { user?: string; token?: string; body?: unknown; client?: string; raw?: string } = {},
  headers: Record<string, string> = {},
): Promise<Answer> => {
  const token = options.token ?? (options.user ? tokenOf(options.user) : undefined);
  const started = performance.now();
  try {
    const response = await fetch(`${BASE}${path}`, {
      method,
      headers: {
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        'content-type': 'application/json',
        'x-load-client': options.client ?? options.user ?? 'load-test',
        ...headers,
      },
      body: options.raw ?? (options.body === undefined ? undefined : JSON.stringify(options.body)),
    });
    const body = (await response.json().catch(() => ({}))) as Json;
    return {
      status: response.status,
      body,
      ms: performance.now() - started,
      retryAfter: Number(response.headers.get('retry-after') ?? 0),
    };
  } catch {
    // The worker closed the connection (what it does to a request that is too large).
    return { status: 0, body: {}, ms: performance.now() - started, retryAfter: 0 };
  }
};

/** Exports the way a patient client would: when told the worker is busy, wait and retry. */
const exportPatiently = async (
  user: string,
  body: Json,
): Promise<Answer & { busy: number; totalMs: number }> => {
  const started = performance.now();
  let busy = 0;
  for (;;) {
    const answer = await api('POST', '/export', { user, body });
    if (answer.status !== 503) return { ...answer, busy, totalMs: performance.now() - started };
    busy++;
    // Wait as long as the worker asked, give or take, so the retries do not all land together.
    const wait = (answer.retryAfter || 5) * 1000 * (0.5 + Math.random());
    await new Promise((done) => setTimeout(done, wait));
  }
};

let eventCounter = 0;
const paddleEvent = (
  type: string,
  data: Json,
  options: { id?: string; secret?: string; at?: number; tamper?: boolean } = {},
): Promise<Answer> => {
  const body = JSON.stringify({
    event_id: options.id ?? `evt_load_${Date.now()}_${eventCounter++}`,
    event_type: type,
    occurred_at: new Date().toISOString(),
    data,
  });
  const signature = signPaddlePayload(
    body,
    options.secret ?? WEBHOOK_SECRET,
    options.at ?? Date.now(),
  );
  return api(
    'POST',
    '/webhooks/paddle',
    { raw: options.tamper ? body.replace('"quantity":1', '"quantity":9') : body },
    { 'paddle-signature': signature },
  );
};
const inDays = (days: number): string => new Date(Date.now() + days * 86_400_000).toISOString();
const subscribe = (user: string): Promise<Answer> =>
  paddleEvent('subscription.created', {
    id: `sub_${user}`,
    status: 'active',
    customer_id: `ctm_${user}`,
    items: [{ price: { id: 'pri_student_month' }, quantity: 1 }],
    current_billing_period: { starts_at: inDays(0), ends_at: inDays(30) },
    scheduled_change: null,
    canceled_at: null,
    custom_data: { user_id: user },
  });
const topUp = (user: string): Json => ({
  id: `txn_${user}`,
  status: 'completed',
  customer_id: `ctm_${user}`,
  items: [{ price: { id: 'pri_top_up' }, quantity: 1 }],
  custom_data: { user_id: user },
  details: { totals: { total: '300', currency_code: 'USD' } },
});
const account = async (user: string): Promise<Json> =>
  (await api('GET', '/me', { user })).body.account as Json;
const count = async (sql: string, params: unknown[] = []): Promise<number> =>
  Number((await pool.query(sql, params)).rows[0].n);

say(`# Load and abuse test`);
say(
  `\nRun ${new Date().toISOString().slice(0, 10)} on ${cpus()[0]?.model.trim()} (${cpus().length} threads), ` +
    `Node ${process.version}. The worker is the bundled file the container runs, one process, ` +
    `with accounts on and a real Postgres. One machine, one run: a baseline, not a benchmark.`,
);

try {
  // === 1. Load: 50 exports at the same moment ===========================================
  section(
    `${CONCURRENT} exports at once (${PAGES_EACH} full pages each, ${CONCURRENT} paying users)`,
  );
  const users: string[] = [];
  for (let i = 0; i < CONCURRENT; i++) users.push(await createUser(pool));
  const subscribed = await Promise.all(users.map(subscribe));
  check(
    'every user is on the paid plan before the test',
    subscribed.every((answer) => answer.body.outcome === 'processed'),
  );

  const started = performance.now();
  const results = await Promise.all(
    users.map((user, index) => exportPatiently(user, document(PAGES_EACH, `Load ${index}`))),
  );
  const wall = performance.now() - started;
  const completed = results.filter((result) => result.status === 200);
  const turnedAway = results.filter((result) => result.busy > 0).length;
  const totals = results.map((result) => result.totalMs);
  check(
    'every export completed',
    completed.length === CONCURRENT,
    `${completed.length} of ${CONCURRENT}; statuses: ${[...new Set(results.map((r) => r.status))].join(', ')}`,
  );
  check(
    'the worker protected itself instead of taking everything at once',
    turnedAway > 0,
    `${turnedAway} of ${CONCURRENT} were told "busy" (503) at least once and retried; ` +
      `${results.reduce((sum, result) => sum + result.busy, 0)} busy answers in all`,
  );
  say(
    `| - | time until a user had their PDF, counting retries | p50 ${seconds(percentile(totals, 50))}, ` +
      `**p95 ${seconds(percentile(totals, 95))}**, slowest ${seconds(Math.max(...totals))} |`,
  );
  const compute = (
    await pool.query(`select compute_ms from public.exports where status = 'completed'`)
  ).rows.map((row) => Number(row.compute_ms));
  say(
    `| - | time the worker spent rendering one export | p50 ${seconds(percentile(compute, 50))}, ` +
      `p95 ${seconds(percentile(compute, 95))} |`,
  );
  say(
    `| - | throughput | ${CONCURRENT} exports, ${CONCURRENT * PAGES_EACH} pages in ${seconds(wall)}: ` +
      `${((CONCURRENT * PAGES_EACH) / (wall / 1000)).toFixed(1)} pages a second |`,
  );

  const balances = await Promise.all(users.map(account));
  check(
    'every user was charged exactly once for exactly their pages',
    balances.every((balance) => balance.monthlyLeft === 150 - PAGES_EACH),
    `pages left: ${[...new Set(balances.map((balance) => balance.monthlyLeft))].join(', ')} (expected ${150 - PAGES_EACH})`,
  );
  check(
    'one completed export recorded per user, none left half-done',
    (await count(`select count(*) as n from public.exports where status = 'completed'`)) ===
      CONCURRENT &&
      (await count(`select count(*) as n from public.exports where status = 'reserved'`)) === 0,
  );
  const sample = completed[0]!;
  const file = await fetch(`${BASE}${sample.body.downloadPath}`);
  const pdf = await PDFDocument.load(new Uint8Array(await file.arrayBuffer()));
  check(
    'a downloaded file is a complete PDF with the right number of pages',
    file.status === 200 && pdf.getPageCount() === PAGES_EACH,
    `${pdf.getPageCount()} pages`,
  );

  // === 2. Spending the same pages twice ==================================================
  section('Races to spend the same pages twice');
  const racer = await createUser(pool); // free plan: 5 pages
  const race = await Promise.all(
    Array.from({ length: 20 }, (_, i) => exportPatiently(racer, document(1, `Race ${i}`, false))),
  );
  const won = race.filter((result) => result.status === 200).length;
  const refused = race.filter((result) => result.status === 402).length;
  const afterRace = await account(racer);
  check(
    '20 one-page exports at once with 5 pages: exactly 5 succeed',
    won === 5 && refused === 15,
    `${won} succeeded, ${refused} refused for lack of pages (402)`,
  );
  check(
    'the balance ends at zero, not below',
    afterRace.totalPages === 0,
    `${afterRace.totalPages} pages left`,
  );

  const pairs = await createUser(pool);
  const pairRace = await Promise.all(
    Array.from({ length: 10 }, (_, i) => exportPatiently(pairs, document(2, `Pair ${i}`, false))),
  );
  check(
    '10 two-page exports at once with 5 pages: exactly 2 succeed, 1 page is left',
    pairRace.filter((result) => result.status === 200).length === 2 &&
      (await account(pairs)).totalPages === 1,
    `${pairRace.filter((result) => result.status === 200).length} succeeded, ${(await account(pairs)).totalPages} page left`,
  );

  // A user who has not exported yet, so the per-address allowance is untouched.
  const repeater = await createUser(pool);
  await subscribe(repeater);
  const beforeRepeat = (await account(repeater)).monthlyLeft as number;
  const same = document(2, 'Same document', false);
  const repeats = await Promise.all(
    Array.from({ length: 20 }, () => exportPatiently(repeater, same)),
  );
  const afterRepeat = (await account(repeater)).monthlyLeft as number;
  check(
    'the same document sent 20 times at once is charged once',
    repeats.every((result) => result.status === 200) && beforeRepeat - afterRepeat === 2,
    `${beforeRepeat - afterRepeat} pages charged for 20 requests; statuses: ${[...new Set(repeats.map((r) => r.status))].join(', ')}`,
  );
  check(
    'no balance anywhere is negative',
    (await count(
      `select count(*) as n from public.credit_balances where total < 0 or monthly < 0 or extra < 0`,
    )) === 0,
  );

  // === 3. Getting pages without paying ====================================================
  section('Attempts to get pages or paid features without paying');
  const cheat = await createUser(pool);
  const honest = document(1, 'Cheat', false);
  const bypass: [string, Json][] = [
    ['a plan in the request', { ...honest, plan: 'pro' }],
    [
      '"no watermark" in the options',
      { ...honest, options: { ...honest.options, watermark: false } },
    ],
    ['a page count in the request', { ...honest, pages: 0, billablePages: 0 }],
    ['a user id in the request', { ...honest, userId: users[1] }],
  ];
  for (const [label, body] of bypass) {
    const answer = await api('POST', '/export', { user: cheat, body });
    check(`${label} is refused outright`, answer.status === 400, `status ${answer.status}`);
  }
  const free = await api('POST', '/export', { user: cheat, body: honest });
  check(
    'a free user gets a watermark and is charged, whatever they send',
    free.status === 200 && free.body.watermarked === true && free.body.billablePages === 1,
    `watermarked=${free.body.watermarked}, charged ${free.body.billablePages}`,
  );

  const encode = (value: unknown): string =>
    Buffer.from(JSON.stringify(value)).toString('base64url');
  const unsigned = `${encode({ alg: 'none', typ: 'JWT' })}.${encode({ sub: users[1], role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 600 })}.`;
  const tokens: [string, string | undefined][] = [
    ['no token', undefined],
    ['a made-up token', 'not-a-token'],
    [
      'a token signed with the wrong key',
      signAccessToken(users[1]!, 'x'.repeat(40), Date.now() + 600_000),
    ],
    ['an expired token', signAccessToken(users[1]!, JWT_SECRET, Date.now() - 60_000)],
    ['an unsigned token claiming to be someone else', unsigned],
  ];
  for (const [label, token] of tokens) {
    const answer = await api('POST', '/export', { token, body: honest, client: `forger-${label}` });
    check(`${label} is refused`, answer.status === 401, `status ${answer.status}`);
  }
  check(
    "the other user's pages were not touched by any of that",
    (await account(users[1]!)).monthlyLeft === 150 - PAGES_EACH,
  );
  const admin = await api('GET', '/admin/costs', { token: 'guess', client: 'snoop' });
  check('the admin report does not exist for someone without the token', admin.status === 404);

  // === 4. Payment notifications ==========================================================
  section('Replayed and forged payment notifications');
  const buyer = await createUser(pool);
  const replayId = `evt_replay_${buyer}`;
  const replays = await Promise.all(
    Array.from({ length: 25 }, () =>
      paddleEvent('transaction.completed', topUp(buyer), { id: replayId }),
    ),
  );
  const outcomes = replays.map((answer) => String(answer.body.outcome));
  const buyerAccount = await account(buyer);
  check(
    'the same payment sent 25 times at once grants its pages once',
    buyerAccount.extraPages === 100 &&
      outcomes.filter((outcome) => outcome === 'processed').length === 1 &&
      outcomes.filter((outcome) => outcome === 'duplicate').length === 24,
    `${buyerAccount.extraPages} extra pages; processed ${outcomes.filter((o) => o === 'processed').length}, duplicate ${outcomes.filter((o) => o === 'duplicate').length}`,
  );
  const forged: [string, Promise<Answer>][] = [
    [
      'signed with the wrong secret',
      paddleEvent('transaction.completed', topUp(buyer), { secret: 'attacker' }),
    ],
    [
      'a real signature that is five minutes old',
      paddleEvent('transaction.completed', topUp(buyer), { at: Date.now() - 300_000 }),
    ],
    [
      'a real signature on a changed body',
      paddleEvent('transaction.completed', topUp(buyer), { tamper: true }),
    ],
    [
      'no signature at all',
      api('POST', '/webhooks/paddle', {
        body: { event_id: 'x', event_type: 'transaction.completed', data: topUp(buyer) },
      }),
    ],
  ];
  for (const [label, sending] of forged) {
    const answer = await sending;
    check(`a notification ${label} is refused`, answer.status === 401, `status ${answer.status}`);
  }
  check(
    'none of the forged notifications granted anything',
    (await account(buyer)).extraPages === 100,
    `${(await account(buyer)).extraPages} extra pages`,
  );

  // === 5. Oversized requests ==============================================================
  section('Oversized and malformed requests');
  const big = await createUser(pool);
  await subscribe(big);
  const pagesBefore = (await account(big)).totalPages as number;
  const huge = await api('POST', '/export', {
    user: big,
    raw: JSON.stringify({ ...honest, padding: 'x'.repeat(9 * 1024 * 1024) }),
  });
  check(
    'a 9 MB request is refused (limit 8 MB)',
    huge.status === 413 || huge.status === 0,
    huge.status === 0 ? 'connection closed' : `status ${huge.status}`,
  );
  const long = await api('POST', '/export', { user: big, body: document(101, 'Too long', false) });
  check('a 101-page document is refused (limit 100)', long.status === 413, `status ${long.status}`);
  const picture = `data:image/png;base64,${'iVBORw0KGgo'.padEnd(3_000_000, 'A')}`;
  const withPicture = await api('POST', '/export', {
    user: big,
    body: { ...honest, blocks: [{ type: 'image', href: picture, width: 50, height: 50 }] },
  });
  check(
    'a picture over the size limit is refused',
    withPicture.status === 400,
    `status ${withPicture.status}`,
  );
  const remote = await api('POST', '/export', {
    user: big,
    body: {
      ...honest,
      blocks: [
        { type: 'image', href: 'http://169.254.169.254/latest/meta-data', width: 50, height: 50 },
      ],
    },
  });
  check(
    'a picture given as an address is refused: the worker fetches nothing',
    remote.status === 400,
    `status ${remote.status}`,
  );
  const broken = await api('POST', '/export', { user: big, raw: '{"blocks": [' });
  check('broken JSON is refused', broken.status === 400, `status ${broken.status}`);
  check(
    'none of the refused requests cost a page',
    (await account(big)).totalPages === pagesBefore,
    `${(await account(big)).totalPages} pages, as before`,
  );

  // === 6. One address hammering the worker ================================================
  section('One address sending too much');
  const flood = await createUser(pool);
  await subscribe(flood);
  const floodAnswers: number[] = [];
  for (let i = 0; i < 26; i++) {
    const answer = await api('POST', '/export', {
      user: flood,
      body: document(1, `Flood ${i}`, false),
      client: 'one-address',
    });
    floodAnswers.push(answer.status);
  }
  const limited = floodAnswers.filter((status) => status === 429).length;
  check(
    '26 exports in a row from one address: the first 20 pass, the rest are told to wait',
    floodAnswers.slice(0, 20).every((status) => status === 200) && limited === 6,
    `${floodAnswers.filter((status) => status === 200).length} passed, ${limited} got 429`,
  );
  check(
    'the ones told to wait were not charged',
    (await account(flood)).monthlyLeft === 150 - 20,
    `${(await account(flood)).monthlyLeft} pages left (expected 130)`,
  );

  // === 7. Still standing ==================================================================
  section('Afterwards');
  check('the worker is still running and healthy', (await healthy()) && workerExit === undefined);
  check(
    'no export is stuck half-done and no balance is negative',
    (await count(`select count(*) as n from public.exports where status = 'reserved'`)) === 0 &&
      (await count(`select count(*) as n from public.credit_balances where total < 0`)) === 0,
  );
  check(
    'no temporary files were left behind',
    readdirSync(exportsDir).every((name) => !name.startsWith('.tmp-')),
    `${readdirSync(exportsDir).filter((name) => name.endsWith('.pdf')).length} PDFs stored`,
  );
  check(
    'the log holds no document text',
    !workerLog.includes('Load 1,') && !workerLog.includes(paragraph.slice(0, 30)),
    `${workerLog.split('\n').filter(Boolean).length} lines logged`,
  );
} finally {
  worker.kill();
  await pool.end();
  for (const dir of [exportsDir, profilesDir, runDir]) {
    rmSync(dir, { recursive: true, force: true });
  }
}

say(`\n**${failures === 0 ? 'All checks passed.' : `${failures} check(s) FAILED.`}**`);
process.exit(failures === 0 ? 0 : 1);
