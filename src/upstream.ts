/**
 * Typed client for the México Uncharted API. Injects the X-Api-Key and
 * memoizes responses in a TTL cache so cascade traffic rarely hits the
 * warehouse. Raw upstream rows never leave this module uncooked — handlers
 * decide what crosses the wire.
 */
import type { BffConfig } from "./config.js";

// --- upstream response shapes (subset Lite consumes, quoted from
// eurekamd-denue-analysis src/api/handlers/) ---

export interface EntidadRow {
  clave: string;
  nombre: string;
}
export interface EntidadesResult {
  entidades: EntidadRow[];
}

export interface MunicipioRow {
  cve_mun: string;
  /** Null on warehouse-noise rows (e.g. cve 19999, "municipio unspecified"). */
  municipio: string | null;
  poblacion: number | null;
  establecimientos: number;
  pobreza_pct: number | null;
  irs_grado: string | null;
}
export interface MunicipiosResult {
  entidad: string;
  municipios: MunicipioRow[];
}

export interface ColoniaListRow {
  colonia: string;
  num_establecimientos: number;
}
export interface ColoniasResult {
  cve_mun: string;
  colonias: ColoniaListRow[];
}

export interface OpportunityColoniaRow {
  colonia: string | null;
  target_count: number;
  total_estab: number;
  score: number | null;
}
export interface OpportunityColoniasResult {
  cve_mun: string;
  colonias: OpportunityColoniaRow[];
}

export interface OpportunityAgebRow {
  cvegeo: string;
  ambito: "Urbana" | "Rural" | null;
  pobtot: number | null;
  target_count: number;
  total_estab: number;
  score: number | null;
  rezago_grado: string | null;
}
export interface OpportunityAgebsResult {
  cve_mun: string;
  agebs: OpportunityAgebRow[];
}

export interface ColoniasByAgebResult {
  cvegeo: string;
  colonias: ColoniaListRow[];
}

export interface ResolveAgebResult {
  lat: number;
  lon: number;
  cvegeo: string;
  ambito: "Urbana" | "Rural" | null;
  cve_mun: string;
}

export interface RiskMunicipioRow {
  cve_mun: string;
  delitos_per_1k_pop: number | null;
}
export interface RiskSummaryResult {
  entidad: string;
  municipios: RiskMunicipioRow[];
}

// --- TTL cache ---

interface CacheEntry {
  value: unknown;
  expiresAt: number;
}

/**
 * Bounded: expired entries were only evicted on same-key re-access, and two
 * cache keys are attacker-influenced (geocode text, resolve coords) — a
 * rotation of unique keys would grow the Map monotonically (audit W2).
 * On overflow, the oldest insertions are dropped (Map preserves insertion
 * order); hot keys re-enter on next fetch.
 */
const CACHE_MAX_ENTRIES = 5_000;

export class TtlCache {
  private store = new Map<string, CacheEntry>();
  constructor(
    private now: () => number = Date.now,
    private maxEntries: number = CACHE_MAX_ENTRIES,
  ) {}

  get<T>(key: string): T | undefined {
    const hit = this.store.get(key);
    if (!hit) return undefined;
    if (hit.expiresAt <= this.now()) {
      this.store.delete(key);
      return undefined;
    }
    return hit.value as T;
  }

  set(key: string, value: unknown, ttlMs: number): void {
    if (this.store.size >= this.maxEntries && !this.store.has(key)) {
      const oldest = this.store.keys().next();
      if (!oldest.done) this.store.delete(oldest.value);
    }
    this.store.set(key, { value, expiresAt: this.now() + ttlMs });
  }
}

export class UpstreamError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

const TTL = {
  entidades: 60 * 60 * 1000,
  municipios: 60 * 60 * 1000,
  colonias: 60 * 60 * 1000,
  opportunity: 60 * 60 * 1000,
  risk: 6 * 60 * 60 * 1000,
  resolve: 24 * 60 * 60 * 1000,
} as const;

const UPSTREAM_TIMEOUT_MS = 15_000;

