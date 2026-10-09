import type { BillingInterval, PlanId } from '@pentwin/shared';

/**
 * Opens the payment provider's checkout (Paddle.js).
 *
 * WRITTEN FROM PADDLE'S DOCUMENTATION AND NEVER RUN AGAINST PADDLE: there is no account
 * yet, so no purchase, real or test, has ever gone through this code.
 */

const CLIENT_TOKEN = process.env.NEXT_PUBLIC_PADDLE_CLIENT_TOKEN ?? '';
const SCRIPT = 'https://cdn.paddle.com/paddle/v2/paddle.js';

/** What the worker's `GET /plans` says about paying. */
export interface CheckoutInfo {
  environment: 'sandbox' | 'production';
  prices: {
    plans: Partial<Record<Exclude<PlanId, 'free'>, Partial<Record<BillingInterval, string>>>>;
    topUp?: string;
  };
}

interface PaddleGlobal {
  Environment: { set(name: string): void };
  Initialize(options: { token: string; eventCallback?: (event: { name?: string }) => void }): void;
  Checkout: {
    open(options: {
      items: { priceId: string; quantity: number }[];
      customer?: { email: string };
      customData?: Record<string, string>;
    }): void;
  };
}

/** The checkout could not be opened, in words for the buyer. */
export class CheckoutProblem extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CheckoutProblem';
  }
}

/** Whether this build can take payments at all. */
export const checkoutConfigured = CLIENT_TOKEN !== '';

let loading: Promise<PaddleGlobal> | undefined;

const load = (info: CheckoutInfo, onPaid: () => void): Promise<PaddleGlobal> =>
  (loading ??= new Promise<PaddleGlobal>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = SCRIPT;
    script.onload = () => {
      const paddle = (window as unknown as { Paddle?: PaddleGlobal }).Paddle;
      if (!paddle) return reject(new CheckoutProblem('The payment page could not be loaded.'));
      if (info.environment === 'sandbox') paddle.Environment.set('sandbox');
      paddle.Initialize({
        token: CLIENT_TOKEN,
        eventCallback: (event) => {
          if (event.name === 'checkout.completed') onPaid();
        },
      });
      resolve(paddle);
    };
    script.onerror = () => {
      loading = undefined;
      reject(new CheckoutProblem('The payment page could not be loaded. Please try again.'));
    };
    document.head.append(script);
  }));

/**
 * Opens a checkout for one price. The user's id travels with the purchase, which is how
 * the payment notification finds the account to credit; the plan and the pages granted
 * are decided by the server from the price that was actually paid.
 */
export async function openCheckout(
  info: CheckoutInfo,
  priceId: string,
  buyer: { userId: string; email: string },
  onPaid: () => void,
): Promise<void> {
  if (!checkoutConfigured) throw new CheckoutProblem('Payments are not switched on yet.');
  const paddle = await load(info, onPaid);
  paddle.Checkout.open({
    items: [{ priceId, quantity: 1 }],
    customer: { email: buyer.email },
    customData: { user_id: buyer.userId },
  });
}
