/**
 * Starts the export worker.
 *
 *   pnpm worker
 *
 * Settings come from the environment, or from a `.env` file in the folder the worker is
 * started from; see .env.example and docs/environments.md. With DATABASE_URL set, the
 * worker runs with accounts: sign-in, pages, payments. Without it, it exports for
 * anyone, unmetered, which is only allowed in development.
 */
import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import {
  costReport,
  createResendSender,
  pricesFromEnv,
  sendPendingEmails,
  type EmailSender,
} from '@pentwin/billing';
import pg from 'pg';
import type { AccountsConfig } from './api';
import { ConfigError, loadConfig, type WorkerConfig } from './config';
import { createExportService } from './export';
import { createProfileStore } from './profiles';
import { createWorkerServer } from './server';

// Values already in the environment win over the file.
if (existsSync('.env')) process.loadEnvFile('.env');

let config: WorkerConfig;
try {
  config = loadConfig(process.env);
} catch (error) {
  if (!(error instanceof ConfigError)) throw error;
  console.error(error.message);
  process.exit(1);
}
config.warnings.forEach((warning) => console.warn(warning));

// Fine for local development: links simply stop working when the worker restarts.
const secret = config.signingSecret ?? randomBytes(32).toString('hex');

let accounts: AccountsConfig | undefined;
if (config.accounts) {
  const settings = config.accounts;
  const pool = new pg.Pool({ connectionString: settings.databaseUrl, max: 10 });
  accounts = {
    pool,
    jwtSecret: settings.jwtSecret,
    paddle: { webhookSecret: settings.paddleWebhookSecret, prices: pricesFromEnv(process.env) },
    profiles: createProfileStore(pool, {
      directory: settings.profileDir,
      key: settings.profileKey,
    }),
    hashSalt: settings.fingerprintSalt,
    adminToken: settings.adminToken,
  };

  // Emails wait in the database and are sent from here, a few at a time.
  const send: EmailSender | undefined =
    settings.resendApiKey && settings.emailFrom
      ? createResendSender(settings.resendApiKey, settings.emailFrom)
      : undefined;
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
}

const service = createExportService({ storageDir: config.storageDir, secret });
const server = createWorkerServer({ service, accounts, allowOrigin: config.webOrigin });
server.listen(config.port, () =>
  console.log(`export worker (${config.appEnv}) listening on http://localhost:${config.port}`),
);

// Clear out expired exports now and then every hour.
const sweep = (): void => void service.cleanUp().catch(() => undefined);
sweep();
setInterval(sweep, 60 * 60 * 1000).unref();
