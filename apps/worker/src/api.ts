import { createHash, timingSafeEqual } from 'node:crypto';
import {
  activateAccount,
  applyEntitlements,
  AuthError,
  BillingError,
  completeExport,
  costReport,
  failExport,
  getAccount,
  handlePaddleWebhook,
  recentLedger,
  redeemReferral,
  reserveExport,
  verifyAccessToken,
  WebhookSignatureError,
  type PaddleConfig,
} from '@pentwin/billing';
import { PLANS, TOP_UP } from '@pentwin/shared';
import type { Pool } from 'pg';
import { ExportError, type ExportService } from './export';
import type { ProfileStore } from './profiles';

/** Everything the account routes need. Without it the worker runs unmetered (local demo). */
export interface AccountsConfig {
  pool: Pool;
  /** The JWT secret of the Supabase project, to check who is calling. */
  jwtSecret: string;
  paddle: PaddleConfig;
  profiles: ProfileStore;
  /** Mixed into address and device fingerprints before they are stored. */
  hashSalt: string;
  /** Protects the cost report. */
  adminToken?: string;
}

export interface ApiRequest {
  method: string;
  path: string;
  headers: Record<string, string | undefined>;
  /** The network address the request came from. */
  address: string;
  /** Reads the request body as text. */
  text: () => Promise<string>;
}

export interface ApiResponse {
  status: number;
  body: unknown;
}

const reply = (status: number, body: unknown): ApiResponse => ({ status, body });

/** Compares a bearer token with a secret without leaking, by timing, how much matched. */
const sameSecret = (header: string | undefined, secret: string): boolean => {
  const digest = (value: string): Buffer => createHash('sha256').update(value).digest();
  return timingSafeEqual(digest(header ?? ''), digest(`Bearer ${secret}`));
};

/**
 * The routes that depend on who the user is: account, pages, profiles, referrals,
 * metered export, and the payment webhook. Returns undefined for paths it does not own.
 */
export function createAccountsApi(config: AccountsConfig, exports: ExportService) {
  const { pool } = config;
  const fingerprint = (value: string): string =>
    createHash('sha256').update(`${config.hashSalt}:${value}`).digest('hex').slice(0, 32);

  const userOf = (request: ApiRequest): string => {
    const header = request.headers.authorization ?? '';
    return verifyAccessToken(
      header.startsWith('Bearer ') ? header.slice(7) : undefined,
      config.jwtSecret,
    );
  };
  const json = async (request: ApiRequest): Promise<Record<string, unknown>> => {
    try {
      const value: unknown = JSON.parse(await request.text());
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        return value as Record<string, unknown>;
      }
    } catch {
      // fall through
    }
    throw new ExportError('The request is not valid JSON.', 400);
  };

  const route = async (request: ApiRequest): Promise<ApiResponse | undefined> => {
    const { method, path } = request;

    // The payment provider calls this; it is authenticated by its signature alone.
    if (method === 'POST' && path === '/webhooks/paddle') {
      const outcome = await handlePaddleWebhook(
        pool,
        await request.text(),
        request.headers['paddle-signature'],
        config.paddle,
      );
      return reply(200, { outcome });
    }

    if (method === 'GET' && path === '/plans') {
      return reply(200, { plans: Object.values(PLANS), topUp: TOP_UP });
    }

    if (method === 'GET' && path === '/admin/costs') {
      if (!config.adminToken || !sameSecret(request.headers.authorization, config.adminToken)) {
        return reply(404, { error: 'Not found.' });
      }
      return reply(200, await costReport(pool));
    }

    const owned = ['/me', '/export', '/profiles', '/referrals'];
    if (!owned.some((prefix) => path === prefix || path.startsWith(`${prefix}/`))) return undefined;
    const user = userOf(request);

    if (method === 'GET' && path === '/me') {
      return reply(200, {
        account: await getAccount(pool, user),
        ledger: await recentLedger(pool, user),
      });
    }

    if (method === 'POST' && path === '/me/activate') {
      const body = await json(request);
      // Fingerprints are hashed with a secret salt; the raw values are never stored.
      const device = typeof body.device === 'string' ? body.device.slice(0, 200) : request.address;
      await activateAccount(pool, user, fingerprint(request.address), fingerprint(device));
      return reply(200, { account: await getAccount(pool, user) });
    }

    if (method === 'POST' && path === '/referrals/redeem') {
      const body = await json(request);
      const result = await redeemReferral(pool, user, String(body.code ?? '').slice(0, 40));
      return reply(result === 'granted' ? 200 : 409, { result });
    }

    if (method === 'POST' && path === '/export') {
      const body = await json(request);
      // The plan is read from the database here. Nothing in the request can change it.
      const account = await getAccount(pool, user);
      const result = await exports.exportMetered(body, {
        prepare: (parsed) => ({
          ...parsed,
          options: applyEntitlements(parsed.options, account.plan),
        }),
        reserve: async (pageCount, requestHash) => {
          const reservation = await reserveExport(pool, user, pageCount, requestHash);
          return {
            chargedPages: reservation.chargedPages,
            watermarked: reservation.watermarked,
            settle: async (outcome) => {
              if (outcome.ok) {
                await completeExport(
                  pool,
                  reservation.exportId,
                  outcome.computeMs,
                  outcome.outputBytes,
                );
              } else {
                await failExport(pool, reservation.exportId);
              }
            },
          };
        },
      });
      return reply(200, { ...result, account: await getAccount(pool, user) });
    }

    if (path === '/profiles') {
      if (method === 'GET') return reply(200, { profiles: await config.profiles.list(user) });
      if (method === 'POST')
        return reply(201, { profile: await config.profiles.save(user, await json(request)) });
    }
    if (path.startsWith('/profiles/')) {
      const id = path.slice('/profiles/'.length);
      if (method === 'GET') return reply(200, { bank: await config.profiles.load(user, id) });
      if (method === 'DELETE') {
        await config.profiles.remove(user, id);
        return reply(200, { deleted: true });
      }
    }
    return reply(404, { error: 'Not found.' });
  };

  /** Like `route`, with the errors users can act on turned into plain answers. */
  return async (request: ApiRequest): Promise<ApiResponse | undefined> => {
    try {
      return await route(request);
    } catch (error) {
      if (error instanceof AuthError) return reply(401, { error: error.message });
      if (error instanceof BillingError) {
        return reply(error.status, { error: error.message, code: error.code });
      }
      if (error instanceof WebhookSignatureError)
        return reply(401, { error: 'Invalid signature.' });
      throw error;
    }
  };
}
