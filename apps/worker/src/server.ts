import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { createAccountsApi, type AccountsConfig } from './api';
import { ExportError, type ExportService } from './export';

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
}: ServerOptions): Server {
  const accountsApi = accounts ? createAccountsApi(accounts, service) : undefined;
  const json = (response: ServerResponse, status: number, body: unknown): void => {
    response.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
    response.end(JSON.stringify(body));
  };

  return createServer((request, response) => {
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

        if (accountsApi) {
          const answer = await accountsApi({
            method: request.method ?? 'GET',
            path: url.pathname,
            headers: request.headers as Record<string, string | undefined>,
            address: request.socket.remoteAddress ?? 'unknown',
            text,
          });
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
          json(response, 200, await service.exportDocument(input));
          return;
        }
        json(response, 404, { error: 'Not found.' });
      } catch (error) {
        if (error instanceof ExportError) {
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
}
