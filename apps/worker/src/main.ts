/**
 * Starts the export worker.
 *
 *   pnpm worker
 *
 * Settings come from the environment; see .env.example.
 */
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createExportService } from './export';
import { createWorkerServer } from './server';

const port = Number(process.env.WORKER_PORT ?? 8787);
const storageDir = process.env.EXPORT_STORAGE_DIR ?? join(tmpdir(), 'pentwin-exports');

let secret = process.env.EXPORT_SIGNING_SECRET;
if (!secret) {
  // Fine for local development: links simply stop working when the worker restarts.
  secret = randomBytes(32).toString('hex');
  console.warn('EXPORT_SIGNING_SECRET is not set; using a temporary one for this run.');
}

const service = createExportService({ storageDir, secret });
const server = createWorkerServer({ service, allowOrigin: process.env.WEB_ORIGIN });
server.listen(port, () => console.log(`export worker listening on http://localhost:${port}`));

// Clear out expired exports now and then every hour.
const sweep = (): void => void service.cleanUp().catch(() => undefined);
sweep();
setInterval(sweep, 60 * 60 * 1000).unref();
