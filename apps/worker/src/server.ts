import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { ExportError, type ExportService } from './export';

export interface ServerOptions {
  service: ExportService;
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

/** The worker's HTTP interface: export a document, download the result, health check. */
export function createWorkerServer({
  service,
  maxBodyBytes = 8 * 1024 * 1024,
  allowOrigin,
}: ServerOptions): Server {
  const json = (response: ServerResponse, status: number, body: unknown): void => {
    response.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
    response.end(JSON.stringify(body));
  };

  return createServer((request, response) => {
    void (async () => {
      const url = new URL(request.url ?? '/', 'http://worker.local');
      if (allowOrigin) {
        response.setHeader('access-control-allow-origin', allowOrigin);
        response.setHeader('access-control-allow-headers', 'content-type');
        response.setHeader('access-control-allow-methods', 'GET, POST, OPTIONS');
      }
      response.setHeader('x-content-type-options', 'nosniff');
      response.setHeader('cache-control', 'no-store');

      try {
        if (request.method === 'OPTIONS') {
          response.writeHead(204).end();
        } else if (request.method === 'GET' && url.pathname === '/health') {
          json(response, 200, { ok: true });
        } else if (request.method === 'POST' && url.pathname === '/export') {
          const body = await readBody(request, maxBodyBytes);
          let input: unknown;
          try {
            input = JSON.parse(body.toString('utf8'));
          } catch {
            throw new ExportError('The request is not valid JSON.', 400);
          }
          json(response, 200, await service.exportDocument(input));
        } else if (request.method === 'GET' && url.pathname.startsWith('/download/')) {
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
        } else {
          json(response, 404, { error: 'Not found.' });
        }
      } catch (error) {
        if (error instanceof ExportError) {
          json(response, error.status, { error: error.message });
        } else {
          // Never echo internals, and never log document content.
          console.error('export failed:', error instanceof Error ? error.name : 'unknown error');
          json(response, 500, {
            error: 'The export failed. Nothing was charged. Please try again.',
          });
        }
      }
    })();
  });
}
