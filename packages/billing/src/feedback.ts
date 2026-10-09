import type { Pool } from 'pg';
import { BillingError, call } from './accounts';

export const FEEDBACK_KINDS = ['bad_output', 'bad_glyph', 'bug', 'idea', 'other'] as const;
export type FeedbackKind = (typeof FEEDBACK_KINDS)[number];

/**
 * The only things kept alongside a piece of feedback: where it happened and with which
 * settings. Anything else a client sends is dropped, so document text or handwriting
 * cannot ride along.
 */
const CONTEXT_FIELDS: Record<string, (value: unknown) => boolean> = {
  screen: (value) => ['editor', 'sample', 'account', 'other'].includes(value as string),
  page: (value) => Number.isInteger(value) && (value as number) >= 1 && (value as number) <= 1000,
  pages: (value) => Number.isInteger(value) && (value as number) >= 1 && (value as number) <= 1000,
  style: (value) => typeof value === 'string' && /^[a-z-]{1,20}$/.test(value),
  ink: (value) => typeof value === 'string' && /^[a-z-]{1,20}$/.test(value),
  paper: (value) => typeof value === 'string' && /^[a-z-]{1,20}$/.test(value),
  // The one letter the user says came out wrong.
  character: (value) => typeof value === 'string' && [...value].length === 1,
};

export const sanitizeFeedbackContext = (input: unknown): Record<string, unknown> => {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {};
  return Object.fromEntries(
    Object.entries(input as Record<string, unknown>).filter(([name, value]) =>
      CONTEXT_FIELDS[name]?.(value),
    ),
  );
};

export interface Feedback {
  id: number;
  kind: FeedbackKind;
  message: string;
  context: Record<string, unknown>;
  at: string;
}

const toFeedback = (row: Record<string, unknown>): Feedback => ({
  id: Number(row.id),
  kind: row.kind as FeedbackKind,
  message: row.message as string,
  context: row.context as Record<string, unknown>,
  at: (row.created_at as Date).toISOString(),
});

/** Stores one piece of feedback. At most 20 a day per person. */
export async function submitFeedback(
  pool: Pool,
  userId: string,
  input: { kind?: unknown; message?: unknown; context?: unknown },
): Promise<Feedback> {
  const message = typeof input.message === 'string' ? input.message.trim().slice(0, 2000) : '';
  if (!(FEEDBACK_KINDS as readonly unknown[]).includes(input.kind) || !message) {
    throw new BillingError(
      'invalid_feedback',
      'Please choose what this is about and write a few words.',
      400,
    );
  }
  try {
    const { rows } = await call(() =>
      pool.query(`select * from public.submit_feedback($1, $2, $3, $4)`, [
        userId,
        input.kind,
        message,
        JSON.stringify(sanitizeFeedbackContext(input.context)),
      ]),
    );
    return toFeedback(rows[0]);
  } catch (error) {
    if ((error as Error).message?.startsWith('feedback_limit_reached')) {
      throw new BillingError(
        'feedback_limit_reached',
        'Thank you, we have plenty from you for today. Please try again tomorrow.',
        429,
      );
    }
    throw error;
  }
}

/** A user's own feedback, for their copy of their data. */
export async function listFeedback(pool: Pool, userId: string): Promise<Feedback[]> {
  const { rows } = await pool.query(
    `select * from public.feedback where user_id = $1 order by id`,
    [userId],
  );
  return rows.map(toFeedback);
}

/**
 * The most recent feedback from everyone, with counts by kind, for whoever runs the
 * beta. It carries no user id and no email: what matters is what was said.
 */
export async function feedbackReport(
  pool: Pool,
  limit = 200,
): Promise<{ counts: Record<string, number>; recent: (Feedback & { plan: string })[] }> {
  const counts = await pool.query(
    `select kind, count(*)::integer as n from public.feedback group by kind`,
  );
  const recent = await pool.query(
    `select f.*, a.plan from public.feedback f join public.accounts a using (user_id)
      order by f.id desc limit $1`,
    [limit],
  );
  return {
    counts: Object.fromEntries(counts.rows.map((row) => [row.kind, row.n])),
    recent: recent.rows.map((row) => ({ ...toFeedback(row), plan: row.plan as string })),
  };
}
