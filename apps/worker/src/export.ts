import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  buildGlyphBank,
  renderDocument,
  scenesToPdf,
  type PageScene,
  type PdfOptions,
} from '@pentwin/engine';
import { BRAND } from '@pentwin/shared';
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
  toPdf?: (scenes: readonly PageScene[], options?: PdfOptions) => Promise<Uint8Array>;
}

export interface ExportResult {
  /** Identifies the document: a hash of the request. */
  id: string;
  pageCount: number;
  /** True when an identical export from the last 24 hours was reused. Reuse is free. */
  cached: boolean;
  /** Pages charged for: the page count, or 0 when the export was free. */
  billablePages: number;
  /** True when the pages carry the free plan's watermark. */
  watermarked: boolean;
  /** Path and query of the signed download link. */
  downloadPath: string;
  expiresAt: number;
  /** Characters that could not be written, with how often each occurred. */
  unknownChars: Record<string, number>;
}

/** How one export turned out, reported back so pages can be kept or returned. */
export type ExportOutcome = { ok: true; computeMs: number; outputBytes: number } | { ok: false };

/** Connects an export to a user's plan and pages. Supplied by the billing layer. */
export interface Metering {
  /** Adjusts the request before anything is rendered, e.g. to what the plan allows. */
  prepare?: (request: ExportRequest) => ExportRequest;
  /**
   * Called once the exact page count is known and before the PDF is made. Sets the pages
   * aside, or throws to refuse the export. `settle` is then called exactly once with
   * how it went.
   */
  reserve: (
    pageCount: number,
    requestHash: string,
  ) => Promise<{
    chargedPages: number;
    watermarked: boolean;
    settle: (outcome: ExportOutcome) => Promise<void>;
  }>;
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
const WATERMARK = `${BRAND.name} free plan`;

/**
 * Renders documents to PDF on the server and hands out signed, expiring download links.
 *
 * - Identical requests (same content, same bank, same settings, same seed) within the
 *   cache period return the stored file.
 * - A failed export leaves nothing behind: the file is written under a temporary name
 *   and only moved into place, together with its record, once everything succeeded.
 */
export function createExportService(config: ExportServiceOptions) {
  const now = config.now ?? Date.now;
  const cacheMs = config.cacheMs ?? DAY;
  const linkMs = config.linkMs ?? HOUR;
  const maxPages = config.maxPages ?? 100;
  const toPdf = config.toPdf ?? scenesToPdf;
  if (config.secret.length < 16) {
    throw new Error('The signing secret must be at least 16 characters');
  }

  const pdfPath = (id: string): string => join(config.storageDir, `${id}.pdf`);
  const metaPath = (id: string): string => join(config.storageDir, `${id}.json`);
  const sign = (id: string, expiresAt: number): string =>
    createHmac('sha256', config.secret).update(`${id}:${expiresAt}`).digest('hex');
  const hash = (text: string): string =>
    createHash('sha256').update(text).digest('hex').slice(0, 40);

  const link = (id: string): { downloadPath: string; expiresAt: number } => {
    const expiresAt = now() + linkMs;
    return {
      downloadPath: `/download/${id}?expires=${expiresAt}&sig=${sign(id, expiresAt)}`,
      expiresAt,
    };
  };

  const parse = (input: unknown): ExportRequest => {
    const parsed = exportRequestSchema.safeParse(input);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      throw new ExportError(
        `The export request is not valid: ${issue?.path.join('.') || 'request'}: ${issue?.message}`,
        400,
      );
    }
    return parsed.data;
  };

  /** A stored export that is still within the cache period, if there is one. */
  const cachedMeta = async (id: string): Promise<Meta | undefined> => {
    try {
      const meta = JSON.parse(await readFile(metaPath(id), 'utf8')) as Meta;
      return now() - meta.createdAt < cacheMs ? meta : undefined;
    } catch {
      return undefined;
    }
  };

