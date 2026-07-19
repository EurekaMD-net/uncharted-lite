/**
 * Uncharted Lite BFF — the only thing the public browser talks to.
 *
 * Security stance (mirrors intelligence-ops-mcp: bounded tools, not open
 * access): the upstream X-Api-Key lives only here; only cooked endpoints
 * are exposed; the cascade is bounded to launched metros; verdicts cross
 * the wire, warehouse rows don't.
 */
import { Hono } from "hono";
import { serveStatic } from "@hono/node-server/serve-static";
import type { BffConfig } from "./config.js";
import {
  CVE_MUN_RE,
  ENTIDAD_RE,
  ESTADOS_ACTIVOS,
  MUNICIPIOS_ACTIVOS,
} from "./config.js";
import { GIROS, girosPublic } from "./giros.js";
import { evaluar, percentil, type Veredicto } from "./engine.js";
import type { OpportunityColoniaRow, Upstream } from "./upstream.js";
import { UpstreamError } from "./upstream.js";
import { clientIp, LIMITS, RateLimiter } from "./rate-limit.js";

/** Colonias with fewer establishments than this are statistical noise. */
const MIN_ACTIVIDAD = 25;
const EXPLORE_TOP = 12;

export interface ServerDeps {
  config: BffConfig;
  upstream: Upstream;
  limiters?: { general: RateLimiter; verdict: RateLimiter };
}

interface ColoniaKeyed extends OpportunityColoniaRow {
  colonia: string;
}

function normalizeColonia(raw: string): string {
  return raw.trim().toUpperCase();
}

