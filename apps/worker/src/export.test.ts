import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scenesToPdf, type PageScene } from '@pentwin/engine';
import { PDFDocument } from 'pdf-lib';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { createExportService, ExportError, type ExportServiceOptions } from './export';
import { createLimiter } from './limiter';
import { createRateLimiter } from './rate-limit';
import type { ExportRequest } from './schema';
import { createWorkerServer } from './server';

const glyphDir = fileURLToPath(
  new URL('../../../tests/fixtures/glyphs/sample-user', import.meta.url),
);
const bank: ExportRequest['bank'] = {
  metadata: JSON.parse(readFileSync(join(glyphDir, 'metadata.json'), 'utf8')),
  files: Object.fromEntries(
    readdirSync(glyphDir)
      .filter((name) => name.endsWith('.svg'))
      .map((name) => [name, readFileSync(join(glyphDir, name), 'utf8')]),
  ),
};
const request = (overrides: Partial<ExportRequest['options']> = {}): ExportRequest => ({
  blocks: [
    { type: 'heading', text: 'Lab report' },
    { type: 'paragraph', text: 'The liquid was heated slowly and then left to cool.' },
  ],
  bank,
  options: { seed: 'export-test', ...overrides },
});

const SECRET = 'test-secret-of-sufficient-length';
const dirs: string[] = [];
afterAll(() => dirs.forEach((dir) => rmSync(dir, { recursive: true, force: true })));

/** A service on its own empty directory, with a clock the test controls. */
const setup = (overrides: Partial<ExportServiceOptions> = {}) => {
  const storageDir = mkdtempSync(join(tmpdir(), 'pentwin-test-'));
  dirs.push(storageDir);
  const clock = { now: 1_800_000_000_000 };
  const toPdf = vi.fn((scenes: readonly PageScene[]) => scenesToPdf(scenes));
  const service = createExportService({
    storageDir,
    secret: SECRET,
    now: () => clock.now,
    toPdf,
    ...overrides,
  });
  return { service, storageDir, clock, toPdf, files: () => readdirSync(storageDir).sort() };
};
const query = (path: string): { id: string; expires: string; sig: string } => {
  const url = new URL(path, 'http://x');
  return {
    id: url.pathname.split('/').pop()!,
    expires: url.searchParams.get('expires')!,
    sig: url.searchParams.get('sig')!,
  };
};

