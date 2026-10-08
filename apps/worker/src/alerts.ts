export interface Alerter {
  /**
   * Sends a short message to whoever is on call. Never throws and never waits long: a
   * broken alert channel must not break the worker.
   */
  send(text: string): Promise<void>;
}

export interface AlerterOptions {
  /**
   * Where alerts are posted, as JSON `{"text": "..."}`. That is what a Slack incoming
   * webhook accepts, and what most chat and paging tools can be given. Left out, alerts
   * only go to the log.
   */
  url?: string;
  /** The same message is not sent again within this time. Defaults to ten minutes. */
  repeatAfterMs?: number;
  now?: () => number;
  post?: typeof fetch;
  /** Named in every message, so staging and production can share a channel. */
  source: string;
}

/**
 * Tells a person when something needs attention: an unexpected error, a crash, a page
 * that costs too much to produce. Messages are written by the worker from names, counts
 * and timings. They never contain document text, file names or handwriting.
 */
export function createAlerter(options: AlerterOptions): Alerter {
  const now = options.now ?? Date.now;
  const post = options.post ?? fetch;
  const repeatAfterMs = options.repeatAfterMs ?? 10 * 60 * 1000;
  const lastSent = new Map<string, number>();

  return {
    async send(text) {
      const time = now();
      const previous = lastSent.get(text);
      // A fault that repeats every second would otherwise bury the channel.
      if (previous !== undefined && time - previous < repeatAfterMs) return;
      if (lastSent.size > 500) lastSent.clear();
      lastSent.set(text, time);

      console.warn(`ALERT: ${text}`);
      if (!options.url) return;
      try {
        await post(options.url, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ text: `[${options.source}] ${text}` }),
          signal: AbortSignal.timeout(5000),
        });
      } catch {
        console.error('sending an alert failed');
      }
    },
  };
}

/**
 * A request path with anything that identifies a user or a file taken out, so it can be
 * grouped and sent in an alert: `/profiles/3f2a...` becomes `/profiles/:id`.
 */
export const routeOf = (path: string): string =>
  path
    .split('/')
    .map((part) => (/^[0-9a-f-]{16,}$/i.test(part) ? ':id' : part))
    .join('/')
    .slice(0, 80);
