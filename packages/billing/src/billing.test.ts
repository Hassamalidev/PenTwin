import { describe, expect, it } from 'vitest';
import { AuthError, signAccessToken, verifyAccessToken } from './auth';
import { renderEmail, type EmailKind } from './emails';
import { applyEntitlements } from './entitlements';
import {
  pricesFromEnv,
  signPaddlePayload,
  verifyPaddleSignature,
  WebhookSignatureError,
} from './paddle';

const NOW = 1_800_000_000_000;

describe('Paddle signature', () => {
  const secret = 'pdl_ntfset_test_secret';
  const body = '{"event_id":"evt_1","event_type":"subscription.created"}';
  const header = signPaddlePayload(body, secret, NOW);

  it('accepts a correctly signed notification', () => {
    expect(header).toMatch(/^ts=1800000000;h1=[0-9a-f]{64}$/);
    expect(() => verifyPaddleSignature(body, header, secret, NOW)).not.toThrow();
  });

  it('matches the scheme in the Paddle documentation', () => {
    // "ts" and the raw body joined by a colon, HMAC-SHA256 with the secret, as hex.
    // The expected value was computed outside this code base:
    //   printf '1671552777:{"a":1}' | openssl dgst -sha256 -hmac 'secret'
    const reference = '98f8abe8c491ad3de496727ffd5c16edc1f4a434a6be07bd82ebbc55d66b614c';
    expect(signPaddlePayload('{"a":1}', 'secret', 1671552777_000)).toBe(
      `ts=1671552777;h1=${reference}`,
    );
    expect(() =>
      verifyPaddleSignature('{"a":1}', `ts=1671552777;h1=${reference}`, 'secret', 1671552777_000),
    ).not.toThrow();
  });

  it('rejects a changed body, a wrong secret, and an old or malformed header', () => {
    const reject = (...args: Parameters<typeof verifyPaddleSignature>): string => {
      try {
        verifyPaddleSignature(...args);
        return 'accepted';
      } catch (error) {
        expect(error).toBeInstanceOf(WebhookSignatureError);
        return (error as Error).message;
      }
    };
    expect(reject(`${body} `, header, secret, NOW)).toMatch(/does not match/);
    expect(reject(body, header, 'another-secret', NOW)).toMatch(/does not match/);
    expect(reject(body, header, secret, NOW + 31_000)).toMatch(/too old/);
    expect(reject(body, header, secret, NOW - 31_000)).toMatch(/too old/);
    expect(reject(body, header, secret, NOW + 29_000)).toBe('accepted');
    expect(reject(body, undefined, secret, NOW)).toMatch(/missing or malformed/);
    expect(reject(body, 'h1=abc', secret, NOW)).toMatch(/missing or malformed/);
    expect(reject(body, 'ts=1800000000;h1=zz', secret, NOW)).toMatch(/does not match/);
    // A replayed header with a fresher timestamp no longer matches the signature.
    expect(reject(body, header.replace('1800000000', '1800000020'), secret, NOW + 20_000)).toMatch(
      /does not match/,
    );
  });

  it('reads price ids from the environment and ignores unset ones', () => {
    expect(
      pricesFromEnv({
        PADDLE_PRICE_STUDENT_MONTH: 'pri_a',
        PADDLE_PRICE_TOP_UP: 'pri_t',
        OTHER: 'x',
      }),
    ).toEqual({
      pri_a: { kind: 'plan', plan: 'student', interval: 'month' },
      pri_t: { kind: 'top_up', pages: 100 },
    });
  });
});

describe('access tokens', () => {
  const secret = 'super-secret-jwt-signing-key-for-tests';
  const user = '3f2b1c9e-5d4a-4b7c-9e1f-0a1b2c3d4e5f';
  const token = signAccessToken(user, secret, NOW + 60_000);

  it('returns the user id of a valid token', () => {
    expect(verifyAccessToken(token, secret, NOW)).toBe(user);
  });

  it('rejects everything else', () => {
    const fails = (value: string | undefined, key = secret, now = NOW): boolean => {
      try {
        verifyAccessToken(value, key, now);
        return false;
      } catch (error) {
        expect(error).toBeInstanceOf(AuthError);
        return true;
      }
    };
    const encode = (value: unknown): string =>
      Buffer.from(JSON.stringify(value)).toString('base64url');
    const [header, payload, signature] = token.split('.') as [string, string, string];

    expect(fails(undefined)).toBe(true);
    expect(fails('not.a.token')).toBe(true);
    expect(fails(token, 'a-different-secret')).toBe(true);
    expect(fails(token, secret, NOW + 61_000)).toBe(true); // expired
    // Someone else's id with the original signature.
    const forged = encode({
      sub: '00000000-0000-4000-8000-000000000000',
      role: 'authenticated',
      exp: 9e9,
    });
    expect(fails(`${header}.${forged}.${signature}`)).toBe(true);
    // The "none" algorithm trick: no signature at all.
    expect(fails(`${encode({ alg: 'none' })}.${payload}.`)).toBe(true);
    // A correctly signed token that is not a signed-in user.
    expect(fails(signAccessToken('not-a-uuid', secret, NOW + 60_000))).toBe(true);
  });
});

describe('applyEntitlements', () => {
  const asked = {
    seed: 1,
    ink: 'fountain',
    inkColor: '#aa0000',
    corrections: 0.03,
    jitter: { fatigue: 0.7, slant: 4 },
    header: [{ value: 'Sara' }],
    pageSize: 'A4',
  };

  it('gives the free plan the basic options whatever was asked for', () => {
    expect(applyEntitlements(asked, 'free')).toEqual({
      seed: 1,
      ink: 'ballpoint-blue',
      corrections: 0,
      jitter: { fatigue: 0, slant: 4 },
      pageSize: 'A4',
    });
    expect(applyEntitlements({ ink: 'ballpoint-black' }, 'free').ink).toBe('ballpoint-black');
    expect(asked.ink).toBe('fountain'); // the input is not changed
  });

  it('leaves paid plans alone', () => {
    expect(applyEntitlements(asked, 'student')).toBe(asked);
    expect(applyEntitlements(asked, 'pro')).toBe(asked);
  });
});

describe('renderEmail', () => {
  it('writes every kind of email', () => {
    const payloads: Record<EmailKind, Record<string, unknown>> = {
      welcome: {},
      receipt: { amount: 4, currency: 'USD', description: 'student plan, billed every month' },
      low_credits: { remaining: 12, resets_on: '2026-11-08T00:00:00.000Z' },
      payment_failed: {},
      export_ready: { pages: 24 },
    };
    for (const [kind, payload] of Object.entries(payloads)) {
      const email = renderEmail(kind as EmailKind, payload);
      expect(email.subject.length).toBeGreaterThan(5);
      expect(email.text.length).toBeGreaterThan(30);
      expect(`${email.subject} ${email.text}`).not.toMatch(/undefined|null|\[object/);
    }
    expect(renderEmail('receipt', payloads.receipt).text).toContain('4.00 USD');
    expect(renderEmail('low_credits', payloads.low_credits).text).toContain('8 November 2026');
    expect(renderEmail('export_ready', payloads.export_ready).subject).toBe(
      'Your 24-page export is ready',
    );
  });
});
