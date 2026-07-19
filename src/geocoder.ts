/**
 * Nominatim geocoder client. Points at NOMINATIM_URL — the public
 * nominatim.openstreetmap.org by default (demo scale), a self-hosted MX
 * instance later with zero code change.
 *
 * The public instance's usage policy is enforced HERE, not trusted to
 * callers: an identifying User-Agent, calls serialized with ≥1.1s spacing,
 * and a 24h result cache so repeated addresses never re-hit the API.
 */
import { TtlCache } from "./upstream.js";

export interface GeocodeResult {
  lat: number;
  lon: number;
  /** Nominatim display_name — shown back to the user for confirmation. */
  displayName: string;
}

interface NominatimRow {
  lat: string;
  lon: string;
  display_name: string;
}

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const MIN_SPACING_MS = 1_100; // public Nominatim policy: max 1 req/s
const TIMEOUT_MS = 10_000;
/**
 * The queue drains at ~0.9 req/s globally; without a depth cap, enough
 * concurrent clients (each inside their per-IP budget) would grow it
 * unboundedly and hold connections for minutes (audit W1). Beyond this
 * depth, fail fast — the caller turns it into a 503.
 */
const MAX_QUEUE_DEPTH = 8;

export class GeocoderBusyError extends Error {
  constructor() {
    super("geocoder queue full");
  }
}

export interface GeocoderConfig {
  url: string;
  userAgent: string;
}

export class Geocoder {
  private cache: TtlCache;
  private queue: Promise<unknown> = Promise.resolve();
  private lastCallAt = Number.NEGATIVE_INFINITY; // first call never waits

  constructor(
    private config: GeocoderConfig,
    private fetchFn: typeof fetch = fetch,
    private now: () => number = Date.now,
    private sleep: (ms: number) => Promise<void> = (ms) =>
      new Promise((r) => setTimeout(r, ms)),
  ) {
    this.cache = new TtlCache(now);
  }

  /**
   * Geocode a free-text query. Returns null when Nominatim finds nothing.
   * Callers pass an already-scoped query ("<dirección>, <municipio>,
   * <estado>, México") — this module doesn't compose it.
   */
  private pending = 0;

  search(query: string): Promise<GeocodeResult | null> {
    const key = query.trim().toLowerCase().replace(/\s+/g, " ");
    const cached = this.cache.get<GeocodeResult | null>(key);
    if (cached !== undefined) return Promise.resolve(cached);
    if (this.pending >= MAX_QUEUE_DEPTH) {
      return Promise.reject(new GeocoderBusyError());
    }

    this.pending++;
    // Serialize: each call waits for the previous one plus the spacing gap.
    const run = this.queue
      .then(async () => {
        // Another queued call for the same key may have resolved meanwhile.
        const again = this.cache.get<GeocodeResult | null>(key);
        if (again !== undefined) return again;

        const wait = this.lastCallAt + MIN_SPACING_MS - this.now();
        if (wait > 0) await this.sleep(wait);
        this.lastCallAt = this.now();

        const url = `${this.config.url}/search?format=jsonv2&limit=1&countrycodes=mx&q=${encodeURIComponent(query)}`;
        const res = await this.fetchFn(url, {
          headers: { "User-Agent": this.config.userAgent },
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
        if (!res.ok) {
          throw new Error(`nominatim ${res.status}`);
        }
        const rows = (await res.json()) as NominatimRow[];
        const first = rows[0];
        const result: GeocodeResult | null =
          first &&
          Number.isFinite(Number(first.lat)) &&
          Number.isFinite(Number(first.lon))
            ? {
                lat: Number(first.lat),
                lon: Number(first.lon),
                displayName: first.display_name,
              }
            : null;
        this.cache.set(key, result, CACHE_TTL_MS);
        return result;
      })
      .finally(() => {
        this.pending--;
      });
    // Keep the chain alive even when a call rejects.
    this.queue = run.catch(() => {});
    return run;
  }
}