export function makeApp({ config, upstream, limiters }: ServerDeps): Hono {
  const general = limiters?.general ?? new RateLimiter(LIMITS.general);
  const verdict = limiters?.verdict ?? new RateLimiter(LIMITS.verdict);
  const app = new Hono();

  // Periodic prune so idle IPs don't accumulate. Unref'd: never keeps the
  // process alive.
  const pruneTimer = setInterval(() => {
    general.prune();
    verdict.prune();
  }, 5 * 60_000);
  pruneTimer.unref?.();

  app.use("/api/*", async (c, next) => {
    const ip = clientIp(c.req.header("x-forwarded-for"));
    const isVerdict =
      c.req.path === "/api/verdict" || c.req.path === "/api/explore";
    const limiter = isVerdict ? verdict : general;
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
    c.header("Cache-Control", "public, max-age=3600");
    return c.json({
      ok: true,
      estados: entidades.map((e) => ({
        clave: e.clave,
        nombre: e.nombre,
        activo: ESTADOS_ACTIVOS.has(e.clave),
      })),
    });
  });

  app.get("/api/municipios", async (c) => {
    const estado = c.req.query("estado") ?? "";
    if (!ENTIDAD_RE.test(estado)) {
      return c.json({ ok: false, error: "estado inválido" }, 400);
    }
    // Cascade is bounded to launched estados — no warehouse fan-out.
    if (!ESTADOS_ACTIVOS.has(estado)) {
      return c.json({ ok: true, municipios: [], proximamente: true });
    }
    const { municipios } = await upstream.municipios(estado);
    c.header("Cache-Control", "public, max-age=3600");
    return c.json({
      ok: true,
      municipios: municipios
        .map((m) => ({
          cve: m.cve_mun,
          nombre: m.municipio,
          activo: MUNICIPIOS_ACTIVOS.has(m.cve_mun),
        }))
        .sort((a, b) => a.nombre.localeCompare(b.nombre, "es")),
    });
  });

  app.get("/api/colonias", async (c) => {
    const municipio = c.req.query("municipio") ?? "";
    if (!CVE_MUN_RE.test(municipio)) {
      return c.json({ ok: false, error: "municipio inválido" }, 400);
    }
    if (!MUNICIPIOS_ACTIVOS.has(municipio)) {
      return c.json({ ok: true, colonias: [], proximamente: true });
    }
    const { colonias } = await upstream.colonias(municipio);
    c.header("Cache-Control", "public, max-age=3600");
    return c.json({
      ok: true,
      colonias: colonias
        .filter((col) => col.num_establecimientos >= MIN_ACTIVIDAD)
        .map((col) => col.colonia)
        .sort((a, b) => a.localeCompare(b, "es")),
    });
  });

  interface VerdictContext {
    rows: ColoniaKeyed[];
    actividadValues: number[];
    pobrezaPct: number | null;
    municipioNombre: string;
    riesgoPercentil: number | null;
  }

  /** Shared data assembly for verdict + explore (all upstream calls cached). */
  async function verdictContext(
    giroId: string,
    cveMun: string,
  ): Promise<VerdictContext> {
    const giro = GIROS[giroId]!;
    const entidad = cveMun.slice(0, 2);
    const [opp, munis, risk] = await Promise.all([
      upstream.opportunityByColonia(cveMun, giro.scian),
      upstream.municipios(entidad),
      upstream.riskSummary(entidad).catch((err) => {
        // Risk layer is optional context — a SESNSP outage must not take
        // down verdicts. Engine treats null as neutral and says so.
        console.error(`[bff] risk-summary unavailable: ${err}`);
        return null;
      }),
    ]);

    const rows: ColoniaKeyed[] = opp.colonias
      .filter((r): r is ColoniaKeyed => !!r.colonia)
      .filter((r) => r.total_estab >= MIN_ACTIVIDAD);
    const actividadValues = rows.map((r) => r.total_estab);

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

    return {
      rows,
      actividadValues,
      pobrezaPct,
      municipioNombre,
      riesgoPercentil,
    };
  }

  function validateGiroMuni(
    giroId: string,
    municipio: string,
  ): { ok: true } | { ok: false; error: string; status: 400 | 403 } {
    if (!GIROS[giroId])
      return { ok: false, error: "giro inválido", status: 400 };
    if (!CVE_MUN_RE.test(municipio))
      return { ok: false, error: "municipio inválido", status: 400 };
    if (!MUNICIPIOS_ACTIVOS.has(municipio))
      return {
        ok: false,
        error: "Esta ciudad aún no está disponible — próximamente.",
        status: 403,
      };
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
    const ctx = await verdictContext(giroId, municipio);
    const row = ctx.rows.find((r) => normalizeColonia(r.colonia) === colonia);
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
      actividadPercentil: percentil(row.total_estab, ctx.actividadValues),
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

  app.get("/api/explore", async (c) => {
    const giroId = c.req.query("giro") ?? "";
    const municipio = c.req.query("municipio") ?? "";
    const gate = validateGiroMuni(giroId, municipio);
    if (!gate.ok) return c.json({ ok: false, error: gate.error }, gate.status);

    const giro = GIROS[giroId]!;
    const ctx = await verdictContext(giroId, municipio);
    const zonas = ctx.rows
      .map((row) => {
        const v = evaluar({
          giro,
          comp: row.target_count,
          actividadPercentil: percentil(row.total_estab, ctx.actividadValues),
          pobrezaPct: ctx.pobrezaPct,
          riesgoPercentil: ctx.riesgoPercentil,
        });
        return {
          colonia: row.colonia,
          score: v.score,
          luz: v.luz,
          palabra: v.palabra,
          comp: row.target_count,
          campoLibre: v.campoLibre,
          gente:
            v.gente.nivel >= 66
              ? "alta"
              : v.gente.nivel >= 33
                ? "media"
                : "baja",
          // 66/33 bands — must match engine nivelRiesgo so the explore chip
          // and the verdict card never contradict on identical muni data.
          riesgo:
            v.riesgo.nivel >= 66
              ? "bajo"
              : v.riesgo.nivel >= 33
                ? "medio"
                : "alto",
        };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, EXPLORE_TOP);

    c.header("Cache-Control", "public, max-age=300");
    return c.json({
      ok: true,
      municipioNombre: ctx.municipioNombre,
      zonas,
    });
  });

  // Unknown /api/* paths are JSON 404s — they must never fall through to
  // the SPA and hand the client HTML with a 200.
  app.all("/api/*", (c) => c.json({ ok: false, error: "no encontrado" }, 404));

  // SPA: everything that isn't /api/* serves the built web app; unknown
  // paths fall back to index.html (hash routing lives client-side).
  app.use("*", serveStatic({ root: config.webDist }));
  app.get("*", serveStatic({ root: config.webDist, path: "index.html" }));

  return app;
}
