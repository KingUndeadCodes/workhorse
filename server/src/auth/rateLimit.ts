/**
 * A small in-memory fixed-window limiter, keyed by an arbitrary string (an IP, an email, both). In
 * memory means it resets on restart and isn't shared across processes — fine for a single-process
 * self-hosted app, and it only needs to make online guessing impractical, not be a durable record.
 */
export interface RateLimiter {
  /** Counts one attempt for `key`. Returns `{ ok: false, retryAfterSeconds }` once the window's budget is spent. */
  hit(key: string): { ok: true } | { ok: false; retryAfterSeconds: number };
  /** Forgets `key` — e.g. after a successful login, so a person who finally typed the right password isn't left locked out. */
  reset(key: string): void;
}

export function createRateLimiter({ max, windowMs, now = () => Date.now() }: { max: number; windowMs: number; now?: () => number }): RateLimiter {
  const windows = new Map<string, { count: number; resetAt: number }>();
  return {
    hit(key) {
      const t = now();
      if (windows.size > 10_000) for (const [k, w] of windows) if (w.resetAt <= t) windows.delete(k); // bound memory under a flood of distinct keys
      let w = windows.get(key);
      if (!w || w.resetAt <= t) {
        w = { count: 0, resetAt: t + windowMs };
        windows.set(key, w);
      }
      w.count++;
      return w.count <= max ? { ok: true } : { ok: false, retryAfterSeconds: Math.max(1, Math.ceil((w.resetAt - t) / 1000)) };
    },
    reset(key) {
      windows.delete(key);
    },
  };
}
