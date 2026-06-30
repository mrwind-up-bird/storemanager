import 'server-only';

export interface RateLimiter {
  acquire(): Promise<void>;
}

/** Serialises acquires so each resolves >= (1000/ratePerSec) ms after the previous. */
export function createRateLimiter(opts: { ratePerSec: number }): RateLimiter {
  const spacingMs = Math.ceil(1000 / opts.ratePerSec);
  let nextAt = 0;
  return {
    acquire(): Promise<void> {
      const now = Date.now();
      const at = Math.max(now, nextAt);
      nextAt = at + spacingMs;
      const delay = at - now;
      return delay <= 0 ? Promise.resolve() : new Promise((r) => setTimeout(r, delay));
    },
  };
}

/** Process-wide limiter: all Discogs HTTP calls share this (2 req/s). */
export const discogsLimiter: RateLimiter = createRateLimiter({ ratePerSec: 2 });
