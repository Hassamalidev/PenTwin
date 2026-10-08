import { BRAND } from '@pentwin/shared';
import type { Pool } from 'pg';

export type EmailKind = 'welcome' | 'receipt' | 'low_credits' | 'payment_failed' | 'export_ready';

export interface Email {
  to: string;
  subject: string;
  text: string;
}

/** Delivers one email. Throws if it could not be handed over. */
export type EmailSender = (email: Email) => Promise<void>;

const day = (iso: unknown): string =>
  typeof iso === 'string'
    ? new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
    : 'the end of the period';

/** The wording of each email. Plain text; no document content ever goes into one. */
export function renderEmail(kind: EmailKind, payload: Record<string, unknown>): Omit<Email, 'to'> {
  const name = BRAND.name;
  switch (kind) {
    case 'welcome':
      return {
        subject: `Welcome to ${name}`,
        text:
          `Thanks for joining ${name}.\n\n` +
          'To get started, write the short sample text by hand, photograph it, and upload a ' +
          'document. Your free plan includes 5 pages a month.\n\n' +
          'Please only use it with your own handwriting.',
      };
    case 'receipt': {
      const amount =
        typeof payload.amount === 'number' && typeof payload.currency === 'string'
          ? `${payload.amount.toFixed(2)} ${payload.currency}`
          : 'your payment';
      return {
        subject: `Your ${name} receipt`,
        text:
          `We received ${amount} for: ${String(payload.description ?? 'your purchase')}.\n\n` +
          'The full invoice is available from the billing page.',
      };
    }
    case 'low_credits':
      return {
        subject: `You have ${String(payload.remaining)} pages left`,
        text:
          `You have ${String(payload.remaining)} pages left on ${name}. ` +
          `Your monthly pages reset on ${day(payload.resets_on)}.\n\n` +
          'If you need more before then, you can add a 100-page top-up from the billing page.',
      };
    case 'payment_failed':
      return {
        subject: `We could not take your ${name} payment`,
        text:
          'Your latest payment did not go through. Your plan stays active for now. ' +
          'Please update your payment method from the billing page to keep it.',
      };
    case 'export_ready':
      return {
        subject: `Your ${String(payload.pages)}-page export is ready`,
        text: `Your export of ${String(payload.pages)} pages has finished. Open ${name} to download it.`,
      };
  }
}

/**
 * Sends the emails waiting in the outbox. Each is marked sent only after the sender
 * accepted it; a failure is recorded and tried again next time. Rows are locked while
 * being sent, so two senders running at once never send the same email twice.
 */
export async function sendPendingEmails(
  pool: Pool,
  send: EmailSender,
  limit = 20,
): Promise<{ sent: number; failed: number }> {
  const db = await pool.connect();
  let sent = 0;
  let failed = 0;
  try {
    await db.query('begin');
    const { rows } = await db.query(
      `select o.id, o.kind, o.payload, u.email
         from public.email_outbox o join auth.users u on u.id = o.user_id
        where o.sent_at is null
        order by o.id limit $1
        for update of o skip locked`,
      [limit],
    );
    for (const row of rows) {
      try {
        await send({ to: row.email, ...renderEmail(row.kind, row.payload ?? {}) });
        await db.query(
          `update public.email_outbox set sent_at = now(), error = null where id = $1`,
          [row.id],
        );
        sent++;
      } catch (error) {
        await db.query(`update public.email_outbox set error = $2 where id = $1`, [
          row.id,
          (error as Error).message.slice(0, 500),
        ]);
        failed++;
      }
    }
    await db.query('commit');
  } catch (error) {
    await db.query('rollback').catch(() => undefined);
    throw error;
  } finally {
    db.release();
  }
  return { sent, failed };
}

/**
 * A sender that uses Resend's HTTP API. NOT verified against the live service: no
 * account was available when this was written.
 */
export function createResendSender(apiKey: string, from: string): EmailSender {
  return async (email) => {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({ from, to: [email.to], subject: email.subject, text: email.text }),
    });
    if (!response.ok) throw new Error(`Resend answered ${response.status}`);
  };
}
