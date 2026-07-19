# Uncharted Lite

Self-serve, low-ticket site-selection for Mexican micro-entrepreneurs — the
person about to open their first farmacia, tiendita, or ferretería. Consumer
long-tail spin-off of the EurekaMS Territory Ops pillar, shipped under its own
brand, **Uncharted**.

**Demo (Phase 1, live data):** <https://lite-demo.187.77.25.101.nip.io/> —
temporary nip.io host; the product will ship on its own commercial domain.

Two modes, one funnel:

- **Explore** ("no sé dónde abrir") — free. Pick a giro + city, get zones
  ranked by opportunity from live DENUE/Censo/CONEVAL/SESNSP data.
- **Validate** ("ya tengo un local en mente") — the paid moment. Pick a giro +
  colonia, get the verdict _before signing the lease_. Verdict + competition
  factor free; full report (demand, buying power, risk, recommendation) gated
  per giro ($199–$349 MXN).

The verdict is a semáforo — **Va / Aguas / Mejor no** — a signal, not false
precision. Zero jargon: the user never sees "AGEB" or "SCIAN".

## Architecture

```
browser ── https ── Caddy (lite-demo.…nip.io, overwrites X-Forwarded-For)
                      │
                      ▼
        BFF  (Hono, 127.0.0.1:8096, tsx)          ← this repo, src/
        · holds the upstream X-Api-Key (.env — never reaches the client)
        · exposes ONLY cooked endpoints, serves the built SPA
        · per-IP rate limits: 30/min general, 10/min verdict, 6/min explore
        · semáforo thresholds + verdict engine live here, server-side
                      │
                      ▼
        México Uncharted API (eurekamd-denue-analysis, 127.0.0.1:3030)
        · DENUE 6.1M establishments × Censo × CONEVAL × SESNSP …
```

Security stance mirrors `intelligence-ops-mcp`: bounded read-only surface,
never pass-through. Raw warehouse rows never cross the wire — the competitor
count and the semáforo do. **Coverage is national** (operator ruling
2026-07-19: all 32 estados, every municipio; the original single-metro gate
is gone) — the scrape gates are the per-IP rate limits, the cooked-endpoint
boundary, and Explore's bounded label-lookup budget (≤20 upstream lookups per
cold municipio, cached 1h).

## BFF surface (everything the browser can reach)

| Route                 | Params                     | Returns                                                                                                           |
| --------------------- | -------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `GET /api/health`     | —                          | liveness                                                                                                          |
| `GET /api/giros`      | —                          | `{id,label,emoji,precio}` — no SCIAN, no tuning                                                                   |
| `GET /api/estados`    | —                          | all 32 states, all active                                                                                         |
| `GET /api/municipios` | `estado`                   | every municipio of the estado (nameless noise rows dropped)                                                       |
| `GET /api/colonias`   | `municipio`                | colonia names (top 200 by activity; small-town relief floor for rural munis)                                      |
| `GET /api/verdict`    | `giro, municipio, colonia` | semáforo + 4 factors + recommendation (colonia grain)                                                             |
| `GET /api/explore`    | `giro, municipio`          | top 12 zones — AGEB grain aggregated per colonia label, with `habitantes`; colonia-grain fallback for rural munis |

Unknown `/api/*` → JSON 404. Everything else serves the SPA (`web/dist`).

## Verdict engine (Phase 1 grains — labeled honestly in the UI)

- **Competencia** (colonia): `target_count` from `opportunity-by-colonia`.
  Saturation is relative to what each giro tolerates (`tolerancia` in
  `src/giros.ts`), not a flat per-competitor penalty.
- **Gente y demanda** (zona): colonia activity percentile within the municipio.
  In Explore's AGEB path this upgrades to real Censo population percentile.
- **Poder de compra** (ciudad): CONEVAL `pobreza_pct`, weighted per giro
  (`pesoPoder`). In Explore's AGEB path this upgrades to zone-grain CONEVAL
  rezago social (5 ordinal levels, labeled "en la zona").
- **Riesgo** (ciudad): SESNSP per-1k percentile within the entidad. Displayed
  as a factor but deliberately NOT in the score — muni-grain risk is constant
  across every zone of a city, so it would shift the whole distribution
  without changing any ranking. Revisit with zone-grain risk in Phase 2.
- **Honesty rule in code:** 0 competitors can never produce verde (caps at 62,
  "campo libre") — an empty field can mean nobody wants that giro there.

Thresholds: verde ≥66, amber ≥42 — one place, `src/engine.ts`.

## Giro → SCIAN config

One module: `src/giros.ts` — adding a giro touches no UI logic. Codes verified
against live DENUE `clase_actividad_id` (2026-07-19):