describe('export service', { timeout: 60_000 }, () => {
  it('renders a PDF and hands back a working signed link', async () => {
    const { service } = setup();
    const result = await service.exportDocument(request());
    expect(result).toMatchObject({
      pageCount: 1,
      cached: false,
      billablePages: 1,
      unknownChars: {},
    });
    expect(result.id).toMatch(/^[0-9a-f]{40}$/);

    const { id, expires, sig } = query(result.downloadPath);
    const pdf = await PDFDocument.load(await service.download(id, expires, sig));
    expect(pdf.getPageCount()).toBe(1);
  });

  it('serves a repeated export from the cache, for free', async () => {
    const { service, toPdf, files } = setup();
    const first = await service.exportDocument(request());
    const second = await service.exportDocument(request());
    expect(toPdf).toHaveBeenCalledTimes(1);
    expect(second).toMatchObject({ id: first.id, cached: true, billablePages: 0, pageCount: 1 });
    expect(files()).toEqual([`${first.id}.json`, `${first.id}.pdf`]);
    // Key order in the request makes no difference.
    const reordered = JSON.parse(JSON.stringify(request())) as ExportRequest;
    const shuffled = { options: reordered.options, bank: reordered.bank, blocks: reordered.blocks };
    expect((await service.exportDocument(shuffled)).cached).toBe(true);
    expect(toPdf).toHaveBeenCalledTimes(1);
  });

  it('renders again when the text, a setting or the seed changes', async () => {
    const { service, toPdf } = setup();
    const ids = new Set<string>();
    for (const variant of [
      request(),
      request({ seed: 'another-seed' }),
      request({ ink: 'gel' }),
      { ...request(), blocks: [{ type: 'paragraph' as const, text: 'Different text.' }] },
    ]) {
      const result = await service.exportDocument(variant);
      expect(result.cached).toBe(false);
      ids.add(result.id);
    }
    expect(ids.size).toBe(4);
    expect(toPdf).toHaveBeenCalledTimes(4);
  });

  it('stops reusing an export after 24 hours', async () => {
    const { service, toPdf, clock } = setup();
    await service.exportDocument(request());
    clock.now += 23 * 60 * 60 * 1000;
    expect((await service.exportDocument(request())).cached).toBe(true);
    clock.now += 2 * 60 * 60 * 1000;
    const later = await service.exportDocument(request());
    expect(later).toMatchObject({ cached: false, billablePages: 1 });
    expect(toPdf).toHaveBeenCalledTimes(2);
  });

  it('does the work once when the same request arrives twice at the same moment', async () => {
    const { service, toPdf } = setup();
    const [a, b] = await Promise.all([
      service.exportDocument(request()),
      service.exportDocument(request()),
    ]);
    expect(toPdf).toHaveBeenCalledTimes(1);
    // Exactly one of the two is charged.
    expect([a.billablePages, b.billablePages].sort()).toEqual([0, 1]);
  });

  it('leaves nothing behind when an export fails', async () => {
    const failing = setup({
      toPdf: async () => {
        throw new Error('renderer crashed');
      },
    });
    await expect(failing.service.exportDocument(request())).rejects.toThrow('renderer crashed');
    expect(failing.files()).toEqual([]);

    // And the next attempt is a normal, fresh export: nothing half-finished was cached.
    const { service } = setup({ storageDir: failing.storageDir });
    const result = await service.exportDocument(request());
    expect(result.cached).toBe(false);
    expect(failing.files()).toHaveLength(2);
  });

  it('rejects invalid requests with a clear reason and no side effects', async () => {
    const { service, files, toPdf } = setup();
    const cases: [unknown, RegExp][] = [
      [{}, /not valid/],
      [{ ...request(), blocks: [] }, /blocks/],
      [{ ...request(), blocks: [{ type: 'script', text: 'x' }] }, /blocks/],
      [{ ...request(), options: { seed: 1, unknownOption: true } }, /options/],
      [{ ...request(), options: { seed: 1, lineHeight: 9999 } }, /lineHeight/],
      [
        {
          ...request(),
          blocks: [{ type: 'image', href: 'https://example.com/a.png', width: 10, height: 10 }],
        },
        /href/,
      ],
      [{ ...request(), bank: { metadata: { version: 2 }, files: {} } }, /bank/],
    ];
    for (const [input, reason] of cases) {
      const error = await service.exportDocument(input).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(ExportError);
      expect((error as ExportError).status).toBe(400);
      expect((error as ExportError).message).toMatch(reason);
    }
    // A bank whose metadata names a file that was not sent.
    const missing = { ...request(), bank: { metadata: bank.metadata, files: {} } };
    await expect(service.exportDocument(missing)).rejects.toThrow(
      /handwriting profile is not valid/,
    );
    expect(toPdf).not.toHaveBeenCalled();
    expect(files()).toEqual([]);
  });

  it('refuses documents over the page limit', async () => {
    const { service, files } = setup({ maxPages: 2 });
    const long = {
      ...request(),
      blocks: Array(200).fill({ type: 'paragraph', text: 'One more line of text.' }),
    };
    const error = await service.exportDocument(long).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ExportError);
    expect((error as ExportError).status).toBe(413);
    expect((error as ExportError).message).toMatch(/limit is 2 pages/);
    expect(files()).toEqual([]);
  });

  it('only honours links it signed, and only until they expire', async () => {
    const { service, clock } = setup();
    const { downloadPath, expiresAt } = await service.exportDocument(request());
    const { id, expires, sig } = query(downloadPath);
    const status = (...args: Parameters<typeof service.download>): Promise<number> =>
      service.download(...args).then(
        () => 200,
        (e: ExportError) => e.status,
      );

    expect(await status(id, expires, sig)).toBe(200);
    expect(await status(id, expires, `${sig.slice(0, -1)}0`)).toBe(403);
    expect(await status(id, String(Number(expires) + 1), sig)).toBe(403); // extended expiry
    expect(await status(id.replace(/^./, 'f'), expires, sig)).toBe(403); // another file
    expect(await status('../../etc/passwd', expires, sig)).toBe(403);
    expect(await status(id, null, null)).toBe(403);
    expect(expiresAt - clock.now).toBe(60 * 60 * 1000);

    clock.now = expiresAt + 1;
    expect(await status(id, expires, sig)).toBe(410);
  });

  it('signs differently under a different secret', async () => {
    const a = setup();
    const b = setup({ secret: 'a-completely-different-secret' });
    const result = await a.service.exportDocument(request());
    await b.service.exportDocument(request());
    const { id, expires, sig } = query(result.downloadPath);
    await expect(b.service.download(id, expires, sig)).rejects.toMatchObject({ status: 403 });
    expect(() => createExportService({ storageDir: a.storageDir, secret: 'short' })).toThrow();
  });

  it('cleans up exports past the cache period and keeps the rest', async () => {
    const { service, clock, files } = setup();
    const old = await service.exportDocument(request());
    clock.now += 20 * 60 * 60 * 1000;
    const recent = await service.exportDocument(request({ seed: 'newer' }));
    clock.now += 5 * 60 * 60 * 1000;
    expect(await service.cleanUp()).toBe(1);
    expect(files()).toEqual([`${recent.id}.json`, `${recent.id}.pdf`]);
    expect(files()).not.toContain(`${old.id}.pdf`);
  });
});

