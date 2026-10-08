/**
 * Proves a database backup can be restored and still works (Phase 7.4).
 *
 *   pnpm db:up && pnpm db:restore-check
 *
 * Fills the throwaway test database with accounts, payments, exports, a profile and
 * consents; takes a backup with pg_dump; restores it into a second, empty database; then
 * checks that every row came back, that the security rules are still switched on, and
 * that the restored database can still be used. It only ever touches the test container.
 *
 * This checks the method (pg_dump and pg_restore of this schema). It is not a test of
 * the hosted database's own backups, which do not exist yet.
 */
import { execFileSync } from 'node:child_process';
import { createTestPool, createUser, resetDatabase } from '../packages/billing/src/testing';

type Pool = ReturnType<typeof createTestPool>;

const CONTAINER = 'pentwin-test-db';
const RESTORED = 'pentwin_restore_check';
const TABLES = [
  'auth.users',
  'public.plans',
  'public.accounts',
  'public.credit_ledger',
  'public.exports',
  'public.handwriting_profiles',
  'public.referral_redemptions',
  'public.webhook_events',
  'public.email_outbox',
  'public.consents',
  'public.account_deletions',
];

const docker = (...args: string[]): string =>
  execFileSync('docker', ['exec', CONTAINER, ...args], { encoding: 'utf8' });

let failures = 0;
const check = (label: string, passed: boolean, detail = ''): void => {
  if (!passed) failures++;
  console.log(`| ${passed ? 'pass' : '**FAIL**'} | ${label} | ${detail} |`);
};

/** Row counts and a fingerprint of the money: what a restore must reproduce exactly. */
const snapshot = async (db: Pool): Promise<Record<string, string>> => {
  const result: Record<string, string> = {};
  for (const table of TABLES) {
    result[table] = String((await db.query(`select count(*) as n from ${table}`)).rows[0].n);
  }
  result['ledger fingerprint'] = (
    await db.query(
      `select md5(string_agg(user_id || ':' || amount || ':' || bucket || ':' || kind || ':' || reason, '|' order by id)) as h
         from public.credit_ledger`,
    )
  ).rows[0].h;
  result['balances fingerprint'] = (
    await db.query(
      `select md5(string_agg(user_id || ':' || monthly || ':' || extra, '|' order by user_id)) as h
         from public.credit_balances`,
    )
  ).rows[0].h;
  return result;
};

// --- 1. A database with something in it --------------------------------------------------
await resetDatabase();
const source = createTestPool();
const users: string[] = [];
for (let i = 0; i < 12; i++) users.push(await createUser(source));
for (const [index, user] of users.entries()) {
  if (index % 3 === 0) {
    await source.query(
      `select public.apply_subscription($1, 'student', 'month', 'active', now() + interval '30 days', false, $2, $3)`,
      [user, `ctm_${user}`, `sub_${user}`],
    );
  }
  const reserved = await source.query(`select * from public.reserve_export($1, $2, $3)`, [
    user,
    1 + (index % 3),
    `hash-${index}`,
  ]);
  await source.query(`select public.complete_export($1, 400, 20000)`, [reserved.rows[0].id]);
  await source.query(`select public.record_consent($1, 'terms', '2026-10-08', true, null)`, [user]);
}
await source.query(`select public.create_profile($1, 'Mine', $2, 1000, null, true)`, [
  users[0],
  `key-${users[0]}`,
]);
await source.query(`select public.grant_top_up($1, 100, 'evt_backup_check')`, [users[1]]);
await source.query(
  `select public.redeem_referral($1, (select referral_code from public.accounts where user_id = $2))`,
  [users[2], users[3]],
);
await source.query(`select * from public.delete_account($1)`, [users[11]]);
const before = await snapshot(source);

console.log(`# Backup and restore check\n`);
console.log(
  `Run ${new Date().toISOString().slice(0, 10)} against the test container (${CONTAINER}).\n`,
);
console.log('| Result | Check | Measured |');
console.log('| --- | --- | --- |');
check(
  'the database holds real data before the backup',
  Number(before['public.credit_ledger']) > 20 && Number(before['public.exports']) === 11,
  `${before['public.accounts']} accounts, ${before['public.credit_ledger']} ledger rows, ${before['public.exports']} exports`,
);

