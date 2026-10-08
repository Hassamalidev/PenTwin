import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { createExportService } from './export';
import { createWorkerServer, type ServerOptions } from './server';

const glyphDir = fileURLToPath(
  new URL('../../../tests/fixtures/glyphs/sample-user', import.meta.url),
);
const bank = {
  metadata: JSON.parse(readFileSync(join(glyphDir, 'metadata.json'), 'utf8')) as unknown,
  files: Object.fromEntries(
    readdirSync(glyphDir)
      .filter((name) => name.endsWith('.svg'))
      .map((name) => [name, readFileSync(join(glyphDir, name), 'utf8')]),
  ),
};

const storageDir = mkdtempSync(join(tmpdir(), 'pentwin-server-test-'));
afterAll(() => rmSync(storageDir, { recursive: true, force: true }));

/** Starts a server, hands its address to `run`, and closes it afterwards. */
const withServer = async (
  options: Partial<ServerOptions>,
  run: (base: string) => Promise<void>,
): Promise<void> => {
  const service = createExportService({
    storageDir,
    secret: 'test-secret-of-sufficient-length',
    toPdf: () => Promise.reject(new TypeError('The secret diary text broke the renderer')),
  });
  const server = createWorkerServer({ service, ...options });
  const base = await new Promise<string>((resolve) =>
    server.listen(0, () => resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}`)),
  );
  try {
    await run(base);
  } finally {
    server.close();
  }
};

describe('the readiness check', () => {
  it('says ready when nothing it depends on is configured', async () => {
    await withServer({}, async (base) => {
      const response = await fetch(`${base}/health/ready`);
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ ok: true });
    });
  });

  it('answers 503 when the database cannot be reached, while "up" still answers 200', async () => {
    for (const ready of [() => Promise.resolve(false), () => Promise.reject(new Error('down'))]) {
      await withServer({ ready }, async (base) => {
        const response = await fetch(`${base}/health/ready`);
        expect(response.status).toBe(503);
        expect(await response.json()).toEqual({ ok: false });
        expect((await fetch(`${base}/health`)).status).toBe(200);
      });
    }
  });
});

describe('reporting an unexpected error', () => {
  it('passes on the method, the route and the kind of error, and nothing from the request', async () => {
    const problems: unknown[] = [];
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      await withServer({ onError: (problem) => problems.push(problem) }, async (base) => {
        const response = await fetch(`${base}/export`, {
          method: 'POST',
          body: JSON.stringify({
            blocks: [{ type: 'paragraph', text: 'My secret diary.' }],
            bank,
            options: { seed: 1 },
          }),
        });
        // Whatever goes wrong inside, the user is told it was our fault and nothing more.
        expect(response.status).toBe(500);
        expect(problems).toEqual([{ method: 'POST', route: '/export', name: 'TypeError' }]);
        const everything = JSON.stringify([problems, logged.mock.calls, await response.json()]);
        expect(everything).not.toContain('secret diary');
        expect(everything).not.toContain('broke the renderer');
      });
    } finally {
      logged.mockRestore();
    }
  });

  it('is not called for errors the user can fix', async () => {
    const problems: unknown[] = [];
    await withServer({ onError: (problem) => problems.push(problem) }, async (base) => {
      expect((await fetch(`${base}/export`, { method: 'POST', body: '{broken' })).status).toBe(400);
      expect((await fetch(`${base}/nowhere`)).status).toBe(404);
    });
    expect(problems).toEqual([]);
  });
});
