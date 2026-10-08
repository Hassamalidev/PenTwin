import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** Where the worker is running. Staging and production refuse to start with unsafe settings. */
export type AppEnv = 'development' | 'staging' | 'production';
export type PaddleEnvironment = 'sandbox' | 'production';

/**
 * Every setting the worker reads from the environment. `.env.example` documents each
 * one, and a test keeps the two lists the same.
 */
export const WORKER_ENV_KEYS = [
  'APP_ENV',
  'WORKER_PORT',
  'EXPORT_STORAGE_DIR',
  'EXPORT_SIGNING_SECRET',
  'WEB_ORIGIN',
  'CLIENT_IP_HEADER',
  'DATABASE_URL',
  'SUPABASE_JWT_SECRET',
  'PADDLE_ENVIRONMENT',
  'PADDLE_WEBHOOK_SECRET',
  'PADDLE_PRICE_STUDENT_MONTH',
  'PADDLE_PRICE_STUDENT_YEAR',
  'PADDLE_PRICE_PRO_MONTH',
  'PADDLE_PRICE_PRO_YEAR',
  'PADDLE_PRICE_TOP_UP',
  'PROFILE_ENCRYPTION_KEY',
  'PROFILE_STORAGE_DIR',
  'FINGERPRINT_SALT',
  'ADMIN_TOKEN',
  'RESEND_API_KEY',
  'EMAIL_FROM',
] as const;

export type Env = Record<string, string | undefined>;

export interface WorkerConfig {
  appEnv: AppEnv;
  port: number;
  storageDir: string;
  /** Undefined only in development, where a temporary secret is made up at start. */
  signingSecret?: string;
  webOrigin: string;
  /** The header the host's proxy puts the visitor's address in, if any. Lower case. */
  clientIpHeader?: string;
  /** Present when the worker runs with accounts, pages and payments. */
  accounts?: {
    databaseUrl: string;
    jwtSecret: string;
    paddleEnvironment: PaddleEnvironment;
    paddleWebhookSecret: string;
    profileKey: string;
    profileDir: string;
    fingerprintSalt: string;
    adminToken?: string;
    resendApiKey?: string;
    emailFrom?: string;
  };
  /** Things worth saying in the log at start. Never contains a secret. */
  warnings: string[];
}

/** The settings are wrong. `problems` lists every one of them, not just the first. */
export class ConfigError extends Error {
  constructor(readonly problems: string[]) {
    super(`The worker cannot start:\n${problems.map((p) => `  - ${p}`).join('\n')}`);
    this.name = 'ConfigError';
  }
}

const APP_ENVS: AppEnv[] = ['development', 'staging', 'production'];
const MIN_SECRET = 32;

/**
 * Reads and checks the worker's settings. Development is forgiving so a fresh clone
 * runs; staging and production must have every secret, real storage and a matching
 * payment environment, or the worker does not start.
 */
