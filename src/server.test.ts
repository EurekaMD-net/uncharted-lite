import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BffConfig } from "./config.js";
import { makeApp } from "./server.js";
import { LIMITS, RateLimiter } from "./rate-limit.js";
import type { Upstream } from "./upstream.js";
import { UpstreamError } from "./upstream.js";

const CONFIG: BffConfig = {
  port: 0,
  upstreamUrl: "http://up.test",
  upstreamApiKey: "k",
  webDist: "./web/dist",
};

/** Colonia fixtures: activity spread so percentiles are meaningful. */
const OPP_ROWS = [
  { colonia: "CENTRO", target_count: 9, total_estab: 900, score: 100 },
  { colonia: "AMERICANA", target_count: 3, total_estab: 700, score: 233.33 },
  { colonia: "PROVIDENCIA", target_count: 1, total_estab: 500, score: 500 },
  { colonia: "SIN FARMACIAS", target_count: 0, total_estab: 300, score: null },
  { colonia: "CHIQUITA", target_count: 0, total_estab: 5, score: null }, // below MIN_ACTIVIDAD
  { colonia: null, target_count: 2, total_estab: 100, score: 50 },
];

function makeUpstreamMock(): Upstream {
  return {
    entidades: vi.fn(async () => ({
      entidades: [
        { clave: "09", nombre: "Ciudad de México" },
        { clave: "14", nombre: "Jalisco" },
      ],
    })),
    municipios: vi.fn(async () => ({
      entidad: "14",
      municipios: [
        {
          cve_mun: "14039",
          municipio: "Guadalajara",
          poblacion: 1385629,
          establecimientos: 100000,
          pobreza_pct: 20.5,
          irs_grado: "Muy bajo",
        },
        {
          cve_mun: "14120",
          municipio: "Zapopan",
          poblacion: 1476491,
          establecimientos: 90000,
          pobreza_pct: 18.2,
          irs_grado: "Muy bajo",
        },
      ],
    })),
    colonias: vi.fn(async () => ({
      cve_mun: "14039",
      colonias: [
        { colonia: "AMERICANA", num_establecimientos: 700 },
        { colonia: "CENTRO", num_establecimientos: 900 },
        { colonia: "CHIQUITA", num_establecimientos: 5 },
      ],
    })),
    opportunityByColonia: vi.fn(async () => ({
      cve_mun: "14039",
      colonias: OPP_ROWS,
    })),
    riskSummary: vi.fn(async () => ({
      entidad: "14",
      municipios: [
        { cve_mun: "14039", delitos_per_1k_pop: 30 },
        { cve_mun: "14120", delitos_per_1k_pop: 20 },
        { cve_mun: "14098", delitos_per_1k_pop: 40 },
      ],
    })),
  } as unknown as Upstream;
}

function makeTestApp(upstream = makeUpstreamMock()) {
  // Generous limiters so route tests never trip 429 accidentally.
  const limiters = {
    general: new RateLimiter({ windowMs: 60_000, max: 10_000 }),
    verdict: new RateLimiter({ windowMs: 60_000, max: 10_000 }),
  };
  return { app: makeApp({ config: CONFIG, upstream, limiters }), upstream };
}

describe("GET /api/estados", () => {
  it("cooks upstream entidades with activo flags", async () => {
    const { app } = makeTestApp();
    const res = await app.request("/api/estados");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    const jalisco = body.estados.find(
      (e: { clave: string }) => e.clave === "14",
    );
    const cdmx = body.estados.find((e: { clave: string }) => e.clave === "09");
    expect(jalisco.activo).toBe(true);
    expect(cdmx.activo).toBe(false);
  });
});

