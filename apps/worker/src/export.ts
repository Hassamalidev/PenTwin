import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { buildGlyphBank, renderDocument, scenesToPdf, type PageScene } from '@pentwin/engine';
import { exportRequestSchema, type ExportRequest } from './schema';

export interface ExportServiceOptions {
  /** Directory the finished PDFs are kept in. */
  storageDir: string;
  /** Key for signing download links. Never sent to clients. */
  secret: string;
  /** How long an identical request is served from the cache. Defaults to 24 hours. */
  cacheMs?: number;
  /** How long a download link stays valid. Defaults to 1 hour. */
  linkMs?: number;
  /** Largest document that will be rendered, in pages. */
  maxPages?: number;
  /** The clock, replaceable in tests. */
  now?: () => number;
  /** Turns page scenes into PDF bytes, replaceable in tests. */
  toPdf?: (scenes: readonly PageScene[]) => Promise<Uint8Array>;
}

export interface ExportResult {
  /** Identifies the document: a hash of the request. */
  id: string;
  pageCount: number;
  /** True when an identical export from the last 24 hours was reused. Reuse is free. */
  cached: boolean;
  /** Pages to charge for: the page count, or 0 when served from the cache. */
  billablePages: number;
  /** Path and query of the signed download link. */
  downloadPath: string;
  expiresAt: number;
  /** Characters that could not be written, with how often each occurred. */
  unknownChars: Record<string, number>;
}

/** The request was understood but cannot be carried out; safe to show to the user. */
export class ExportError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'ExportError';
  }
}

interface Meta {
  createdAt: number;
  pageCount: number;
  unknownChars: Record<string, number>;
}

/** JSON with object keys in a fixed order, so equal requests always hash the same. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;

/**
 * Renders documents to PDF on the server and hands out signed, expiring download links.
 *
 * - Identical requests (same content, same bank, same settings, same seed) within the
 *   cache period return the stored file and are free.
 * - A failed export leaves nothing behind: the file is written under a temporary name
 *   and only moved into place, together with its record, once everything succeeded.
 */
