import { createHash, timingSafeEqual } from 'node:crypto';
import {
  activateAccount,
  applyEntitlements,
  AuthError,
  BillingError,
  checkoutPrices,
  completeExport,
  costReport,
  createPortalLink,
  deleteAccount,
  exportAccountData,
  failExport,
  feedbackReport,
  getAccount,
  handlePaddleWebhook,
  listFeedback,
  recentLedger,
  recordConsent,
  redeemReferral,
  reserveExport,
  submitFeedback,
  verifyAccessToken,
  WebhookSignatureError,
  type PaddleApiConfig,
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
  /** Protects the cost and feedback reports. */
  adminToken?: string;
  /** Which Paddle the browser's checkout should talk to. Defaults to the sandbox. */
  paddleEnvironment?: 'sandbox' | 'production';
  /** For the "manage subscription" link. Without it that link is switched off. */
  paddleApi?: PaddleApiConfig;
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

/** What the user must send to delete their account: a slip of the finger is not enough. */
export const DELETE_CONFIRMATION = 'delete my account';
/** The version of the "this is my own handwriting" statement users confirm. */
export const OWN_HANDWRITING_VERSION = '2026-10-08';

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
      return reply(200, {
        plans: Object.values(PLANS),
        topUp: TOP_UP,
        // Which price is which, for opening a checkout. Price ids are not secret.
        checkout: {
          environment: config.paddleEnvironment ?? 'sandbox',
          prices: checkoutPrices(config.paddle.prices),
        },
      });
    }

    if (method === 'GET' && path.startsWith('/admin/')) {
      if (!config.adminToken || !sameSecret(request.headers.authorization, config.adminToken)) {
        return reply(404, { error: 'Not found.' });
      }
      if (path === '/admin/costs') return reply(200, await costReport(pool));
      if (path === '/admin/feedback') return reply(200, await feedbackReport(pool));
      return reply(404, { error: 'Not found.' });
    }

    const owned = ['/me', '/export', '/profiles', '/referrals', '/feedback'];
    if (!owned.some((prefix) => path === prefix || path.startsWith(`${prefix}/`))) return undefined;
    const user = userOf(request);

    if (method === 'GET' && path === '/me') {
      return reply(200, {
        account: await getAccount(pool, user),
        ledger: await recentLedger(pool, user),
      });
    }

    if (method === 'POST' && path === '/feedback') {
      const feedback = await submitFeedback(pool, user, await json(request));
      return reply(201, { feedback });
    }

    // A link to the payment provider's own pages: change card, invoices, cancel.
    if (method === 'POST' && path === '/me/portal') {
      if (!config.paddleApi) {
        return reply(503, {
          error: 'Managing a subscription online is not available yet. Please contact support.',
          code: 'portal_not_configured',
        });
      }
      return reply(200, { url: await createPortalLink(pool, user, config.paddleApi) });
    }

    // Everything we hold about the user, for them to keep: their right to a copy.
    if (method === 'GET' && path === '/me/data') {
      const data = await exportAccountData(pool, user);
      const banks = await Promise.all(
        data.profiles.map((profile) => config.profiles.load(user, String(profile.id))),
      );
      return reply(200, {
        exportedAt: new Date().toISOString(),
        ...data,
        // The handwriting itself, decrypted for its owner.
        profiles: data.profiles.map((profile, index) => ({ ...profile, bank: banks[index] })),
        feedback: await listFeedback(pool, user),
        note: 'Documents you exported are not listed with their text because the text was never stored.',
      });
    }

    if (method === 'POST' && path === '/me/consents') {
      const body = await json(request);
      const consent = await recordConsent(
        pool,
        user,
        {
          kind: String(body.kind ?? ''),
          version: String(body.version ?? ''),
          granted: body.granted === true,
        },
        fingerprint(request.address),
      );
      return reply(201, { consent });
    }

    // The right to be forgotten. Rows go first, in one transaction; then the files.
    if (method === 'DELETE' && path === '/me') {
      const body = await json(request);
      if (body.confirm !== DELETE_CONFIRMATION) {
        return reply(400, {
          error: `To delete your account, send confirm: "${DELETE_CONFIRMATION}".`,
          code: 'confirmation_required',
        });
      }
      const files = await deleteAccount(pool, user);
      await config.profiles.removeFiles(files.profileKeys);
      await Promise.all(files.exportHashes.map((hash) => exports.forget(hash)));
      return reply(200, { deleted: true, profilesDeleted: files.profileKeys.length });
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
      if (method === 'POST') {
        const body = await json(request);
        const profile = await config.profiles.save(user, body);
        // Saving is only possible with the confirmation, so log that it was given.
        await recordConsent(
          pool,
          user,
          { kind: 'own_handwriting', version: OWN_HANDWRITING_VERSION, granted: true },
          fingerprint(request.address),
        );
        return reply(201, { profile });
      }
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
