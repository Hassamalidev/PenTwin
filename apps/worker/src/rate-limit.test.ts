import { describe, expect, it } from 'vitest';
import { clientAddress, createRateLimiter } from './rate-limit';

describe('the rate limiter', () => {
  it('allows the limit, refuses the rest, and starts again after the window', () => {
    let time = 1_000_000;
    const limiter = createRateLimiter({ limit: 3, windowMs: 60_000, now: () => time });
    expect([1, 2, 3].map(() => limiter.take('a').allowed)).toEqual([true, true, true]);
    const refused = limiter.take('a');
    expect(refused.allowed).toBe(false);
    expect(refused.retryAfterSeconds).toBe(60);

    time += 45_000;
    expect(limiter.take('a')).toEqual({ allowed: false, retryAfterSeconds: 15 });
    time += 15_000;
    expect(limiter.take('a').allowed).toBe(true);
  });

  it('gives a request back when it was counted but not served', () => {
    const limiter = createRateLimiter({ limit: 2, windowMs: 60_000 });
    limiter.take('a');
    limiter.take('a');
    limiter.refund('a');
    expect(limiter.take('a').allowed).toBe(true);
    expect(limiter.take('a').allowed).toBe(false);
    // Refunding more than was taken, or an unknown address, does nothing.
    for (let i = 0; i < 5; i++) limiter.refund('b');
    expect(limiter.take('b').allowed).toBe(true);
    expect(limiter.take('b').allowed).toBe(true);
    expect(limiter.take('b').allowed).toBe(false);
  });

  it('counts each address separately', () => {
    const limiter = createRateLimiter({ limit: 1, windowMs: 60_000 });
    expect(limiter.take('a').allowed).toBe(true);
    expect(limiter.take('b').allowed).toBe(true);
    expect(limiter.take('a').allowed).toBe(false);
  });

  it('does not grow without bound when flooded with different addresses', () => {
    let time = 0;
    const limiter = createRateLimiter({
      limit: 1,
      windowMs: 60_000,
      maxKeys: 100,
      now: () => time,
    });
    for (let i = 0; i < 10_000; i++) limiter.take(`address-${i}`);
    // The limiter still works, and the most recent address is still being counted.
    expect(limiter.take('address-9999').allowed).toBe(false);
    time += 60_000;
    expect(limiter.take('address-9999').allowed).toBe(true);
  });
});

describe('the address of a request', () => {
  const socket = '10.0.0.1';

  it('is the socket address unless the deployment names a header to trust', () => {
    expect(clientAddress(socket, { 'x-forwarded-for': '6.6.6.6' }, undefined)).toBe(socket);
    expect(clientAddress(undefined, {}, undefined)).toBe('unknown');
  });

  it('comes from the trusted header when there is one', () => {
    expect(clientAddress(socket, { 'fly-client-ip': '203.0.113.9' }, 'Fly-Client-IP')).toBe(
      '203.0.113.9',
    );
    // Missing header: fall back rather than fail.
    expect(clientAddress(socket, {}, 'fly-client-ip')).toBe(socket);
  });

  it('takes the last entry of a forwarded list, the one our own proxy added', () => {
    // The visitor put a fake address first; the proxy appended the real one.
    expect(
      clientAddress(socket, { 'x-forwarded-for': '1.1.1.1, 203.0.113.9' }, 'x-forwarded-for'),
    ).toBe('203.0.113.9');
  });
});
