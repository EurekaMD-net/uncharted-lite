# Uncharted Lite

Self-serve, low-ticket site-selection tool for Mexican micro-entrepreneurs — the
person about to open their first farmacia, tiendita, or ferretería. Consumer
long-tail spin-off of the EurekaMS Territory Ops pillar; ships under its own
brand, **Uncharted** (sister to EurekaMS).

Two modes, one funnel:

- **Explore** ("no sé dónde abrir") — free. Pick a giro + area, get a ranked
  list of zones by opportunity.
- **Validate** ("ya tengo un local en mente") — the paid moment. Pick a giro +
  location, get the verdict _before signing the lease_. Verdict + competition
  factor free; full report (demand, buying power, risk, recommendation) paid
  per giro.

The verdict is a semáforo — **Va / Aguas / Mejor no** — a signal, not false
precision. Zero jargon: the user never sees "AGEB" or "SCIAN".

## Status

**Prototype stage.** `prototype/uncharted-lite-v2.html` is a self-contained
single-file demo (open in any browser) that defines UX, brand, copy, and the
funnel with demo data for Guadalajara. Demo data objects mirror the shape the
real BFF will serve, so wiring is a drop-in.

Phase 1 (next): Vite + React + Tailwind app plus a thin Hono BFF that holds the
`X-Api-Key` for the México Uncharted backend
([`eurekamd-denue-analysis`](https://github.com/EurekaMD-net/eurekamd-denue-analysis),
live at `uncharted.eurekamd.cloud`), exposes only cooked endpoints (location
cascade, giro list, verdict), and normalizes verdicts to the semáforo
server-side. Raw warehouse rows never reach the browser.

## Giro → SCIAN map (verified against live DENUE, 2026-07-19)

| Giro                    | SCIAN clase     | National count  |
| ----------------------- | --------------- | --------------- |
| Farmacia                | 464111 + 464112 | 65,694 + 13,138 |
| Tiendita / Abarrotes    | 461110          | 661,511         |
| Ferretería / Tlapalería | 467111          | 73,284          |
| Papelería               | 465311          | 129,051         |
| Cafetería               | 722515          | 81,283          |
| Estética / Salón        | 812110          | 295,942         |

## Backend dependency (Phase 2)

Free-text address validation needs a new backend endpoint on
`eurekamd-denue-analysis`:

```
GET /resolve/ageb?lat=&lon=
→ ST_Contains point-in-polygon against ageb_polygons (81,451 polygons)
→ { cvegeo, ambito, cve_mun }
```

Colonia is a free-text label in DENUE (no geometry), so it can drive menus but
never point-in-polygon — address resolution must land on AGEB.