describe("GET /api/municipios", () => {
  it("validates estado", async () => {
    const { app } = makeTestApp();
    expect((await app.request("/api/municipios?estado=99")).status).toBe(400);
    expect((await app.request("/api/municipios")).status).toBe(400);
  });

  it("returns proximamente for inactive estados WITHOUT hitting upstream", async () => {
    const { app, upstream } = makeTestApp();
    const res = await app.request("/api/municipios?estado=09");
    const body = await res.json();
    expect(body.proximamente).toBe(true);
    expect(body.municipios).toEqual([]);
    expect(upstream.municipios).not.toHaveBeenCalled();
  });

  it("cooks municipios for active estado with activo flags, sorted", async () => {
    const { app } = makeTestApp();
    const body = await (await app.request("/api/municipios?estado=14")).json();
    expect(body.municipios.map((m: { nombre: string }) => m.nombre)).toEqual([
      "Guadalajara",
      "Zapopan",
    ]);
    expect(body.municipios[0].activo).toBe(true);
    expect(body.municipios[1].activo).toBe(false);
  });
});

describe("GET /api/colonias", () => {
  it("validates municipio and gates inactive ones", async () => {
    const { app, upstream } = makeTestApp();
    expect((await app.request("/api/colonias?municipio=abc")).status).toBe(400);
    const body = await (
      await app.request("/api/colonias?municipio=14120")
    ).json();
    expect(body.proximamente).toBe(true);
    expect(upstream.colonias).not.toHaveBeenCalled();
  });

  it("returns alphabetized names, dropping low-activity noise", async () => {
    const { app } = makeTestApp();
    const body = await (
      await app.request("/api/colonias?municipio=14039")
    ).json();
    expect(body.colonias).toEqual(["AMERICANA", "CENTRO"]); // CHIQUITA filtered
  });
});

describe("GET /api/verdict", () => {
  it("validates giro, municipio, colonia", async () => {
    const { app } = makeTestApp();
    expect(
      (await app.request("/api/verdict?giro=nope&municipio=14039&colonia=X"))
        .status,
    ).toBe(400);
    expect(
      (
        await app.request(
          "/api/verdict?giro=farmacia&municipio=14120&colonia=X",
        )
      ).status,
    ).toBe(403);
    expect(
      (await app.request("/api/verdict?giro=farmacia&municipio=14039&colonia="))
        .status,
    ).toBe(400);
  });

  it("returns a cooked verdict with all four factors and no raw rows", async () => {
    const { app } = makeTestApp();
    const res = await app.request(
      "/api/verdict?giro=farmacia&municipio=14039&colonia=americana",
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.lugar).toEqual({
      municipio: "14039",
      municipioNombre: "Guadalajara",
      colonia: "AMERICANA",
    });
    expect(body.veredicto.palabra).toMatch(/Va|Aguas|Mejor no/);
    for (const f of ["competencia", "gente", "poder", "riesgo"] as const) {
      expect(body.veredicto[f].nivel).toBeGreaterThanOrEqual(0);
      expect(body.veredicto[f].frase).toBeTruthy();
    }
    // raw establishment rows must never cross the wire
    expect(JSON.stringify(body)).not.toContain("total_estab");
    expect(JSON.stringify(body)).not.toContain("target_scian");
  });

  it("404s honestly for a colonia without enough activity", async () => {
    const { app } = makeTestApp();
    const res = await app.request(
      "/api/verdict?giro=farmacia&municipio=14039&colonia=CHIQUITA",
    );
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toMatch(/suficiente actividad/);
  });

  it("survives a risk-summary outage with neutral riesgo", async () => {
    const upstream = makeUpstreamMock();
    (upstream.riskSummary as ReturnType<typeof vi.fn>).mockRejectedValue(
      new UpstreamError("boom", 502),
    );
    const { app } = makeTestApp(upstream);
    const res = await app.request(
      "/api/verdict?giro=farmacia&municipio=14039&colonia=AMERICANA",
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.veredicto.riesgo.frase).toMatch(/tómalo con reserva/);
  });

  it("502s cooked when the core opportunity call fails", async () => {
    const upstream = makeUpstreamMock();
    (
      upstream.opportunityByColonia as ReturnType<typeof vi.fn>
    ).mockRejectedValue(new UpstreamError("down", 500));
    const { app } = makeTestApp(upstream);
    const res = await app.request(
      "/api/verdict?giro=farmacia&municipio=14039&colonia=AMERICANA",
    );
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.error).toMatch(/no están disponibles/);
  });
});

