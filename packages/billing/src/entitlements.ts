import { PLANS, type PlanId } from '@pentwin/shared';

/** The render options that plans can restrict. Other options pass through untouched. */
interface RestrictableOptions {
  ink?: unknown;
  inkColor?: unknown;
  corrections?: unknown;
  jitter?: { fatigue?: number } & Record<string, unknown>;
  header?: unknown;
}

/** Pens available on plans limited to the basic options. */
export const BASIC_INKS = ['ballpoint-blue', 'ballpoint-black'] as const;

/**
 * Limits render options to what a plan includes. Called on the server with the plan
 * from the database, never with anything the client claims: asking for a premium
 * option on the free plan simply gets the basic one.
 */
export function applyEntitlements<T extends RestrictableOptions>(options: T, plan: PlanId): T {
  if (!PLANS[plan].basicOptionsOnly) return options;
  const basic: RestrictableOptions = {
    ...options,
    ink: (BASIC_INKS as readonly unknown[]).includes(options.ink) ? options.ink : 'ballpoint-blue',
    corrections: 0,
  };
  // Custom ink colours and the handwritten header are paid features.
  delete basic.inkColor;
  delete basic.header;
  if (options.jitter) basic.jitter = { ...options.jitter, fatigue: 0 };
  return basic as T;
}