export function loadConfig(env: Env): WorkerConfig {
  const problems: string[] = [];
  const warnings: string[] = [];
  const get = (name: (typeof WORKER_ENV_KEYS)[number]): string | undefined =>
    env[name]?.trim() || undefined;

  const appEnv = (get('APP_ENV') ?? 'development') as AppEnv;
  if (!APP_ENVS.includes(appEnv)) {
    throw new ConfigError([`APP_ENV must be one of ${APP_ENVS.join(', ')}.`]);
  }
  const deployed = appEnv !== 'development';

  const port = Number(get('WORKER_PORT') ?? 8787);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    problems.push('WORKER_PORT must be a port number.');
  }

  /** A secret: long enough everywhere it is set, and required once deployed. */
  const secret = (
    name: (typeof WORKER_ENV_KEYS)[number],
    needed: boolean,
    minimum = MIN_SECRET,
  ): string | undefined => {
    const value = get(name);
    if (!value) {
      if (needed) problems.push(`${name} must be set.`);
      return undefined;
    }
    if (value.length < minimum) {
      problems.push(`${name} must be at least ${minimum} characters.`);
    }
    return value;
  };

  // The export service itself accepts 16 characters; deployed, ask for a proper key.
  const signingSecret = secret('EXPORT_SIGNING_SECRET', deployed, deployed ? MIN_SECRET : 16);
  if (!signingSecret && !deployed) {
    warnings.push('EXPORT_SIGNING_SECRET is not set; using a temporary one for this run.');
  }

  const storage = get('EXPORT_STORAGE_DIR');
  if (!storage && deployed) problems.push('EXPORT_STORAGE_DIR must be set.');

  const webOrigin = get('WEB_ORIGIN') ?? 'http://localhost:3000';
  if (deployed && !get('WEB_ORIGIN')) problems.push('WEB_ORIGIN must be set.');
  try {
    const url = new URL(webOrigin);
    if (url.origin !== webOrigin) {
      problems.push('WEB_ORIGIN must be an origin only, such as https://example.com.');
    }
    if (deployed && get('WEB_ORIGIN') && url.protocol !== 'https:') {
      problems.push('WEB_ORIGIN must use https.');
    }
  } catch {
    problems.push('WEB_ORIGIN is not a valid address.');
  }

  const clientIpHeader = get('CLIENT_IP_HEADER')?.toLowerCase();
  if (clientIpHeader && !/^[a-z0-9-]+$/.test(clientIpHeader)) {
    problems.push('CLIENT_IP_HEADER must be a header name, such as fly-client-ip.');
  }
  if (deployed && !clientIpHeader) {
    warnings.push(
      'CLIENT_IP_HEADER is not set; behind a proxy every visitor will share one rate limit.',
    );
  }

  let accounts: WorkerConfig['accounts'];
  const databaseUrl = get('DATABASE_URL');
  if (databaseUrl) {
    const paddleEnvironment = (get('PADDLE_ENVIRONMENT') ?? 'sandbox') as PaddleEnvironment;
    if (paddleEnvironment !== 'sandbox' && paddleEnvironment !== 'production') {
      problems.push('PADDLE_ENVIRONMENT must be sandbox or production.');
    } else if (appEnv === 'production' && paddleEnvironment !== 'production') {
      problems.push('PADDLE_ENVIRONMENT must be production when APP_ENV is production.');
    } else if (appEnv !== 'production' && paddleEnvironment === 'production') {
      // Staging and development must never take real money.
      problems.push(`PADDLE_ENVIRONMENT must be sandbox when APP_ENV is ${appEnv}.`);
    }

    const profileDir = get('PROFILE_STORAGE_DIR');
    if (!profileDir && deployed) problems.push('PROFILE_STORAGE_DIR must be set.');
    const resendApiKey = get('RESEND_API_KEY');
    const emailFrom = get('EMAIL_FROM');
    if (!resendApiKey || !emailFrom) {
      warnings.push('RESEND_API_KEY or EMAIL_FROM is not set; emails will wait unsent.');
    }
    const adminToken = secret('ADMIN_TOKEN', false);

    accounts = {
      databaseUrl,
      // Supabase and Paddle issue these, so only their presence is checked.
      jwtSecret: secret('SUPABASE_JWT_SECRET', true, 1) ?? '',
      paddleEnvironment,
      paddleWebhookSecret: secret('PADDLE_WEBHOOK_SECRET', true, 1) ?? '',
      profileKey: secret('PROFILE_ENCRYPTION_KEY', true) ?? '',
      profileDir: profileDir ?? join(tmpdir(), 'pentwin-profiles'),
      fingerprintSalt: secret('FINGERPRINT_SALT', true, 16) ?? '',
      adminToken,
      resendApiKey,
      emailFrom,
    };
  } else if (deployed) {
    problems.push('DATABASE_URL must be set: without it anyone can export without limit.');
  } else {
    warnings.push(
      'DATABASE_URL is not set; exporting is open to anyone and unmetered (local demo).',
    );
  }

  if (problems.length > 0) throw new ConfigError(problems);
  return {
    appEnv,
    port,
    storageDir: storage ?? join(tmpdir(), 'pentwin-exports'),
    signingSecret,
    webOrigin,
    clientIpHeader,
    accounts,
    warnings,
  };
}
