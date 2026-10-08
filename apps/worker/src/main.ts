/**
 * Starts the export worker.
 *
 *   pnpm worker
 *
 * Settings come from the environment; see .env.example. With DATABASE_URL set, the
 * worker runs with accounts: sign-in, pages, payments. Without it, it exports for
 * anyone, unmetered, which is only meant for trying things out locally.
 */
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  costReport,
  createResendSender,
  pricesFromEnv,
  sendPendingEmails,
  type EmailSender,
} from '@pentwin/billing';
import pg from 'pg';
import type { AccountsConfig } from './api';
import { createExportService } from './export';
import { createProfileStore } from './profiles';
import { createWorkerServer } from './server';

const env = process.env;
const port = Number(env.WORKER_PORT ?? 8787);
const storageDir = env.EXPORT_STORAGE_DIR ?? join(tmpdir(), 'pentwin-exports');

let secret = env.EXPORT_SIGNING_SECRET;
if (!secret) {
  // Fine for local development: links simply stop working when the worker restarts.
  secret = randomBytes(32).toString('hex');
  console.warn('EXPORT_SIGNING_SECRET is not set; using a temporary one for this run.');
}

/** Reads a setting that accounts cannot work without. */
const required = (name: string): string => {
  const value = env[name];
  if (!value) throw new Error(`${name} must be set when DATABASE_URL is set. See .env.example.`);
  return value;
};

let accounts: AccountsConfig | undefined;
if (env.DATABASE_URL) {
  const pool = new pg.Pool({ connectionString: env.DATABASE_URL, max: 10 });
  accounts = {
    pool,
    jwtSecret: required('SUPABASE_JWT_SECRET'),
    paddle: { webhookSecret: required('PADDLE_WEBHOOK_SECRET'), prices: pricesFromEnv(env) },
    profiles: createProfileStore(pool, {
      directory: env.PROFILE_STORAGE_DIR ?? join(tmpdir(), 'pentwin-profiles'),
      key: required('PROFILE_ENCRYPTION_KEY'),
    }),
    hashSalt: required('FINGERPRINT_SALT'),
    adminToken: env.ADMIN_TOKEN,
  };

  // Emails wait in the database and are sent from here, a few at a time.
  const send: EmailSender | undefined =
    env.RESEND_API_KEY && env.EMAIL_FROM
      ? createResendSender(env.RESEND_API_KEY, env.EMAIL_FROM)
      : undefined;
  if (!send) console.warn('RESEND_API_KEY or EMAIL_FROM is not set; emails will wait unsent.');
  setInterval(() => {
    if (send)
      void sendPendingEmails(pool, send).catch(() => console.error('sending emails failed'));
  }, 30_000).unref();

  // Say so in the log when a page costs more to produce than it should.
  setInterval(
    () =>
      void costReport(pool)
        .then((report) => report.alerts.forEach((alert) => console.warn(`COST ALERT: ${alert}`)))
        .catch(() => undefined),
    60 * 60 * 1000,
  ).unref();
} else {
  console.warn('DATABASE_URL is not set; exporting is open to anyone and unmetered (local demo).');
}

const service = createExportService({ storageDir, secret });
// The web app runs on port 3000 in local development.
const allowOrigin = env.WEB_ORIGIN ?? 'http://localhost:3000';
const server = createWorkerServer({ service, accounts, allowOrigin });
server.listen(port, () => console.log(`export worker listening on http://localhost:${port}`));

// Clear out expired exports now and then every hour.
const sweep = (): void => void service.cleanUp().catch(() => undefined);
sweep();
setInterval(sweep, 60 * 60 * 1000).unref();