  /** Lays the document out: cheap, and tells us the exact page count. */
  const layOut = (request: ExportRequest) => {
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
    return { pages, unknownChars: report.unknownChars };
  };

  /** Makes the PDF and stores it. Returns its size in bytes. */
  const produce = async (
    id: string,
    pages: readonly PageScene[],
    unknownChars: Record<string, number>,
    watermarked: boolean,
  ): Promise<number> => {
    const bytes = await toPdf(pages, watermarked ? { watermark: WATERMARK } : undefined);
    const meta: Meta = { createdAt: now(), pageCount: pages.length, unknownChars };

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
    return bytes.length;
  };

  /** Requests being rendered right now, so two identical ones share the work. */
  const inFlight = new Map<string, Promise<Meta>>();

  return {
    /**
     * Validates, renders (or reuses) and returns a signed download link. This form has
     * no notion of users or plans: a repeat within the cache period simply reports
     * zero billable pages.
     */
    async exportDocument(input: unknown): Promise<ExportResult> {
      const request = parse(input);
      const id = hash(canonical(request));

      const existing = await cachedMeta(id);
      if (existing) {
        return {
          id,
          pageCount: existing.pageCount,
          cached: true,
          billablePages: 0,
          watermarked: false,
          unknownChars: existing.unknownChars,
          ...link(id),
        };
      }

      let job = inFlight.get(id);
      const shared = job !== undefined;
      if (!job) {
        job = (async (): Promise<Meta> => {
          const { pages, unknownChars } = layOut(request);
          await produce(id, pages, unknownChars, false);
          return { createdAt: now(), pageCount: pages.length, unknownChars };
        })().finally(() => inFlight.delete(id));
        inFlight.set(id, job);
      }
      const meta = await job;
      return {
        id,
        pageCount: meta.pageCount,
        // Someone else's identical request did the work: nothing new to pay for.
        cached: shared,
        billablePages: shared ? 0 : meta.pageCount,
        watermarked: false,
        unknownChars: meta.unknownChars,
        ...link(id),
      };
    },

    /**
     * The same, for a signed-in user: what the plan allows is applied first, pages are
     * set aside once the page count is known, and they are kept only if the export
     * succeeds. Who pays what is decided entirely by `metering`, never by the request.
     */
    async exportMetered(input: unknown, metering: Metering): Promise<ExportResult> {
      const parsed = parse(input);
      const request = metering.prepare ? parse(metering.prepare(parsed)) : parsed;
      const requestHash = hash(canonical(request));
      const { pages, unknownChars } = layOut(request);

      const reservation = await metering.reserve(pages.length, requestHash);
      // Watermarked and clean copies of the same document are different files.
      const id = reservation.watermarked ? hash(`${requestHash}:watermarked`) : requestHash;
      const started = performance.now();
      try {
        const reused = await cachedMeta(id);
        const outputBytes = reused
          ? (await stat(pdfPath(id))).size
          : await produce(id, pages, unknownChars, reservation.watermarked);
        await reservation.settle({
          ok: true,
          computeMs: reused ? 0 : performance.now() - started,
          outputBytes,
        });
        return {
          id,
          pageCount: pages.length,
          cached: reused !== undefined,
          billablePages: reservation.chargedPages,
          watermarked: reservation.watermarked,
          unknownChars,
          ...link(id),
        };
      } catch (error) {
        await reservation.settle({ ok: false });
        throw error;
      }
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

    /**
     * Deletes the stored files of one request, watermarked or not. `requestHash` is
     * what the metered export recorded for it. Used when an account is deleted.
     */
    async forget(requestHash: string): Promise<void> {
      if (!/^[0-9a-f]{40}$/.test(requestHash)) return;
      const ids = [requestHash, hash(`${requestHash}:watermarked`)];
      await Promise.all(
        ids.flatMap((id) => [rm(pdfPath(id), { force: true }), rm(metaPath(id), { force: true })]),
      );
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
          if (!(await cachedMeta(id))) {
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