describe('worker server', { timeout: 60_000 }, () => {
  const { service } = setup();
  const server = createWorkerServer({
    service,
    maxBodyBytes: 2 * 1024 * 1024,
    allowOrigin: 'http://localhost:3000',
  });
  const ready = new Promise<string>((resolve) =>
    server.listen(0, () => resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}`)),
  );
  afterAll(() => server.close());
  const post = async (body: string): Promise<Response> =>
    fetch(`${await ready}/export`, {
      method: 'POST',
      body,
      headers: { 'content-type': 'application/json' },
    });

  it('exports over HTTP and serves the PDF from the signed link', async () => {
    const response = await post(JSON.stringify(request()));
    expect(response.status).toBe(200);
    expect(response.headers.get('access-control-allow-origin')).toBe('http://localhost:3000');
    const result = (await response.json()) as { downloadPath: string; pageCount: number };
    expect(result.pageCount).toBe(1);

    const file = await fetch(`${await ready}${result.downloadPath}`);
    expect(file.status).toBe(200);
    expect(file.headers.get('content-type')).toBe('application/pdf');
    expect(file.headers.get('content-disposition')).toContain('attachment');
    const bytes = new Uint8Array(await file.arrayBuffer());
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe('%PDF-');
  });

  it('answers the health check and unknown paths', async () => {
    expect(await (await fetch(`${await ready}/health`)).json()).toEqual({ ok: true });
    expect((await fetch(`${await ready}/nope`)).status).toBe(404);
    expect((await fetch(`${await ready}/export`)).status).toBe(404); // GET is not export
  });

  it('turns bad input into clear errors, not crashes', async () => {
    const invalidJson = await post('{not json');
    expect(invalidJson.status).toBe(400);
    expect(await invalidJson.json()).toEqual({ error: 'The request is not valid JSON.' });

    const invalid = await post(JSON.stringify({ blocks: [] }));
    expect(invalid.status).toBe(400);

    const tampered = await fetch(
      `${await ready}/download/${'a'.repeat(40)}?expires=99999999999999&sig=bad`,
    );
    expect(tampered.status).toBe(403);
    expect(await tampered.json()).toEqual({ error: 'This download link is not valid.' });
  });

  it('refuses an oversized upload', async () => {
    const huge = JSON.stringify({ ...request(), padding: 'x'.repeat(3 * 1024 * 1024) });
    const outcome = await post(huge).then(
      (response) => response.status,
      () => 'connection closed',
    );
    expect([413, 'connection closed']).toContain(outcome);
  });
});

describe('worker server under load', { timeout: 60_000 }, () => {
  it('makes exports wait their turn and turns the overflow away with 503', async () => {
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    const started: string[] = [];
    const { service } = setup({
      toPdf: async (scenes) => {
        started.push('render');
        await held;
        return scenesToPdf(scenes);
      },
    });
    // One export at a time and one waiting.
    const server = createWorkerServer({ service, limiter: createLimiter(1, 1) });
    const base = await new Promise<string>((resolve) =>
      server.listen(0, () => resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}`)),
    );
    const post = (seed: string): Promise<Response> =>
      fetch(`${base}/export`, { method: 'POST', body: JSON.stringify(request({ seed })) });

    try {
      const first = post('one');
      await vi.waitFor(() => expect(started).toHaveLength(1));
      const second = post('two');
      await new Promise((resolve) => setTimeout(resolve, 100));
      // The second is waiting, not rendering.
      expect(started).toHaveLength(1);

      const third = await post('three');
      expect(third.status).toBe(503);
      expect(third.headers.get('retry-after')).toBe('10');
      expect(((await third.json()) as { error: string }).error).toContain('Nothing was charged');
      // Other routes are not held up by the queue.
      expect((await fetch(`${base}/health`)).status).toBe(200);

      release();
      expect((await first).status).toBe(200);
      expect((await second).status).toBe(200);
      expect(started).toHaveLength(2);
    } finally {
      release();
      server.close();
    }
  });
});

