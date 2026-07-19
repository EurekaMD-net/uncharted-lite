/**
 * Per-IP sliding-window rate limiter (in-memory — single-process BFF).
 * Two buckets: general browsing vs verdict computation (the expensive,
 * scrape-worthy surface). Caddy fronts the BFF, so client IP comes from
 * X-Forwarded-For (first hop).
 */
export interface RateLimitConfig {
  windowMs: number;
  max: number;
}

export const LIMITS = {
  general: { windowMs: 60_000, max: 30 },
  verdict: { windowMs: 60_000, max: 10 },
  // Explore fans out to AGEB label lookups upstream (up to ~23 calls on a
  // cold municipio), so its budget is tighter than verdict's.
  explore: { windowMs: 60_000, max: 6 },
} as const satisfies Record<string, RateLimitConfig>;

export class RateLimiter {
  private hits = new Map<string, number[]>();
  constructor(
    private config: RateLimitConfig,
    private now: () => number = Date.now,
  ) {}

  /** Returns true when the request is allowed; records the hit if so. */
  allow(key: string): boolean {
    const cutoff = this.now() - this.config.windowMs;
    const prev = (this.hits.get(key) ?? []).filter((t) => t > cutoff);
    if (prev.length >= this.config.max) {
      this.hits.set(key, prev);
      return false;
    }
    prev.push(this.now());
    this.hits.set(key, prev);
    return true;
  }

  /** Drop stale keys so the map doesn't grow unbounded. */
  prune(): void {
    const cutoff = this.now() - this.config.windowMs;
    for (const [key, times] of this.hits) {
      const live = times.filter((t) => t > cutoff);
      if (live.length === 0) this.hits.delete(key);
      else this.hits.set(key, live);
    }
  }
}

/**
 * Client IP for rate-limit keying. The BFF sits behind EXACTLY ONE trusted
 * proxy (Caddy, which appends the real peer to any client-supplied
 * X-Forwarded-For), so the trustworthy hop is the LAST one — the first hop
 * is attacker-controllable and would let a rotating forged value bypass
 * the limiter entirely. Caddy is additionally configured to overwrite the
 * header (`header_up X-Forwarded-For {remote_host}`), making both hops
 * agree; this function stays last-hop as defense in depth.
 */
export function clientIp(xff: string | undefined): string {
  if (!xff) return "local";
  const hops = xff.split(",").map((h) => h.trim());
  return hops[hops.length - 1] || "local";
}