export function createExportService(config: ExportServiceOptions) {
  const now = config.now ?? Date.now;
  const cacheMs = config.cacheMs ?? DAY;
  const linkMs = config.linkMs ?? HOUR;
  const maxPages = config.maxPages ?? 100;
  const toPdf = config.toPdf ?? scenesToPdf;
  if (config.secret.length < 16)
    throw new Error('The signing secret must be at least 16 characters');

  const pdfPath = (id: string): string => join(config.storageDir, `${id}.pdf`);
  const metaPath = (id: string): string => join(config.storageDir, `${id}.json`);
  const sign = (id: string, expiresAt: number): string =>
    createHmac('sha256', config.secret).update(`${id}:${expiresAt}`).digest('hex');

  const link = (id: string): { downloadPath: string; expiresAt: number } => {
    const expiresAt = now() + linkMs;
    return {
      downloadPath: `/download/${id}?expires=${expiresAt}&sig=${sign(id, expiresAt)}`,
      expiresAt,
    };
  };

  const readMeta = async (id: string): Promise<Meta | undefined> => {
    try {
      return JSON.parse(await readFile(metaPath(id), 'utf8')) as Meta;
    } catch {
      return undefined;
    }
  };

  /** Requests being rendered right now, so two identical ones share the work. */
  const inFlight = new Map<string, Promise<Meta>>();

  const render = async (id: string, request: ExportRequest): Promise<Meta> => {
    let bank;
    try {
      bank = buildGlyphBank(request.bank.metadata, (file) => {
        const svg = request.bank.files[file];
        if (svg === undefined) throw new Error(`Missing glyph file "${file}"`);
        return svg;
      });
    } catch (error) {
      throw new ExportError(
        `The handwriting profile is not valid: ${(error as Error).message}`,
        400,
      );
    }

    const { pages, report } = renderDocument(request.blocks, bank, request.options);
    if (pages.length > maxPages) {
      throw new ExportError(
        `This document comes to ${pages.length} pages. The limit is ${maxPages} pages per export.`,
        413,
      );
    }
    const bytes = await toPdf(pages);
    const meta: Meta = {
      createdAt: now(),
      pageCount: pages.length,
      unknownChars: report.unknownChars,
    };

    await mkdir(config.storageDir, { recursive: true });
    const temporary = join(config.storageDir, `.tmp-${randomUUID()}`);
    try {
      await writeFile(temporary, bytes);
      await rename(temporary, pdfPath(id));
      // The record goes last: without it the file does not count as an export.
      await writeFile(`${temporary}.json`, JSON.stringify(meta));
      await rename(`${temporary}.json`, metaPath(id));
    } catch (error) {
      await Promise.all(
        [temporary, `${temporary}.json`, pdfPath(id)].map((p) => rm(p, { force: true })),
      );
      throw error;
    }
    return meta;
  };

  return {
    /** Validates, renders (or reuses) and returns a signed download link. */
    async exportDocument(input: unknown): Promise<ExportResult> {
      const parsed = exportRequestSchema.safeParse(input);
      if (!parsed.success) {
        const issue = parsed.error.issues[0];
        throw new ExportError(
          `The export request is not valid: ${issue?.path.join('.') || 'request'}: ${issue?.message}`,
          400,
        );
      }
      const request = parsed.data;
      const id = createHash('sha256').update(canonical(request)).digest('hex').slice(0, 40);

      const existing = await readMeta(id);
      if (existing && now() - existing.createdAt < cacheMs) {
        return {
          id,
          pageCount: existing.pageCount,
          cached: true,
          billablePages: 0,
          unknownChars: existing.unknownChars,
          ...link(id),
        };
      }

      let job = inFlight.get(id);
      const shared = job !== undefined;
      if (!job) {
        job = render(id, request).finally(() => inFlight.delete(id));
        inFlight.set(id, job);
      }
      const meta = await job;
      return {
        id,
        pageCount: meta.pageCount,
        // Someone else's identical request did the work: nothing new to pay for.
        cached: shared,
        billablePages: shared ? 0 : meta.pageCount,
        unknownChars: meta.unknownChars,
        ...link(id),
      };
    },

    /** Checks a download link and returns the file, or throws an `ExportError`. */
    async download(
      id: string,
      expires: string | null,
      signature: string | null,
    ): Promise<Uint8Array> {
      const expiresAt = Number(expires);
      if (!/^[0-9a-f]{40}$/.test(id) || !Number.isFinite(expiresAt) || !signature) {
        throw new ExportError('This download link is not valid.', 403);
      }
      const expected = Buffer.from(sign(id, expiresAt));
      const given = Buffer.from(signature);
      if (expected.length !== given.length || !timingSafeEqual(expected, given)) {
        throw new ExportError('This download link is not valid.', 403);
      }
      if (now() > expiresAt) throw new ExportError('This download link has expired.', 410);
      try {
        return await readFile(pdfPath(id));
      } catch {
        throw new ExportError('This file is no longer available. Export it again.', 404);
      }
    },

    /** Deletes exports older than the cache period, and any stray temporary files. */
    async cleanUp(): Promise<number> {
      let removed = 0;
      let names: string[];
      try {
        names = await readdir(config.storageDir);
      } catch {
        return 0;
      }
      for (const name of names) {
        const path = join(config.storageDir, name);
        const id = /^([0-9a-f]{40})\.json$/.exec(name)?.[1];
        if (id) {
          const meta = await readMeta(id);
          if (!meta || now() - meta.createdAt >= cacheMs) {
            await Promise.all([rm(path, { force: true }), rm(pdfPath(id), { force: true })]);
            removed++;
          }
        } else if (name.startsWith('.tmp-')) {
          // Left by a crash mid-export. Give a running export an hour before judging.
          const age = now() - (await stat(path)).mtimeMs;
          if (age > HOUR) await rm(path, { force: true });
        }
      }
      return removed;
    },
  };
}

export type ExportService = ReturnType<typeof createExportService>;