| Giro                    | SCIAN clase     | National count  |
| ----------------------- | --------------- | --------------- |
| Farmacia                | 464111 + 464112 | 65,694 + 13,138 |
| Tiendita / Abarrotes    | 461110          | 661,511         |
| Ferretería / Tlapalería | 467111          | 73,284          |
| Papelería               | 465311          | 129,051         |
| Cafetería               | 722515          | 81,283          |
| Estética / Salón        | 812110          | 295,942         |

## Setup

```bash
npm install && (cd web && npm install)
cp env.example .env         # fill UNCHARTED_API_KEY (upstream X-Api-Key)
(cd web && npm run build)   # SPA → web/dist, served by the BFF
npm run serve               # 127.0.0.1:8096 (must run from repo root)
```

Tests / typecheck:

```bash
npx tsc --noEmit && (cd web && npx tsc --noEmit)
npx vitest run src/engine.test.ts src/rate-limit.test.ts src/upstream.test.ts src/server.test.ts
```

Dev: `npm run dev` (BFF) + `cd web && npm run dev` (Vite on 5173, proxies `/api`).

## Deploy (VPS)

- systemd: `ops/uncharted-lite.service` → `systemctl restart uncharted-lite`,
  logs `journalctl -u uncharted-lite -f`. tsx runtime — source edits take
  effect on restart; **rebuild `web/dist` for frontend changes**.
- Caddy: `ops/Caddyfile.lite-demo` (appended to `/etc/caddy/Caddyfile`).
  The `header_up X-Forwarded-For {remote_host}` overwrite is load-bearing:
  the BFF rate limiter keys on the last XFF hop and assumes exactly one
  trusted proxy. Keep it when moving to the commercial domain.

## Known Phase-1 limitations (accepted)

- **Paywall is client-side only.** The full report crosses the wire on
  `/api/verdict`; DevTools reveals it. Server-side gating arrives with
  payments (out of scope this pass) — the endpoint split is ready for it.
- **Explore vs Validate grain gap.** Explore scores a colonia label from the
  aggregate of its populous AGEBs (Censo population + rezago); Validate
  scores the whole colonia from DENUE activity + muni-grain poder. Tapping
  through can shift the score/luz — both readings are true at their grain.
  Converges when Validate resolves to AGEB (Phase 2, below).
- **In Validate, poder/riesgo are muni-grain.** Zone-grain arrives with the
  AGEB resolve (below). Riesgo is muni-grain everywhere.
- **Explore's AGEB view covers a muni's top-100 AGEBs by population** —
  upstream's per-request cap. Smaller zones surface via the colonia
  fallback and Validate.
- **Zone labels are DENUE free text.** Cancún surfaces zones named "41"
  etc. — real (its colonias are numbered supermanzanas) but reads broken as
  a bare label. A per-metro label rule ("Supermanzana 41") is deliberately
  NOT generalized: numeric colonia names elsewhere aren't supermanzanas.
- **Cold Explore latency ~5–10s per municipio+giro** (AGEB fan-out on an
  empty cache; 1h TTL after). National readiness sweep 2026-07-19: colonia
  pickers populated in all 8 sampled metros (68–200 entries), Explore
  returned 12 AGEB-grain zones in all 4 sampled cities.

## Phase 2 backend dependency: `/resolve/ageb` — ✅ SHIPPED 2026-07-19

Live on `eurekamd-denue-analysis` (commit `047c848`), authenticated like every
other upstream route:

```
GET /resolve/ageb?lat=&lon=          (X-Api-Key)
→ ST_Contains point-in-polygon against ageb_polygons (81,451 polygons, GIST)
→ { lat, lon, cvegeo, ambito: "Urbana"|"Rural", cve_mun }
→ 400 outside Mexico's bbox · 404 resolve.no_ageb when no polygon contains
  the point · Cache-Control 24h
```

Verified live: Ángel de la Independencia → `0901500010930` / `09015` (145ms);
a Chapalita point correctly lands in `14120` (Zapopan side of the border).

What remains for Phase 2 is the **geocoder** in front of it: self-hosted
Nominatim with a Mexico OSM extract (≈$0/call); Google Geocoding ($5/1k) only
as a paid-flow fallback if accuracy demands it. Then Validate resolves
addresses → AGEB and the Explore/Validate grain gap closes.

## Repo layout

```
src/         BFF (Hono + tsx): config, giros, upstream client, engine, rate limit, server
web/         Vite + React 18 + Tailwind SPA (brand system in web/src/index.css)
prototype/   v2 single-file HTML prototype that defined UX/copy (kept as spec)
ops/         systemd unit + Caddy block snapshots
```
