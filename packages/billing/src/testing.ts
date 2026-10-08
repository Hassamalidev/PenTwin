import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { applyMigrations } from './migrate';

/**
 * Test support for anything that needs the database. Uses the throwaway Postgres from
 * docker-compose.test.yml (`pnpm db:up`), or TEST_DATABASE_URL if set (CI).
 */
export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgres://postgres:postgres@localhost:54329/pentwin_test';

const repoPath = (relative: string): string =>
  fileURLToPath(new URL(`../../../${relative}`, import.meta.url));

/** Wipes the database and rebuilds it from the migrations. */
export async function resetDatabase(): Promise<void> {
  const client = new pg.Client({ connectionString: TEST_DATABASE_URL });
  try {
    await client.connect();
  } catch (error) {
    throw new Error(
      `Cannot reach the test database at ${TEST_DATABASE_URL}. Start it with "pnpm db:up". ` +
        `(${(error as Error).message})`,
      { cause: error },
    );
  }
  try {
    await client.query('drop schema if exists public cascade; drop schema if exists auth cascade;');
    await client.query('create schema public;');
    await client.query(readFileSync(repoPath('tests/db/supabase-shim.sql'), 'utf8'));
    await applyMigrations(client, repoPath('supabase/migrations'));
  } finally {
    await client.end();
  }
}

/** A pool on the test database, or on another database of the same test server. */
export const createTestPool = (database?: string): pg.Pool =>
  new pg.Pool({
    connectionString: database
      ? TEST_DATABASE_URL.replace(/\/[^/]+$/, `/${database}`)
      : TEST_DATABASE_URL,
    max: 12,
  });

let counter = 0;

/** Signs a user up the way Supabase Auth would: a row in auth.users. */
export async function createUser(
  pool: pg.Pool,
  options: { verified?: boolean; activate?: boolean } = {},
): Promise<string> {
  const { verified = true, activate = true } = options;
  const tag = `${Date.now()}-${counter++}`;
  const { rows } = await pool.query<{ id: string }>(
    `insert into auth.users (email, email_confirmed_at) values ($1, $2) returning id`,
    [`user-${tag}@example.test`, verified ? new Date() : null],
  );
  const id = rows[0]!.id;
  // A distinct address and device per user unless a test says otherwise.
  if (verified && activate) {
    await pool.query(`select public.activate_account($1, $2, $3)`, [id, `ip-${tag}`, `dev-${tag}`]);
  }
  return id;
}

/** Runs queries as a signed-in user would through the public API: under row-level security. */
export async function asUser<T>(
  pool: pg.Pool,
  userId: string | null,
  run: (query: (sql: string, params?: unknown[]) => Promise<pg.QueryResult>) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('begin');
    await client.query(`set local role ${userId ? 'authenticated' : 'anon'}`);
    await client.query(`select set_config('request.jwt.claim.sub', $1, true)`, [userId ?? '']);
    return await run((sql, params) => client.query(sql, params));
  } finally {
    await client.query('rollback').catch(() => undefined);
    client.release();
  }
}

export const balanceOf = async (
  pool: pg.Pool,
  userId: string,
): Promise<{ monthly: number; extra: number; total: number }> => {
  const { rows } = await pool.query(
    `select monthly, extra, total from public.credit_balances where user_id = $1`,
    [userId],
  );
  return rows[0];
};
