import type { BillingInterval, PlanId } from '@pentwin/shared';
import type { Pool } from 'pg';
import { BillingError } from './accounts';
import type { PaddleConfig } from './paddle';

/**
 * Calls to Paddle's own API (as opposed to the notifications Paddle sends us).
 *
 * WRITTEN FROM PADDLE'S DOCUMENTATION AND NEVER RUN AGAINST PADDLE: there is no account
 * yet. The tests use a stand-in that answers the way the documentation says Paddle does.
 */
export interface PaddleApiConfig {
  /** A server-side API key from the Paddle dashboard. Never sent to the browser. */
  apiKey: string;
  environment: 'sandbox' | 'production';
  request?: typeof fetch;
}

const API_BASE = {
  sandbox: 'https://sandbox-api.paddle.com',
  production: 'https://api.paddle.com',
} as const;

/**
 * A link to Paddle's customer portal for this user, where they change their card,
 * download invoices and cancel. The link is short-lived and made for one customer.
 */
export async function createPortalLink(
  pool: Pool,
  userId: string,
  config: PaddleApiConfig,
): Promise<string> {
  const { rows } = await pool.query(
    `select provider_customer_id, provider_subscription_id from public.accounts where user_id = $1`,
    [userId],
  );
  const customer = rows[0]?.provider_customer_id as string | undefined;
  if (!customer) {
    throw new BillingError(
      'no_subscription',
      'There is no subscription on this account to manage.',
      404,
    );
  }
  const subscription = rows[0]?.provider_subscription_id as string | undefined;

  const request = config.request ?? fetch;
  let response: Response;
  try {
    response = await request(
      `${API_BASE[config.environment]}/customers/${encodeURIComponent(customer)}/portal-sessions`,
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${config.apiKey}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify(subscription ? { subscription_ids: [subscription] } : {}),
        signal: AbortSignal.timeout(10_000),
      },
    );
  } catch {
    throw new BillingError(
      'portal_unavailable',
      'The billing portal could not be reached. Please try again in a moment.',
      502,
    );
  }
  const body = (await response.json().catch(() => ({}))) as {
    data?: { urls?: { general?: { overview?: string } } };
  };
  const url = body.data?.urls?.general?.overview;
  if (!response.ok || !url || !url.startsWith('https://')) {
    throw new BillingError(
      'portal_unavailable',
      'The billing portal could not be opened. Please try again in a moment.',
      502,
    );
  }
  return url;
}

/** What the browser needs to open a checkout: which price is which. Nothing secret. */
export interface CheckoutPrices {
  plans: Partial<Record<Exclude<PlanId, 'free'>, Partial<Record<BillingInterval, string>>>>;
  topUp?: string;
}

export function checkoutPrices(prices: PaddleConfig['prices']): CheckoutPrices {
  const result: CheckoutPrices = { plans: {} };
  for (const [id, meaning] of Object.entries(prices)) {
    if (meaning.kind === 'top_up') result.topUp = id;
    else (result.plans[meaning.plan] ??= {})[meaning.interval] = id;
  }
  return result;
}
