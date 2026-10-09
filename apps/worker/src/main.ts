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
import { createAlerter } from './alerts';
import type { AccountsConfig } from './api';
import { ConfigError, loadConfig, type WorkerConfig } from './config';
import { createExportService } from './export';
import { createLimiter } from './limiter';
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

const alerter = createAlerter({
  url: config.alertWebhookUrl,
  source: `worker ${config.appEnv}`,
});

// Fine for local development: links simply stop working when the worker restarts.
const secret = config.signingSecret ?? randomBytes(32).toString('hex');

let accounts: AccountsConfig | undefined;
let pool: pg.Pool | undefined;
if (config.accounts) {
  const settings = config.accounts;
  const database = new pg.Pool({ connectionString: settings.databaseUrl, max: 10 });
  pool = database;
  accounts = {
    pool: database,
    jwtSecret: settings.jwtSecret,
    paddle: { webhookSecret: settings.paddleWebhookSecret, prices: pricesFromEnv(process.env) },
    profiles: createProfileStore(database, {
      directory: settings.profileDir,
      key: settings.profileKey,
    }),
    hashSalt: settings.fingerprintSalt,
    adminToken: settings.adminToken,
    paddleEnvironment: settings.paddleEnvironment,
    paddleApi: settings.paddleApiKey
      ? { apiKey: settings.paddleApiKey, environment: settings.paddleEnvironment }
      : undefined,
  };

  // Emails wait in the database and are sent from here, a few at a time.
  const send: EmailSender | undefined =
    settings.resendApiKey && settings.emailFrom
      ? createResendSender(settings.resendApiKey, settings.emailFrom)
      : undefined;
  setInterval(() => {
    if (send)
      void sendPendingEmails(database, send).catch(() => console.error('sending emails failed'));
  }, 30_000).unref();

  // Say so in the log when a page costs more to produce than it should.
  setInterval(
    () =>
      void costReport(database)
        .then((report) => report.alerts.forEach((alert) => void alerter.send(`Cost: ${alert}`)))
        .catch(() => undefined),
    60 * 60 * 1000,
  ).unref();
}

const service = createExportService({ storageDir: config.storageDir, secret });
// One export at a time, eight waiting; docs/deployment.md has the measurements behind this.
const limiter = createLimiter(1, 8);
const server = createWorkerServer({
  service,
  accounts,
  allowOrigin: config.webOrigin,
  clientIpHeader: config.clientIpHeader,
  onError: ({ method, route, name }) =>
    void alerter.send(`Unexpected error ${name} on ${method} ${route}`),
  ready: async () => {
    if (pool) await pool.query('select 1');
    return true;
  },
  limiter,
});
server.listen(config.port, () =>
  console.log(`export worker (${config.appEnv}) listening on http://localhost:${config.port}`),
);

// Clear out expired exports and orphaned handwriting files now, and then every hour.
const sweep = (): void => {
  void service.cleanUp().catch(() => undefined);
  // Handwriting files that no profile points to any more.
  void accounts?.profiles.sweepOrphans().catch(() => undefined);
};
sweep();
setInterval(sweep, 60 * 60 * 1000).unref();

// Hosts stop a worker by sending SIGTERM, then kill it some seconds later. Stop taking
// requests, let the exports already running finish, then leave.
let stopping = false;
const shutDown = (signal: string): void => {
  if (stopping) return;
  stopping = true;
  console.log(`${signal} received; finishing ${limiter.load.running} export(s) and stopping`);
  server.close();
  server.closeIdleConnections();
  const giveUp = new Promise<void>((resolve) => setTimeout(resolve, 25_000).unref());
  void Promise.race([limiter.idle(), giveUp])
    .then(() => pool?.end())
    .catch(() => undefined)
    .finally(() => process.exit(0));
};
process.on('SIGTERM', () => shutDown('SIGTERM'));
process.on('SIGINT', () => shutDown('SIGINT'));

// Something nobody caught. The process may be in an unknown state, so say so and stop;
// the host starts a fresh one.
const crash = (kind: string, error: unknown): void => {
  const name = error instanceof Error ? error.name : 'unknown error';
  console.error(`${kind}:`, name);
  void alerter.send(`Worker stopped after an ${kind} (${name})`).finally(() => process.exit(1));
  setTimeout(() => process.exit(1), 6000).unref();
};
process.on('uncaughtException', (error) => crash('uncaught exception', error));
process.on('unhandledRejection', (error) => crash('unhandled rejection', error));
