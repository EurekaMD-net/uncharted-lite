import { describe, expect, it } from "vitest";
import { evaluar, fraseComp, percentil, type EngineInput } from "./engine.js";
import { GIROS } from "./giros.js";

const farmacia = GIROS.farmacia!;
const abarrotes = GIROS.abarrotes!;

function input(overrides: Partial<EngineInput> = {}): EngineInput {
  return {
    giro: farmacia,
    comp: 3,
    actividadPercentil: 70,
    pobrezaPct: 25,
    riesgoPercentil: 40,
    ...overrides,
  };
}

describe("evaluar", () => {
  it("returns a score clamped to 2..98", () => {
    const worst = evaluar(
      input({
        comp: 50,
        actividadPercentil: 0,
        pobrezaPct: 80,
        riesgoPercentil: 99,
      }),
    );
    expect(worst.score).toBeGreaterThanOrEqual(2);
    const best = evaluar(
      input({
        comp: 1,
        actividadPercentil: 100,
        pobrezaPct: 5,
        riesgoPercentil: 1,
      }),
    );
    expect(best.score).toBeLessThanOrEqual(98);
  });

  it("greenfield (0 competitors) can never be verde — caps at 62 amber", () => {
    const v = evaluar(
      input({
        comp: 0,
        actividadPercentil: 99,
        pobrezaPct: 5,
        riesgoPercentil: 1,
      }),
    );
    expect(v.score).toBe(62);
    expect(v.luz).toBe("amber");
    expect(v.campoLibre).toBe(true);
    expect(v.recomendacion).toMatch(/serías el primero/);
  });

  it("greenfield with weak demand stays roja and is NOT flagged campoLibre-capped", () => {
    const v = evaluar(
      input({
        comp: 0,
        actividadPercentil: 5,
        pobrezaPct: 70,
        riesgoPercentil: 90,
      }),
    );
    expect(v.luz).toBe("roja");
    expect(v.campoLibre).toBe(false);
  });

  it("uncapped amber greenfield still gets campo-libre copy, never 'out-compete rivals'", () => {
    // score lands in [42,62] without hitting the cap: campoLibre=false but
    // there are zero rivals — the recommendation must not tell the user to
    // differentiate from competitors that don't exist.
    const v = evaluar(
      input({ comp: 0, actividadPercentil: 50, pobrezaPct: 40 }),
    );
    expect(v.luz).toBe("amber");
    expect(v.campoLibre).toBe(false);
    expect(v.recomendacion).toMatch(/serías el primero/);
    expect(v.recomendacion).not.toMatch(/los que ya están/);
  });

  it("saturation is relative to giro tolerance — same comp punishes farmacia more than abarrotes", () => {
    const f = evaluar(input({ giro: farmacia, comp: 6 }));
    const a = evaluar(input({ giro: abarrotes, comp: 6 }));
    expect(a.score).toBeGreaterThan(f.score);
  });

  it("riesgo surfaces as a factor but does not shift the score (muni-grain in Phase 1)", () => {
    const calm = evaluar(input({ riesgoPercentil: 10 }));
    const hot = evaluar(input({ riesgoPercentil: 90 }));
    expect(calm.score).toBe(hot.score);
    expect(calm.riesgo.nivel).toBeGreaterThan(hot.riesgo.nivel);
    expect(hot.riesgo.frase).toMatch(/incidencia en la zona es alta/);
  });

  it("missing pobreza/riesgo data degrades to neutral with honest frases", () => {
    const v = evaluar(input({ pobrezaPct: null, riesgoPercentil: null }));
    expect(v.poder.nivel).toBe(50);
    expect(v.riesgo.nivel).toBe(50);
    expect(v.poder.frase).toMatch(/tómalo con reserva/);
    expect(v.riesgo.frase).toMatch(/tómalo con reserva/);
  });

  it("zone-grain rezago replaces muni pobreza for poder and relabels the grain", () => {
    const conRezago = evaluar(
      input({ rezagoGrado: "Muy alto", pobrezaPct: 10 }),
    );
    expect(conRezago.poder.nivel).toBe(15); // rezago wins over the rosy muni signal
    expect(conRezago.poder.grain).toBe("zona");
    expect(conRezago.poder.frase).toMatch(/cuida cada peso/);
    const sinRezago = evaluar(input({ rezagoGrado: null, pobrezaPct: 10 }));
    expect(sinRezago.poder.grain).toBe("ciudad");
    const rezagoBueno = evaluar(
      input({ rezagoGrado: "Muy bajo", pobrezaPct: 80 }),
    );
    expect(rezagoBueno.poder.nivel).toBe(85);
  });

  it("labels factor grains honestly", () => {
    const v = evaluar(input());
    expect(v.competencia.grain).toBe("colonia");
    expect(v.gente.grain).toBe("zona");
    expect(v.poder.grain).toBe("ciudad");
    expect(v.riesgo.grain).toBe("ciudad");
  });

  it("thresholds: verde ≥66, amber ≥42, roja below", () => {
    const verde = evaluar(
      input({
        comp: 1,
        actividadPercentil: 95,
        pobrezaPct: 10,
        riesgoPercentil: 5,
      }),
    );
    expect(verde.luz).toBe("verde");
    expect(verde.palabra).toBe("Va");
    const roja = evaluar(
      input({
        comp: 20,
        actividadPercentil: 10,
        pobrezaPct: 70,
        riesgoPercentil: 95,
      }),
    );
    expect(roja.luz).toBe("roja");
    expect(roja.palabra).toBe("Mejor no");
  });
});

describe("fraseComp", () => {
  it("covers the four competition bands", () => {
    expect(fraseComp("Farmacia", 0)).toMatch(/campo está libre/);
    expect(fraseComp("Farmacia", 2)).toMatch(/Poca competencia/);
    expect(fraseComp("Farmacia", 4)).toMatch(/Competencia media/);
    expect(fraseComp("Farmacia", 9)).toMatch(/saturada/);
  });
});

describe("percentil", () => {
  it("computes share of values strictly below", () => {
    expect(percentil(5, [1, 2, 3, 4, 6, 7, 8, 9, 10, 11])).toBe(40);
    expect(percentil(1, [1, 2, 3])).toBe(0);
    expect(percentil(99, [1, 2, 3])).toBeCloseTo(100);
  });

  it("returns neutral 50 for an empty list", () => {
    expect(percentil(10, [])).toBe(50);
  });
});
