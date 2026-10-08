import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAlerter, routeOf } from './alerts';

afterEach(() => vi.restoreAllMocks());

const setup = (
  overrides: { url?: string; fail?: boolean } = { url: 'https://hooks.example/x' },
) => {
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  const clock = { now: 1_000_000 };
  const sent: { url: string; body: { text: string } }[] = [];
  const post = vi.fn((url: string | URL | Request, init?: RequestInit) => {
    if (overrides.fail) return Promise.reject(new Error('network down'));
    sent.push({ url: String(url), body: JSON.parse(String(init?.body)) as { text: string } });
    return Promise.resolve(new Response('ok'));
  });
  const alerter = createAlerter({
    url: overrides.url,
    source: 'worker staging',
    now: () => clock.now,
    post: post as typeof fetch,
  });
  return { alerter, clock, sent, post };
};

describe('alerts', () => {
  it('posts the message, saying where it came from', async () => {
    const { alerter, sent } = setup();
    await alerter.send('Unexpected error TypeError on POST /export');
    expect(sent).toEqual([
      {
        url: 'https://hooks.example/x',
        body: { text: '[worker staging] Unexpected error TypeError on POST /export' },
      },
    ]);
  });

  it('does not repeat the same message for ten minutes, but lets a different one through', async () => {
    const { alerter, clock, sent } = setup();
    for (let i = 0; i < 50; i++) await alerter.send('database unreachable');
    await alerter.send('cost per page is too high');
    expect(sent.map((item) => item.body.text.replace('[worker staging] ', ''))).toEqual([
      'database unreachable',
      'cost per page is too high',
    ]);
    clock.now += 10 * 60 * 1000;
    await alerter.send('database unreachable');
    expect(sent).toHaveLength(3);
  });

  it('only logs when no address is configured', async () => {
    const { alerter, post } = setup({});
    await alerter.send('something happened');
    expect(post).not.toHaveBeenCalled();
    expect(console.warn).toHaveBeenCalledWith('ALERT: something happened');
  });

  it('never throws when the alert channel itself is down', async () => {
    const { alerter } = setup({ url: 'https://hooks.example/x', fail: true });
    await expect(alerter.send('worker crashed')).resolves.toBeUndefined();
    expect(console.error).toHaveBeenCalledWith('sending an alert failed');
  });
});

describe('routeOf', () => {
  it('takes identifiers out of a path', () => {
    expect(routeOf('/profiles/3f2a9c1e-5b7d-4e2a-9c1e-5b7d4e2a9c1e')).toBe('/profiles/:id');
    expect(routeOf(`/download/${'a1'.repeat(20)}`)).toBe('/download/:id');
    expect(routeOf('/me/data')).toBe('/me/data');
    expect(routeOf('/export')).toBe('/export');
  });
});
