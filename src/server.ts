/**
 * Uncharted Lite BFF — the only thing the public browser talks to.
 *
 * Security stance (mirrors intelligence-ops-mcp: bounded tools, not open
 * access): the upstream X-Api-Key lives only here; only cooked endpoints
 * are exposed; verdicts cross the wire, warehouse rows don't. Coverage is
 * national — rate limits are the scrape gate.
 */
import { Hono } from "hono";
import { serveStatic } from "@hono/node-server/serve-static";
import type { BffConfig } from "./config.js";
import { CVE_MUN_RE, ENTIDAD_RE } from "./config.js";
import { GIROS, girosPublic } from "./giros.js";
import { evaluar, isRezagoGrado, percentil, type Veredicto } from "./engine.js";
import type { OpportunityColoniaRow, Upstream } from "./upstream.js";
import { UpstreamError } from "./upstream.js";
import { clientIp, LIMITS, RateLimiter } from "./rate-limit.js";
import { Geocoder, GeocoderBusyError } from "./geocoder.js";

/** Colonias with fewer establishments than this are statistical noise. */
const MIN_ACTIVIDAD = 25;
/**
 * Small-town relief: when a municipio has NOTHING above the primary floor
 * (rural pueblos), drop to this floor instead of serving an empty cascade —
 * a tiendita in a pueblo is exactly a target user. Below 5 establishments a
 * "competition" signal is meaningless, so that stays the hard minimum.
 */
const MIN_ACTIVIDAD_RURAL = 5;

function conActividad<T>(rows: T[], actividad: (r: T) => number): T[] {
  const primary = rows.filter((r) => actividad(r) >= MIN_ACTIVIDAD);
  if (primary.length > 0) return primary;
  return rows.filter((r) => actividad(r) >= MIN_ACTIVIDAD_RURAL);
}
const EXPLORE_TOP = 12;
/** AGEBs below this population are non-residential noise (industrial, etc.). */
const MIN_POBTOT_AGEB = 400;
/** How many top-scored AGEBs we try to label before giving up on 12 zones. */
const MAX_LABEL_LOOKUPS = 20;
/** Fewer labeled AGEB zones than this → fall back to colonia-grain explore. */
const MIN_AGEB_ZONES = 3;

export interface ServerDeps {
  config: BffConfig;
  upstream: Upstream;
  geocoder?: Geocoder;
  limiters?: {
    general: RateLimiter;
    verdict: RateLimiter;
    explore?: RateLimiter;
  };
}

interface ColoniaKeyed extends OpportunityColoniaRow {
  colonia: string;
}

function normalizeColonia(raw: string): string {
  return raw.trim().toUpperCase();
}