describe("GET /api/explore", () => {
  it("returns ranked zones sorted by score, capped, without raw rows", async () => {
    const { app } = makeTestApp();
    const res = await app.request("/api/explore?giro=farmacia&municipio=14039");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.municipioNombre).toBe("Guadalajara");
    const scores = body.zonas.map((z: { score: number }) => z.score);
    expect([...scores].sort((a: number, b: number) => b - a)).toEqual(scores);
    // null-colonia and below-threshold rows excluded
    const names = body.zonas.map((z: { colonia: string }) => z.colonia);
    expect(names).not.toContain("CHIQUITA");
    expect(names).not.toContain(null);
    // greenfield zone is present but flagged, never verde
    const green = body.zonas.find((z: { comp: number }) => z.comp === 0);
    expect(green.luz).not.toBe("verde");
  });

  it("gates inactive municipios", async () => {
    const { app } = makeTestApp();
    expect(
      (await app.request("/api/explore?giro=cafe&municipio=14120")).status,
    ).toBe(403);
  });
});

describe("rate limiting", () => {
  it("429s the verdict bucket after its limit, general endpoints unaffected", async () => {
    const upstream = makeUpstreamMock();
    const limiters = {
      general: new RateLimiter(LIMITS.general),
      verdict: new RateLimiter({ windowMs: 60_000, max: 2 }),
    };
    const app = makeApp({ config: CONFIG, upstream, limiters });
    const q = "/api/explore?giro=farmacia&municipio=14039";
    expect((await app.request(q)).status).toBe(200);
    expect((await app.request(q)).status).toBe(200);
    expect((await app.request(q)).status).toBe(429);
    expect((await app.request("/api/giros")).status).toBe(200);
  });

  it("buckets by X-Forwarded-For client", async () => {
    const upstream = makeUpstreamMock();
    const limiters = {
      general: new RateLimiter(LIMITS.general),
      verdict: new RateLimiter({ windowMs: 60_000, max: 1 }),
    };
    const app = makeApp({ config: CONFIG, upstream, limiters });
    const q = "/api/explore?giro=farmacia&municipio=14039";
    const asIp = (ip: string) =>
      app.request(q, { headers: { "x-forwarded-for": ip } });
    expect((await asIp("1.1.1.1")).status).toBe(200);
    expect((await asIp("1.1.1.1")).status).toBe(429);
    expect((await asIp("2.2.2.2")).status).toBe(200);
  });
});

describe("GET /api/giros", () => {
  it("exposes UI fields only — no SCIAN codes or engine tuning", async () => {
    const { app } = makeTestApp();
    const body = await (await app.request("/api/giros")).json();
    expect(body.giros).toHaveLength(6);
    const farmacia = body.giros.find(
      (g: { id: string }) => g.id === "farmacia",
    );
    expect(farmacia).toEqual({
      id: "farmacia",
      label: "Farmacia",
      emoji: "💊",
      precio: 349,
    });
    expect(JSON.stringify(body)).not.toContain("464111");
    expect(JSON.stringify(body)).not.toContain("tolerancia");
  });
});

describe("unknown /api paths", () => {
  it("returns JSON 404, never the SPA fallback", async () => {
    const { app } = makeTestApp();
    const res = await app.request("/api/nope");
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.ok).toBe(false);
  });
});

describe("GET /api/health", () => {
  it("responds ok", async () => {
    const { app } = makeTestApp();
    const body = await (await app.request("/api/health")).json();
    expect(body.ok).toBe(true);
  });
});

beforeEach(() => {
  vi.restoreAllMocks();
});
