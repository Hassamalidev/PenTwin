export interface RateLimiter {
  /** Counts one request for `key`. Says whether it is allowed and, if not, when to retry. */
  take(key: string): { allowed: boolean; retryAfterSeconds: number };
  /** Gives back one request for `key`: it was counted but then not served. */
  refund(key: string): void;
}

export interface RateLimitOptions {
  /** Requests allowed per window, per key. */
  limit: number;
  windowMs: number;
  now?: () => number;
  /** Most keys remembered at once, so a flood of made-up keys cannot use up memory. */
  maxKeys?: number;
}

/**
 * Allows each key (a network address) a fixed number of requests per window. The counts
 * live in this process's memory, which is right while there is a single worker; with
 * several, each would count separately.
 */
export function createRateLimiter(options: RateLimitOptions): RateLimiter {
  const now = options.now ?? Date.now;
  const maxKeys = options.maxKeys ?? 20_000;
  const windows = new Map<string, { count: number; resetAt: number }>();

  const makeRoom = (time: number): void => {
    for (const [key, window] of windows) if (window.resetAt <= time) windows.delete(key);
    // Still full of live keys: forget the oldest ones first.
    for (const key of windows.keys()) {
      if (windows.size < maxKeys) break;
      windows.delete(key);
    }
  };

  return {
    take(key) {
      const time = now();
      let window = windows.get(key);
      if (!window || window.resetAt <= time) {
        if (!window && windows.size >= maxKeys) makeRoom(time);
        window = { count: 0, resetAt: time + options.windowMs };
        windows.set(key, window);
      }
      window.count++;
      return {
        allowed: window.count <= options.limit,
        retryAfterSeconds: Math.max(1, Math.ceil((window.resetAt - time) / 1000)),
      };
    },
    refund(key) {
      const window = windows.get(key);
      if (window && window.resetAt > now() && window.count > 0) window.count--;
    },
  };
}

/**
 * The address a request really came from. Behind a host's proxy the socket only shows
 * the proxy, and the visitor's address arrives in a header the proxy sets. That header
 * is only trusted when the deployment names it; otherwise anyone could claim any address.
 */
export function clientAddress(
  socketAddress: string | undefined,
  headers: Record<string, string | string[] | undefined>,
  trustedHeader: string | undefined,
): string {
  if (trustedHeader) {
    const raw = headers[trustedHeader.toLowerCase()];
    const value = Array.isArray(raw) ? raw[raw.length - 1] : raw;
    // In a forwarded list, the last entry is the one our own proxy added.
    const last = value?.split(',').pop()?.trim();
    if (last) return last.slice(0, 64);
  }
  return socketAddress ?? 'unknown';
}