describe('worker server rate limits', { timeout: 60_000 }, () => {
  it('limits requests per address, taking the address from the trusted header', async () => {
    const { service } = setup();
    const server = createWorkerServer({
      service,
      clientIpHeader: 'x-client',
      rateLimits: {
        all: createRateLimiter({ limit: 5, windowMs: 60_000 }),
        exports: createRateLimiter({ limit: 1, windowMs: 60_000 }),
      },
    });
    const base = await new Promise<string>((resolve) =>
      server.listen(0, () => resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}`)),
    );
    const get = (path: string, client: string): Promise<Response> =>
      fetch(`${base}${path}`, { headers: { 'x-client': client } });
    const post = (client: string): Promise<Response> =>
      fetch(`${base}/export`, {
        method: 'POST',
        body: JSON.stringify(request()),
        headers: { 'x-client': client },
      });

    try {
      // One export a minute for this address; the second is refused before any work.
      expect((await post('a')).status).toBe(200);
      const refused = await post('a');
      expect(refused.status).toBe(429);
      expect(Number(refused.headers.get('retry-after'))).toBeGreaterThan(0);
      expect(((await refused.json()) as { error: string }).error).toContain('Too many requests');
      // Another address is not affected.
      expect((await post('b')).status).toBe(200);

      // Every other route shares a larger allowance (a has used 2 of 5).
      for (let i = 0; i < 3; i++) expect((await get('/nope', 'a')).status).toBe(404);
      expect((await get('/nope', 'a')).status).toBe(429);
      // The health check and the payment webhook are never limited.
      for (let i = 0; i < 10; i++) expect((await get('/health', 'a')).status).toBe(200);
      expect((await get('/webhooks/paddle', 'a')).status).toBe(404);
    } finally {
      server.close();
    }
  });
});

describe('what the worker writes to its log', () => {
  it('never includes document text, even when an export fails', async () => {
    const { service } = setup({
      toPdf: () => Promise.reject(new Error('renderer crashed')),
    });
    const server = createWorkerServer({ service });
    const base = await new Promise<string>((resolve) =>
      server.listen(0, () => resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}`)),
    );
    const logged: string[] = [];
    const spy = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      logged.push(args.map(String).join(' '));
    });
    try {
      const body = JSON.stringify({
        ...request(),
        blocks: [{ type: 'paragraph', text: 'Dear diary, a secret nobody should read.' }],
      });
      const response = await fetch(`${base}/export`, { method: 'POST', body });
      expect(response.status).toBe(500);
      expect(((await response.json()) as { error: string }).error).toContain('Nothing was charged');
      expect(logged.length).toBeGreaterThan(0);
      expect(logged.join('\n')).not.toContain('secret');
      expect(logged.join('\n')).not.toContain('Dear diary');
    } finally {
      spy.mockRestore();
      server.close();
    }
  });
});