export function makeApp({
  config,
  upstream,
  geocoder,
  limiters,
}: ServerDeps): Hono {
  const general = limiters?.general ?? new RateLimiter(LIMITS.general);
  const verdict = limiters?.verdict ?? new RateLimiter(LIMITS.verdict);
  const explore = limiters?.explore ?? new RateLimiter(LIMITS.explore);
  const geo =
    geocoder ??
    new Geocoder({
      url: config.nominatimUrl,
      userAgent: config.nominatimUserAgent,
    });
  const app = new Hono();

  // Periodic prune so idle IPs don't accumulate. Unref'd: never keeps the
  // process alive.
  const pruneTimer = setInterval(() => {
    general.prune();
    verdict.prune();
    explore.prune();
  }, 5 * 60_000);
  pruneTimer.unref?.();

  app.use("/api/*", async (c, next) => {
    const ip = clientIp(c.req.header("x-forwarded-for"));
    const limiter =
      c.req.path === "/api/explore"
        ? explore
        : c.req.path === "/api/verdict" ||
            c.req.path === "/api/verdict-direccion"
          ? verdict
          : general;
    if (!limiter.allow(ip)) {
      return c.json(
        { ok: false, error: "Demasiadas consultas. Espera un momento." },
        429,
      );
    }
    await next();
  });

  app.onError((err, c) => {
    if (err instanceof UpstreamError) {
      console.error(`[bff] upstream error: ${err.message}`);
      return c.json(
        {
          ok: false,
          error: "Los datos no están disponibles ahora. Intenta en un momento.",
        },
        502,
      );
    }
    console.error("[bff] unhandled:", err);
    return c.json({ ok: false, error: "Error interno." }, 500);
  });

  app.get("/api/health", (c) =>
    c.json({ ok: true, service: "uncharted-lite-bff" }),
  );

  app.get("/api/giros", (c) => {
    c.header("Cache-Control", "public, max-age=3600");
    return c.json({ ok: true, giros: girosPublic() });
  });

  app.get("/api/estados", async (c) => {
    const { entidades } = await upstream.entidades();
    // 5 min, not 1h: activo flags gate the whole cascade client-side, and a
    // stale hour kept browsers on the old single-metro coverage after the
    // national open (observed 2026-07-19).
    c.header("Cache-Control", "public, max-age=300");
    return c.json({
      ok: true,
      estados: entidades.map((e) => ({
        clave: e.clave,
        nombre: e.nombre,
        activo: true,
      })),
    });
  });

  app.get("/api/municipios", async (c) => {
    const estado = c.req.query("estado") ?? "";
    if (!ENTIDAD_RE.test(estado)) {
      return c.json({ ok: false, error: "estado inválido" }, 400);
    }
    const { municipios } = await upstream.municipios(estado);
    c.header("Cache-Control", "public, max-age=3600");
    return c.json({
      ok: true,
      // Nameless rows are warehouse noise (e.g. cve 19999, DENUE's
      // "municipio unspecified" bucket) — never a pickable place.
      municipios: municipios
        .filter((m): m is typeof m & { municipio: string } =>
          Boolean(m.municipio),
        )
        .map((m) => ({
          cve: m.cve_mun,
          nombre: m.municipio,
          activo: true,
        }))
        .sort((a, b) => a.nombre.localeCompare(b.nombre, "es")),
    });
  });

  app.get("/api/colonias", async (c) => {
    const municipio = c.req.query("municipio") ?? "";
    if (!CVE_MUN_RE.test(municipio)) {
      return c.json({ ok: false, error: "municipio inválido" }, 400);
    }
    const { colonias } = await upstream.colonias(municipio);
    c.header("Cache-Control", "public, max-age=3600");
    return c.json({
      ok: true,
      colonias: conActividad(colonias, (col) => col.num_establecimientos)
        .map((col) => col.colonia)
        .sort((a, b) => a.localeCompare(b, "es")),
    });
  });

  interface MuniContext {
    pobrezaPct: number | null;
    municipioNombre: string;
    riesgoPercentil: number | null;
  }

  /** Muni-grain context (poder + riesgo), both upstream calls cached. */
  async function muniContext(cveMun: string): Promise<MuniContext> {
    const entidad = cveMun.slice(0, 2);
    const [munis, risk] = await Promise.all([
      upstream.municipios(entidad),
      upstream.riskSummary(entidad).catch((err) => {
        // Risk layer is optional context — a SESNSP outage must not take
        // down verdicts. Engine treats null as neutral and says so.
        console.error(`[bff] risk-summary unavailable: ${err}`);
        return null;
      }),
    ]);

    const muni = munis.municipios.find((m) => m.cve_mun === cveMun);
    const pobrezaPct = muni?.pobreza_pct ?? null;
    const municipioNombre = muni?.municipio ?? "";

    let riesgoPercentil: number | null = null;
    if (risk) {
      const perOnes = risk.municipios
        .map((m) => m.delitos_per_1k_pop)
        .filter((v): v is number => v !== null);
      const mine = risk.municipios.find(
        (m) => m.cve_mun === cveMun,
      )?.delitos_per_1k_pop;
      if (mine != null && perOnes.length > 0) {
        riesgoPercentil = percentil(mine, perOnes);
      }
    }

    return { pobrezaPct, municipioNombre, riesgoPercentil };
  }

  /** Colonia-grain rows (verdict + explore fallback). Cached upstream. */
  async function coloniaRows(
    giroId: string,
    cveMun: string,
  ): Promise<{ rows: ColoniaKeyed[]; actividadValues: number[] }> {
    const giro = GIROS[giroId]!;
    const opp = await upstream.opportunityByColonia(cveMun, giro.scian);
    const rows: ColoniaKeyed[] = conActividad(
      opp.colonias.filter((r): r is ColoniaKeyed => !!r.colonia),
      (r) => r.total_estab,
    );
    return { rows, actividadValues: rows.map((r) => r.total_estab) };
  }

  function validateGiroMuni(
    giroId: string,
    municipio: string,
  ): { ok: true } | { ok: false; error: string; status: 400 } {
    if (!GIROS[giroId])
      return { ok: false, error: "giro inválido", status: 400 };
    if (!CVE_MUN_RE.test(municipio))
      return { ok: false, error: "municipio inválido", status: 400 };
    return { ok: true };
  }

  app.get("/api/verdict", async (c) => {
    const giroId = c.req.query("giro") ?? "";
    const municipio = c.req.query("municipio") ?? "";
    const colonia = normalizeColonia(c.req.query("colonia") ?? "");
    const gate = validateGiroMuni(giroId, municipio);
    if (!gate.ok) return c.json({ ok: false, error: gate.error }, gate.status);
    if (!colonia) return c.json({ ok: false, error: "colonia requerida" }, 400);

    const giro = GIROS[giroId]!;
    const [ctx, { rows, actividadValues }] = await Promise.all([
      muniContext(municipio),
      coloniaRows(giroId, municipio),
    ]);
    const row = rows.find((r) => normalizeColonia(r.colonia) === colonia);
    if (!row) {
      return c.json(
        {
          ok: false,
          error:
            "No tenemos suficiente actividad registrada en esa colonia para darte un veredicto honesto.",
        },
        404,
      );
    }

    const veredicto: Veredicto = evaluar({
      giro,
      comp: row.target_count,
      actividadPercentil: percentil(row.total_estab, actividadValues),
      pobrezaPct: ctx.pobrezaPct,
      riesgoPercentil: ctx.riesgoPercentil,
    });

    c.header("Cache-Control", "public, max-age=300");
    return c.json({
      ok: true,
      giro: {
        id: giro.id,
        label: giro.label,
        emoji: giro.emoji,
        precio: giro.precio,
      },
      lugar: {
        municipio,
        municipioNombre: ctx.municipioNombre,
        colonia: row.colonia,
      },
      veredicto,
    });
  });

  /**
   * Address-based Validate (Phase 2): free-text dirección → Nominatim →
   * upstream /resolve/ageb → AGEB-grain verdict (zone-level competencia,
   * real population percentile, zone rezago). Falls back to the colonia-
   * grain verdict via the AGEB's colonia label when the AGEB isn't in the
   * muni's top-100-by-population set. Every miss is an honest, distinct
   * message — never a fabricated verdict.
   */
  app.get("/api/verdict-direccion", async (c) => {
    const giroId = c.req.query("giro") ?? "";
    const direccion = (c.req.query("direccion") ?? "").trim();
    // Optional scoping from the pickers — improves geocoding accuracy.
    const municipio = c.req.query("municipio") ?? "";
    if (!GIROS[giroId])
      return c.json({ ok: false, error: "giro inválido" }, 400);
    if (direccion.length < 5 || direccion.length > 160) {
      return c.json(
        {
          ok: false,
          error: "Escribe la dirección con calle y número (5-160 caracteres).",
        },
        400,
      );
    }

    const giro = GIROS[giroId]!;

    // Compose the geocode query with picker names when provided.
    let scope = "";
    let scopeCtx: Awaited<ReturnType<typeof muniContext>> | null = null;
    if (CVE_MUN_RE.test(municipio)) {
      scopeCtx = await muniContext(municipio).catch(() => null);
      if (scopeCtx?.municipioNombre) scope = `, ${scopeCtx.municipioNombre}`;
    }
    let busy = false;
    const geoResult = await geo
      .search(`${direccion}${scope}, México`)
      .catch((err) => {
        busy = err instanceof GeocoderBusyError;
        if (!busy) console.error(`[bff] geocoder error: ${err}`);
        return undefined; // distinct from null = "searched, no match"
      });
    if (geoResult === undefined) {
      // Queue-full fails fast (503) instead of holding the connection for
      // minutes behind the 1 req/s global drain (audit W1).
      return c.json(
        {
          ok: false,
          error: busy
            ? "Hay muchas búsquedas de dirección en este momento. Intenta en unos segundos, o elige tu colonia en la lista."
            : "El buscador de direcciones no está disponible ahora. Intenta en un momento, o elige tu colonia en la lista.",
        },
        busy ? 503 : 502,
      );
    }
    if (geoResult === null) {
      return c.json(
        {
          ok: false,
          error:
            "No encontramos esa dirección. Revisa calle y número, o elige tu colonia en la lista.",
        },
        404,
      );
    }

    const resolved = await upstream.resolveAgeb(geoResult.lat, geoResult.lon);
    if (!resolved) {
      return c.json(
        {
          ok: false,
          error:
            "Encontramos la dirección, pero cae fuera de las zonas censadas que cubrimos. Elige tu colonia en la lista.",
        },
        404,
      );
    }

    const cveMun = resolved.cve_mun;
    const [agebs, ctx, label] = await Promise.all([
      upstream.opportunityByAgeb(cveMun, giro.scian),
      // Reuse the scoping context when the address resolved into the same
      // municipio the picker named (audit I1) — the common case.
      scopeCtx && municipio === cveMun
        ? Promise.resolve(scopeCtx)
        : muniContext(cveMun),
      // colonias[0] is the DOMINANT colonia — upstream orders by
      // COUNT(*) DESC. Its spelling exactly matches opportunity-by-colonia
      // rows: all three endpoints derive UPPER(TRIM(colonia)) from the same
      // establecimientos column, so the exact match below cannot drift
      // (audit W3/I3 — verified against upstream SQL, do not accent-fold:
      // folding would falsely merge distinct colonias like PEÑA/PENA).
      upstream
        .coloniasByAgeb(resolved.cvegeo)
        .then((r) => r.colonias[0]?.colonia ?? null)
        .catch(() => null),
    ]);

    const rows = agebs.agebs.filter((a) => a.pobtot !== null);
    const row = rows.find((a) => a.cvegeo === resolved.cvegeo);

    let veredicto: Veredicto | null = null;
    let grano: "zona" | "colonia" = "zona";
    if (row) {
      veredicto = evaluar({
        giro,
        comp: row.target_count,
        actividadPercentil: percentil(
          row.pobtot!,
          rows.map((a) => a.pobtot!),
        ),
        pobrezaPct: ctx.pobrezaPct,
        riesgoPercentil: ctx.riesgoPercentil,
        rezagoGrado: isRezagoGrado(row.rezago_grado) ? row.rezago_grado : null,
        competenciaGrain: "zona",
      });
    } else if (label) {
      // AGEB outside the top-100-by-population set: degrade honestly to
      // the colonia-grain verdict via the AGEB's colonia label.
      grano = "colonia";
      const { rows: cRows, actividadValues } = await coloniaRows(
        giroId,
        cveMun,
      );
      const cRow = cRows.find(
        (r) => normalizeColonia(r.colonia) === normalizeColonia(label),
      );
      if (cRow) {
        veredicto = evaluar({
          giro,
          comp: cRow.target_count,
          actividadPercentil: percentil(cRow.total_estab, actividadValues),
          pobrezaPct: ctx.pobrezaPct,
          riesgoPercentil: ctx.riesgoPercentil,
        });
      }
    }
    if (!veredicto) {
      return c.json(
        {
          ok: false,
          error:
            "Ubicamos tu dirección, pero la zona no tiene suficiente actividad registrada para un veredicto honesto.",
        },
        404,
      );
    }

    c.header("Cache-Control", "public, max-age=300");
    return c.json({
      ok: true,
      giro: {
        id: giro.id,
        label: giro.label,
        emoji: giro.emoji,
        precio: giro.precio,
      },
      lugar: {
        municipio: cveMun,
        municipioNombre: ctx.municipioNombre,
        colonia: label ?? "tu zona",
        direccion: geoResult.displayName,
        grano,
      },
      veredicto,
    });
  });

  app.get("/api/explore", async (c) => {
    const giroId = c.req.query("giro") ?? "";
    const municipio = c.req.query("municipio") ?? "";
    const gate = validateGiroMuni(giroId, municipio);
    if (!gate.ok) return c.json({ ok: false, error: gate.error }, gate.status);

    const giro = GIROS[giroId]!;
    const ctx = await muniContext(municipio);

    // AGEB-first: real population per competitor + zone-grain rezago. The
    // cvegeo never crosses the wire — zones are labeled with colonia names
    // (zero jargon). Falls back to colonia-grain when the muni's AGEBs are
    // too few/unlabeled (small rural municipios). The colonia dataset is
    // only fetched on that fallback path (audit: no wasted upstream call).
    const agebZonas = await exploreAgebZonas(giro.id, municipio, ctx).catch(
      (err) => {
        console.error(`[bff] AGEB explore failed, colonia fallback: ${err}`);
        return null;
      },
    );

    let zonas: ZonaOut[];
    if (agebZonas && agebZonas.length >= MIN_AGEB_ZONES) {
      zonas = agebZonas;
    } else {
      const { rows, actividadValues } = await coloniaRows(giroId, municipio);
      zonas = rows
        .map((row) => {
          const v = evaluar({
            giro,
            comp: row.target_count,
            actividadPercentil: percentil(row.total_estab, actividadValues),
            pobrezaPct: ctx.pobrezaPct,
            riesgoPercentil: ctx.riesgoPercentil,
          });
          return toZona(v, row.colonia, row.target_count, null);
        })
        .sort((a, b) => b.score - a.score)
        .slice(0, EXPLORE_TOP);
    }

    c.header("Cache-Control", "public, max-age=300");
    return c.json({
      ok: true,
      municipioNombre: ctx.municipioNombre,
      zonas,
    });
  });

  interface ZonaOut {
    colonia: string;
    habitantes: number | null;
    score: number;
    luz: Veredicto["luz"];
    palabra: string;
    comp: number;
    campoLibre: boolean;
    gente: "alta" | "media" | "baja";
    riesgo: "bajo" | "medio" | "alto";
  }

  function toZona(
    v: Veredicto,
    colonia: string,
    comp: number,
    habitantes: number | null,
  ): ZonaOut {
    return {
      colonia,
      habitantes,
      score: v.score,
      luz: v.luz,
      palabra: v.palabra,
      comp,
      campoLibre: v.campoLibre,
      gente:
        v.gente.nivel >= 66 ? "alta" : v.gente.nivel >= 33 ? "media" : "baja",
      // 66/33 bands — same cut points as engine nivelRiesgo so the RIESGO
      // chip never contradicts the verdict card (both are muni-grain). The
      // overall score/luz can still differ between Explore (AGEB aggregate)
      // and Validate (whole colonia) — that grain gap is documented.
      riesgo:
        v.riesgo.nivel >= 66 ? "bajo" : v.riesgo.nivel >= 33 ? "medio" : "alto",
    };
  }

  async function exploreAgebZonas(
    giroId: string,
    cveMun: string,
    ctx: { pobrezaPct: number | null; riesgoPercentil: number | null },
  ): Promise<ZonaOut[]> {
    const giro = GIROS[giroId]!;
    const { agebs } = await upstream.opportunityByAgeb(cveMun, giro.scian);
    const rows = agebs.filter(
      (a) => a.pobtot !== null && a.pobtot >= MIN_POBTOT_AGEB,
    );
    if (rows.length === 0) return [];

    const pobValues = rows.map((a) => a.pobtot!);
    // Provisional per-AGEB scores only pick WHICH AGEBs to label — the
    // published zone score is computed on the label-level aggregate below.
    const scored = rows
      .map((a) => ({
        ageb: a,
        provisional: evaluar({
          giro,
          comp: a.target_count,
          actividadPercentil: percentil(a.pobtot!, pobValues),
          pobrezaPct: ctx.pobrezaPct,
          riesgoPercentil: ctx.riesgoPercentil,
          rezagoGrado: isRezagoGrado(a.rezago_grado) ? a.rezago_grado : null,
        }).score,
      }))
      .sort((a, b) => b.provisional - a.provisional);

    // Label lookups happen in two batches (audit: fan-out budget). The
    // typical request labels EXPLORE_TOP AGEBs; the second batch only runs
    // when dedupe/unlabeled rows leave fewer than EXPLORE_TOP zones.
    const fetchLabels = (batch: typeof scored) =>
      Promise.all(
        batch.map(({ ageb }) =>
          upstream
            .coloniasByAgeb(ageb.cvegeo)
            .then((r) => r.colonias[0]?.colonia ?? null)
            .catch(() => null),
        ),
      );
    const firstBatch = scored.slice(0, EXPLORE_TOP);
    let labeled = firstBatch.map((s, i) => ({ ...s, i }));
    let labels = await fetchLabels(firstBatch);
    const uniqueLabels = new Set(labels.filter(Boolean));
    if (uniqueLabels.size < EXPLORE_TOP) {
      const second = scored.slice(EXPLORE_TOP, MAX_LABEL_LOOKUPS);
      const secondLabels = await fetchLabels(second);
      labeled = labeled.concat(
        second.map((s, i) => ({ ...s, i: EXPLORE_TOP + i })),
      );
      labels = labels.concat(secondLabels);
    }

    // Aggregate per colonia label BEFORE scoring (audit: keeping only the
    // best single AGEB per label was one-directionally optimistic vs the
    // colonia-wide verdict the user lands on when they tap through).
    // Aggregate = the colonia's populous AGEBs among the candidates:
    // competitors and population sum; rezago comes from the largest AGEB.
    interface Agg {
      comp: number;
      pobtot: number;
      rezagoOfLargest: string | null;
      largestPob: number;
    }
    const porLabel = new Map<string, Agg>();
    for (let i = 0; i < labeled.length; i++) {
      const label = labels[i];
      if (!label) continue;
      const a = labeled[i]!.ageb;
      const agg = porLabel.get(label) ?? {
        comp: 0,
        pobtot: 0,
        rezagoOfLargest: null,
        largestPob: -1,
      };
      agg.comp += a.target_count;
      agg.pobtot += a.pobtot!;
      if (a.pobtot! > agg.largestPob) {
        agg.largestPob = a.pobtot!;
        agg.rezagoOfLargest = a.rezago_grado;
      }
      porLabel.set(label, agg);
    }

    const zonas: ZonaOut[] = [];
    for (const [label, agg] of porLabel) {
      const v = evaluar({
        giro,
        comp: agg.comp,
        actividadPercentil: percentil(agg.pobtot, pobValues),
        pobrezaPct: ctx.pobrezaPct,
        riesgoPercentil: ctx.riesgoPercentil,
        rezagoGrado: isRezagoGrado(agg.rezagoOfLargest)
          ? agg.rezagoOfLargest
          : null,
      });
      zonas.push(
        toZona(v, label, agg.comp, Math.round(agg.pobtot / 100) * 100),
      );
    }
    return zonas.sort((a, b) => b.score - a.score).slice(0, EXPLORE_TOP);
  }

  // Unknown /api/* paths are JSON 404s — they must never fall through to
  // the SPA and hand the client HTML with a 200.
  app.all("/api/*", (c) => c.json({ ok: false, error: "no encontrado" }, 404));

  // SPA: everything that isn't /api/* serves the built web app; unknown
  // paths fall back to index.html (hash routing lives client-side).
  app.use("*", serveStatic({ root: config.webDist }));
  app.get("*", serveStatic({ root: config.webDist, path: "index.html" }));

  return app;
}