// --- 2. Back up, then restore into an empty database -------------------------------------
const started = performance.now();
docker('pg_dump', '-U', 'postgres', '-d', 'pentwin_test', '-Fc', '-f', '/tmp/backup.dump');
const size = Number(docker('stat', '-c', '%s', '/tmp/backup.dump').trim());
docker('psql', '-U', 'postgres', '-d', 'postgres', '-c', `drop database if exists ${RESTORED}`);
docker('psql', '-U', 'postgres', '-d', 'postgres', '-c', `create database ${RESTORED}`);
try {
  docker('pg_restore', '-U', 'postgres', '-d', RESTORED, '--exit-on-error', '/tmp/backup.dump');
} catch (error) {
  const output = String((error as { stderr?: string }).stderr ?? error);
  check('pg_restore finished without an error', false, output.slice(0, 200));
}
const elapsed = performance.now() - started;
check(
  'backup taken and restored',
  size > 0,
  `${(size / 1024).toFixed(0)} KB backup, ${(elapsed / 1000).toFixed(1)} s for both`,
);

// --- 3. Is the restored database the same, and does it still work? -----------------------
const restored = createTestPool(RESTORED);
try {
  const after = await snapshot(restored);
  const different = Object.keys(before).filter((key) => before[key] !== after[key]);
  check(
    'every table has the same number of rows, and the ledger and balances are identical',
    different.length === 0,
    different.length === 0
      ? `${TABLES.length} tables and 2 fingerprints match`
      : `different: ${different.join(', ')}`,
  );

  const unprotected = await restored.query(
    `select relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity`,
  );
  check(
    'row-level security is still switched on for every table',
    unprotected.rowCount === 0,
    unprotected.rows.map((row: { relname: string }) => row.relname).join(', '),
  );
  const policies = Number(
    (await restored.query(`select count(*) as n from pg_policies where schemaname = 'public'`))
      .rows[0].n,
  );
  const policiesBefore = Number(
    (await source.query(`select count(*) as n from pg_policies where schemaname = 'public'`))
      .rows[0].n,
  );
  check(
    'the security policies came back',
    policies === policiesBefore,
    `${policies} of ${policiesBefore}`,
  );

  const appendOnly = await restored.query(`delete from public.credit_ledger`).then(
    () => 'deleted',
    (error: Error) => error.message,
  );
  check('the ledger is still append-only', appendOnly.includes('append-only'), appendOnly);

  // A user can only see their own rows in the restored database.
  const client = await restored.connect();
  try {
    await client.query('begin');
    await client.query('set local role authenticated');
    await client.query(`select set_config('request.jwt.claim.sub', $1, true)`, [users[0]]);
    const visible = await client.query(`select user_id from public.accounts`);
    check(
      'a signed-in user still sees only their own account',
      visible.rowCount === 1 && visible.rows[0].user_id === users[0],
      `${visible.rowCount} row visible`,
    );
    await client.query('rollback');
  } finally {
    client.release();
  }

  // The restored database can be used: an export is charged, exactly once.
  const balance = async (): Promise<number> =>
    (
      await restored.query(`select total from public.credit_balances where user_id = $1`, [
        users[0],
      ])
    ).rows[0].total;
  const pagesBefore = await balance();
  const reserved = await restored.query(
    `select * from public.reserve_export($1, 2, 'after-restore')`,
    [users[0]],
  );
  await restored.query(`select public.complete_export($1, 300, 15000)`, [reserved.rows[0].id]);
  check(
    'the restored database works: a new export is charged correctly',
    (await balance()) === pagesBefore - 2,
    `${pagesBefore} pages before, ${await balance()} after a 2-page export`,
  );
  const replay = await restored.query(
    `select public.grant_top_up($1, 100, 'evt_backup_check') as granted`,
    [users[1]],
  );
  check(
    'a payment already handled before the backup is still recognised as a repeat',
    replay.rows[0].granted === false,
    `granted again: ${replay.rows[0].granted}`,
  );
} finally {
  await restored.end();
  await source.end();
  docker('psql', '-U', 'postgres', '-d', 'postgres', '-c', `drop database if exists ${RESTORED}`);
  docker('rm', '-f', '/tmp/backup.dump');
}

console.log(`\n**${failures === 0 ? 'All checks passed.' : `${failures} check(s) FAILED.`}**`);
process.exit(failures === 0 ? 0 : 1);