export class Upstream {
  constructor(
    private config: Pick<BffConfig, "upstreamUrl" | "upstreamApiKey">,
    private cache: TtlCache = new TtlCache(),
    private fetchFn: typeof fetch = fetch,
  ) {}

  private async fetchJson<T>(path: string, ttlMs: number): Promise<T> {
    const cached = this.cache.get<T>(path);
    if (cached !== undefined) return cached;

    const res = await this.fetchFn(`${this.config.upstreamUrl}${path}`, {
      headers: { "X-Api-Key": this.config.upstreamApiKey },
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
    if (!res.ok) {
      throw new UpstreamError(`upstream ${path} → ${res.status}`, res.status);
    }
    const body = (await res.json()) as T;
    this.cache.set(path, body, ttlMs);
    return body;
  }

  entidades(): Promise<EntidadesResult> {
    return this.fetchJson("/entidades", TTL.entidades);
  }

  municipios(entidad: string): Promise<MunicipiosResult> {
    // Params are regex-gated by callers; encoding is defense-in-depth so a
    // future unvalidated caller can't smuggle `&`/path segments upstream.
    return this.fetchJson(
      `/analytics/municipios?entidad=${encodeURIComponent(entidad)}`,
      TTL.municipios,
    );
  }

  colonias(cveMun: string): Promise<ColoniasResult> {
    return this.fetchJson(
      `/analytics/colonias-by-municipio?cve_mun=${encodeURIComponent(cveMun)}&order_by=num_establecimientos&limit=200`,
      TTL.colonias,
    );
  }

  opportunityByColonia(
    cveMun: string,
    scian: string[],
  ): Promise<OpportunityColoniasResult> {
    return this.fetchJson(
      `/analytics/opportunity-by-colonia?cve_mun=${encodeURIComponent(cveMun)}&target_scian=${encodeURIComponent(scian.join(","))}&order_by=total_estab&limit=200`,
      TTL.opportunity,
    );
  }

  /**
   * AGEB-grain opportunity rows for a municipio, biggest population first.
   * order_by=pobtot (not score): upstream's score sorts greenfield AGEBs
   * (NULL) last, but a zero-competitor AGEB can be the best zone — we rank
   * with our own engine after fetching.
   */
  opportunityByAgeb(
    cveMun: string,
    scian: string[],
  ): Promise<OpportunityAgebsResult> {
    return this.fetchJson(
      `/analytics/opportunity-by-ageb?cve_mun=${encodeURIComponent(cveMun)}&target_scian=${encodeURIComponent(scian.join(","))}&order_by=pobtot&limit=100`,
      TTL.opportunity,
    );
  }

  /** Colonia labels living inside one AGEB (for jargon-free zone naming). */
  coloniasByAgeb(cvegeo: string): Promise<ColoniasByAgebResult> {
    return this.fetchJson(
      `/analytics/colonias-by-ageb?cvegeo=${encodeURIComponent(cvegeo)}`,
      TTL.colonias,
    );
  }

  /**
   * Point → AGEB (upstream ST_Contains). Returns null when no polygon
   * contains the point (upstream 404 resolve.no_ageb) — that's a normal
   * outcome for e.g. open country, not an error. Coords rounded to 5
   * decimals (~1m) for a stable cache key.
   */
  async resolveAgeb(
    lat: number,
    lon: number,
  ): Promise<ResolveAgebResult | null> {
    const latS = lat.toFixed(5);
    const lonS = lon.toFixed(5);
    try {
      return await this.fetchJson<ResolveAgebResult>(
        `/resolve/ageb?lat=${latS}&lon=${lonS}`,
        TTL.resolve,
      );
    } catch (err) {
      if (err instanceof UpstreamError && err.status === 404) return null;
      throw err;
    }
  }

  riskSummary(entidad: string): Promise<RiskSummaryResult> {
    return this.fetchJson(
      `/analytics/risk-summary?entidad=${encodeURIComponent(entidad)}`,
      TTL.risk,
    );
  }
}
