import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig, WORKER_ENV_KEYS, type Env } from './config';

const root = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const long = (letter: string): string => letter.repeat(40);

/** A complete, valid production environment. */
const production = (): Env => ({
  APP_ENV: 'production',
  EXPORT_STORAGE_DIR: '/data/exports',
  EXPORT_SIGNING_SECRET: long('a'),
  WEB_ORIGIN: 'https://example.com',
  DATABASE_URL: 'postgres://user:pass@db.example.com:5432/postgres',
  SUPABASE_JWT_SECRET: long('b'),
  PADDLE_ENVIRONMENT: 'production',
  PADDLE_WEBHOOK_SECRET: long('c'),
  PROFILE_ENCRYPTION_KEY: long('d'),
  PROFILE_STORAGE_DIR: '/data/profiles',
  FINGERPRINT_SALT: long('e'),
});

const problemsOf = (env: Env): string[] => {
  try {
    loadConfig(env);
  } catch (error) {
    if (error instanceof ConfigError) return error.problems;
    throw error;
  }
  return [];
};

describe('worker settings', () => {
  it('lets a fresh clone start with nothing set, and says what that means', () => {
    const config = loadConfig({});
    expect(config.appEnv).toBe('development');
    expect(config.port).toBe(8787);
    expect(config.webOrigin).toBe('http://localhost:3000');
    expect(config.accounts).toBeUndefined();
    expect(config.signingSecret).toBeUndefined();
    expect(config.warnings.join(' ')).toContain('unmetered');
    expect(config.warnings.join(' ')).toContain('temporary');
  });

  it('accepts a complete production environment', () => {
    const config = loadConfig(production());
    expect(config.appEnv).toBe('production');
    expect(config.accounts?.paddleEnvironment).toBe('production');
    expect(config.accounts?.profileDir).toBe('/data/profiles');
  });

  it('refuses to run deployed without accounts, secrets or real storage', () => {
    const problems = problemsOf({ APP_ENV: 'production' });
    expect(problems).toEqual(
      expect.arrayContaining([
        'EXPORT_SIGNING_SECRET must be set.',
        'EXPORT_STORAGE_DIR must be set.',
        'WEB_ORIGIN must be set.',
        expect.stringContaining('DATABASE_URL must be set'),
      ]),
    );
  });

  it('reports every problem at once', () => {
    const problems = problemsOf({
      ...production(),
      EXPORT_SIGNING_SECRET: 'short',
      PROFILE_ENCRYPTION_KEY: undefined,
      PROFILE_STORAGE_DIR: undefined,
      WEB_ORIGIN: 'http://example.com/app',
    });
    expect(problems).toEqual(
      expect.arrayContaining([
        'EXPORT_SIGNING_SECRET must be at least 32 characters.',
        'PROFILE_ENCRYPTION_KEY must be set.',
        'PROFILE_STORAGE_DIR must be set.',
        'WEB_ORIGIN must be an origin only, such as https://example.com.',
        'WEB_ORIGIN must use https.',
      ]),
    );
  });

  it('keeps real payments out of staging and test payments out of production', () => {
    expect(problemsOf({ ...production(), APP_ENV: 'staging' })).toEqual([
      'PADDLE_ENVIRONMENT must be sandbox when APP_ENV is staging.',
    ]);
    expect(problemsOf({ ...production(), PADDLE_ENVIRONMENT: 'sandbox' })).toEqual([
      'PADDLE_ENVIRONMENT must be production when APP_ENV is production.',
    ]);
    const staging = loadConfig({
      ...production(),
      APP_ENV: 'staging',
      PADDLE_ENVIRONMENT: 'sandbox',
    });
    expect(staging.accounts?.paddleEnvironment).toBe('sandbox');
    // Left unset, payments are in test mode.
    expect(
      loadConfig({ ...production(), APP_ENV: 'staging', PADDLE_ENVIRONMENT: undefined }).accounts
        ?.paddleEnvironment,
    ).toBe('sandbox');
  });

  it('never puts a secret in an error or a warning', () => {
    const env = { ...production(), WEB_ORIGIN: 'not an address', ADMIN_TOKEN: 'tooshort-token' };
    const secrets = [long('a'), long('b'), long('c'), long('d'), long('e'), 'tooshort-token'];
    let message = '';
    try {
      loadConfig(env);
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain('ADMIN_TOKEN must be at least 32 characters.');
    for (const value of secrets) expect(message).not.toContain(value);
    for (const value of secrets) {
      expect(loadConfig(production()).warnings.join(' ')).not.toContain(value);
    }
  });

  it('rejects an unknown environment name', () => {
    expect(problemsOf({ APP_ENV: 'prod' })).toEqual([
      'APP_ENV must be one of development, staging, production.',
    ]);
  });
});

describe('.env.example', () => {
  const example = readFileSync(join(root, '.env.example'), 'utf8');
  const documented = new Set(
    [...example.matchAll(/^([A-Z][A-Z0-9_]*)=/gm)].map((match) => match[1]!),
  );

  /** Every source file of the apps and packages, without tests or build output. */
  const sources = (directory: string): string[] =>
    readdirSync(directory).flatMap((name) => {
      if (name === 'node_modules' || name.startsWith('.')) return [];
      const path = join(directory, name);
      if (statSync(path).isDirectory()) return sources(path);
      return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
    });

  it('documents every setting the worker reads', () => {
    for (const key of WORKER_ENV_KEYS) expect(documented, key).toContain(key);
  });

  it('documents every setting the code reads directly', () => {
    const used = new Set<string>();
    for (const file of [...sources(join(root, 'apps')), ...sources(join(root, 'packages'))]) {
      const text = readFileSync(file, 'utf8');
      for (const match of text.matchAll(/process\.env\.([A-Z][A-Z0-9_]*)/g)) used.add(match[1]!);
    }
    // Set by the platform or the test runner, not by whoever deploys.
    for (const name of ['NODE_ENV', 'CI', 'TEST_DATABASE_URL']) used.delete(name);
    expect(used.size).toBeGreaterThan(0);
    for (const key of used) expect(documented, key).toContain(key);
  });

  it('lists nothing that no longer exists', () => {
    const web = sources(join(root, 'apps/web'))
      .map((file) => readFileSync(file, 'utf8'))
      .join('\n');
    for (const key of documented) {
      const known = (WORKER_ENV_KEYS as readonly string[]).includes(key) || web.includes(key);
      expect(known, `${key} is in .env.example but nothing reads it`).toBe(true);
    }
  });

  it('holds no real values for secrets', () => {
    for (const key of [
      'EXPORT_SIGNING_SECRET',
      'SUPABASE_JWT_SECRET',
      'PADDLE_WEBHOOK_SECRET',
      'PROFILE_ENCRYPTION_KEY',
      'FINGERPRINT_SALT',
      'ADMIN_TOKEN',
      'RESEND_API_KEY',
      'PADDLE_API_KEY',
      'DATABASE_URL',
    ]) {
      expect(example, key).toMatch(new RegExp(`^${key}=$`, 'm'));
    }
  });
});
