import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { createAccountsApi, type AccountsConfig } from './api';
import { ExportError, type ExportService } from './export';
import { BusyError, createLimiter, type Limiter } from './limiter';

export interface ServerOptions {
  service: ExportService;
  /**
   * Accounts, pages and payments. When given, exporting needs a signed-in user and is
   * metered. When left out the worker exports for anyone, unmetered: local demo only.
   */
  accounts?: AccountsConfig;
  /** Largest request body accepted, in bytes. A glyph bank is a few hundred KB. */
  maxBodyBytes?: number;
  /** Origin allowed to call the worker from a browser (the web app). */
  allowOrigin?: string;
  /**
   * How many exports may render at once and how many may wait. Defaults to one at a
   * time with eight waiting. Rendering uses a single processor core, so a second export
   * at once would finish no sooner, and two 50-page documents together do not fit in a
   * 512 MB worker (measured; see docs/deployment.md).
   */
  limiter?: Limiter;
  /** Longest a client may take to send its request, in milliseconds. */
  requestTimeoutMs?: number;
}

const readBody = (request: IncomingMessage, limit: number): Promise<Buffer> =>
  new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    request.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) {
        reject(new ExportError('The request is too large.', 413));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => resolve(Buffer.concat(chunks)));
    request.on('error', reject);
  });

/** The worker's HTTP interface. */
export function createWorkerServer({
  service,
  accounts,
  maxBodyBytes = 8 * 1024 * 1024,
  allowOrigin,
  limiter = createLimiter(1, 8),
  requestTimeoutMs = 30_000,
}: ServerOptions): Server {
  const accountsApi = accounts ? createAccountsApi(accounts, service) : undefined;
  const json = (response: ServerResponse, status: number, body: unknown): void => {
    response.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
    response.end(JSON.stringify(body));
  };

  const server = createServer((request, response) => {
    void (async () => {
      const url = new URL(request.url ?? '/', 'http://worker.local');
      if (allowOrigin) {
        response.setHeader('access-control-allow-origin', allowOrigin);
        response.setHeader('access-control-allow-headers', 'content-type, authorization');
        response.setHeader('access-control-allow-methods', 'GET, POST, DELETE, OPTIONS');
      }
      response.setHeader('x-content-type-options', 'nosniff');
      response.setHeader('cache-control', 'no-store');

      // The body is read once, on demand, whoever asks for it.
      let body: Promise<Buffer> | undefined;
      const text = async (): Promise<string> => {
        body ??= readBody(request, maxBodyBytes);
        return (await body).toString('utf8');
      };

      try {
        if (request.method === 'OPTIONS') {
          response.writeHead(204).end();
          return;
        }
        if (request.method === 'GET' && url.pathname === '/health') {
          json(response, 200, { ok: true });
          return;
        }
        if (request.method === 'GET' && url.pathname.startsWith('/download/')) {
          // Downloads need no sign-in: the signed, expiring link is the permission.
          const id = url.pathname.slice('/download/'.length);
          const file = await service.download(
            id,
            url.searchParams.get('expires'),
            url.searchParams.get('sig'),
          );
          response.writeHead(200, {
            'content-type': 'application/pdf',
            'content-length': file.length,
            'content-disposition': 'attachment; filename="handwritten.pdf"',
          });
          response.end(file);
          return;
        }

        // Exports are the heavy work: only a few at a time, the rest wait their turn.
        const exporting = request.method === 'POST' && url.pathname === '/export';
        const limited = <T>(task: () => Promise<T>): Promise<T> =>
          exporting ? limiter.run(task) : task();

        if (accountsApi) {
          const api = accountsApi;
          // The body is read before taking a slot, so a slow upload cannot hold one.
          if (exporting) await text();
          const answer = await limited(() =>
            api({
              method: request.method ?? 'GET',
              path: url.pathname,
              headers: request.headers as Record<string, string | undefined>,
              address: request.socket.remoteAddress ?? 'unknown',
              text,
            }),
          );
          if (answer) {
            json(response, answer.status, answer.body);
            return;
          }
        } else if (request.method === 'POST' && url.pathname === '/export') {
          let input: unknown;
          try {
            input = JSON.parse(await text());
          } catch {
            throw new ExportError('The request is not valid JSON.', 400);
          }
          json(response, 200, await limited(() => service.exportDocument(input)));
          return;
        }
        json(response, 404, { error: 'Not found.' });
      } catch (error) {
        if (error instanceof BusyError) {
          response.setHeader('retry-after', '10');
          json(response, 503, {
            error: 'We are busy right now. Nothing was charged. Please try again in a moment.',
          });
        } else if (error instanceof ExportError) {
          json(response, error.status, { error: error.message });
        } else {
          // Never echo internals, and never log document content.
          console.error('request failed:', error instanceof Error ? error.name : 'unknown error');
          json(response, 500, {
            error: 'Something went wrong on our side. Nothing was charged. Please try again.',
          });
        }
      }
    })();
  });

  // A client that stalls while sending is cut off instead of holding a connection open.
  server.requestTimeout = requestTimeoutMs;
  server.headersTimeout = Math.min(requestTimeoutMs, 15_000);
  server.keepAliveTimeout = 5_000;
  return server;
}
