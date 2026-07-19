/**
 * Verdict engine — semáforo normalization lives HERE, server-side, so the
 * threshold logic exists in exactly one place and the client stays dumb.
 *
 * Phase-1 factor grains (honest about granularity, labeled in the response):
 *  - competencia: colonia grain (opportunity-by-colonia target_count)
 *  - gente y demanda: colonia activity percentile within the municipio
 *  - poder de compra: municipio grain (CONEVAL pobreza_pct)
 *  - riesgo: municipio grain (SESNSP delitos_per_1k percentile in entidad)
 *
 * Honesty rule, in code not copy: 0 competitors can NEVER produce verde —
 * greenfield caps at 62 ("Aguas") because an empty field can mean nobody
 * wants that giro there.
 */
import type { GiroConfig } from "./giros.js";

export type Luz = "verde" | "amber" | "roja";
export type Grain = "colonia" | "zona" | "ciudad";

export interface Factor {
  nivel: number; // 0-100 for the display bar
  frase: string;
  grain: Grain;
}

export interface Veredicto {
  luz: Luz;
  palabra: string;
  sub: string;
  score: number;
  campoLibre: boolean;
  competencia: Factor;
  gente: Factor;
  poder: Factor;
  riesgo: Factor;
  recomendacion: string;
}

export interface EngineInput {
  giro: GiroConfig;
  /** Competitors of the target giro in the colonia. */
  comp: number;
  /** Colonia total activity percentile within the municipio (0-100). */
  actividadPercentil: number;
  /** Municipio CONEVAL poverty %, null when the join has no row. */
  pobrezaPct: number | null;
  /** Municipio crime per-1k percentile within its entidad (0-100), null = no data. */
  riesgoPercentil: number | null;
}

export const VEREDICTO_META: Record<Luz, { palabra: string; sub: string }> = {
  verde: { palabra: "Va", sub: "Buena zona para este negocio" },
  amber: { palabra: "Aguas", sub: "Se puede, pero con cuidado" },
  roja: { palabra: "Mejor no", sub: "La zona juega en tu contra" },
};

const GREENFIELD_CAP = 62; // just under the verde threshold (66)
const VERDE_MIN = 66;
const AMBER_MIN = 42;

type Tercil = "Alta" | "Media" | "Baja";
type RiesgoNivel = "Bajo" | "Medio" | "Alto";

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function tercilGente(percentil: number): Tercil {
  return percentil >= 66 ? "Alta" : percentil >= 33 ? "Media" : "Baja";
}

/** Higher percentile = more crime than sibling municipios. */
function nivelRiesgo(percentil: number | null): RiesgoNivel {
  if (percentil === null) return "Medio"; // neutral when SESNSP has no row
  return percentil >= 66 ? "Alto" : percentil >= 33 ? "Medio" : "Bajo";
}

export function fraseComp(giroLabel: string, comp: number): string {
  const n = giroLabel.toLowerCase();
  if (comp === 0)
    return `No hay ninguna ${n} cerca. El campo está libre — puede ser oportunidad o señal de que ahí no se busca.`;
  if (comp <= 2)
    return `Solo hay ${comp} cerca. Poca competencia: espacio para entrar.`;
  if (comp <= 5)
    return `Hay ${comp} cerca. Competencia media — tendrás que diferenciarte.`;
  return `Hay ${comp} cerca. La zona está saturada — cuesta más ganarse al cliente.`;
}

function fraseGente(t: Tercil): string {
  return {
    Alta: "Mucha gente pasa y vive por aquí.",
    Media: "Movimiento de gente moderado.",
    Baja: "Poca gente en la zona — el flujo es bajo.",
  }[t];
}

function frasePoder(pobrezaPct: number | null): string {
  if (pobrezaPct === null)
    return "No tenemos el dato fino de poder de compra para esta ciudad — tómalo con reserva.";
  if (pobrezaPct <= 25) return "El poder de compra de la zona es alto.";
  if (pobrezaPct <= 45) return "El poder de compra es medio.";
  return "El poder de compra es bajo — la gente cuida cada peso.";
}

function fraseRiesgo(nivel: RiesgoNivel, sinDato: boolean): string {
  if (sinDato)
    return "No tenemos el dato de incidencia para esta ciudad — tómalo con reserva.";
  return {
    Bajo: "La zona es tranquila comparada con el resto del estado.",
    Medio:
      "La zona tiene incidencia media — como buena parte del estado. Vale asegurar el local.",
    Alto: "La incidencia en la zona es alta. Considera el costo de seguridad y seguro en tus números.",
  }[nivel];
}

function recomendacion(luz: Luz, campoLibre: boolean): string {
  if (campoLibre)
    return "Nadie ha puesto un negocio como el tuyo aquí. Eso puede ser una mina — o una señal de que la demanda no da. Antes de firmar, párate en la zona un martes y un sábado y cuenta cuánta gente pasa. Si el flujo es real, serías el primero y eso vale mucho.";
  if (luz === "verde")
    return "Los números te acompañan: buena demanda y competencia manejable. Es una zona donde vale la pena entrar. Aun así, camina el local en distintos horarios antes de firmar.";
  if (luz === "amber")
    return "Se puede, pero no es terreno fácil. Vas a necesitar algo que te distinga de los que ya están — precio, horario, servicio o surtido. Si no tienes ese diferencial claro, piénsalo dos veces.";
  return "Los números juegan en tu contra en esta zona. No es imposible, pero estás empezando cuesta arriba. Antes de firmar, compara con otras colonias — probablemente encuentres mejor mano en otro lado.";
}

/** Map CONEVAL poverty % to a 0-100 "buying power" bar (50 = neutral fallback). */
function nivelPoder(pobrezaPct: number | null): number {
  if (pobrezaPct === null) return 50;
  return clamp(Math.round(100 - pobrezaPct * 1.6), 2, 98);
}

export function evaluar(input: EngineInput): Veredicto {
  const { giro, comp, actividadPercentil, pobrezaPct, riesgoPercentil } = input;

  const saturacion = Math.min(100, (comp / giro.tolerancia) * 62);
  const gentePercentil = clamp(Math.round(actividadPercentil), 2, 98);
  const poderNivel = nivelPoder(pobrezaPct);
  const riesgo = nivelRiesgo(riesgoPercentil);
  const riesgoNivelBar =
    riesgoPercentil === null
      ? 50
      : clamp(Math.round(100 - riesgoPercentil), 2, 98);

  const demanda =
    gentePercentil * (1 - giro.pesoPoder) + poderNivel * giro.pesoPoder;

  // Riesgo does NOT enter the score in Phase 1: the signal is muni-grain,
  // so within a city it is constant across every zone — subtracting it
  // would shift the whole distribution down without changing any ranking
  // (it made verde unreachable city-wide in Guadalajara). It surfaces as a
  // displayed factor instead; the brief lists riesgo as report context,
  // not a verdict driver. Revisit when Phase 2 brings zone-grain risk.
  let score = Math.round(clamp(demanda - saturacion * 0.55, 2, 98));
  let campoLibre = false;
  if (comp === 0 && score > GREENFIELD_CAP) {
    score = GREENFIELD_CAP;
    campoLibre = true;
  }
  const luz: Luz =
    score >= VERDE_MIN ? "verde" : score >= AMBER_MIN ? "amber" : "roja";

  return {
    luz,
    palabra: VEREDICTO_META[luz].palabra,
    sub: VEREDICTO_META[luz].sub,
    score,
    campoLibre,
    competencia: {
      nivel: clamp(Math.round(100 - saturacion), 0, 100),
      frase: fraseComp(giro.label, comp),
      grain: "colonia",
    },
    gente: {
      nivel: gentePercentil,
      frase: fraseGente(tercilGente(gentePercentil)),
      grain: "zona",
    },
    poder: {
      nivel: poderNivel,
      frase: frasePoder(pobrezaPct),
      grain: "ciudad",
    },
    riesgo: {
      nivel: riesgoNivelBar,
      frase: fraseRiesgo(riesgo, riesgoPercentil === null),
      grain: "ciudad",
    },
    // Greenfield copy keys on comp===0 alone (not the score-capped flag):
    // an uncapped zero-competitor zone must never get "distínguete de los
    // que ya están" — there is nobody to out-compete.
    recomendacion: recomendacion(luz, comp === 0),
  };
}

/**
 * Percentile (0-100) of `value` within `values` — share of values strictly
 * below it. Empty list → 50 (neutral).
 */
export function percentil(value: number, values: number[]): number {
  if (values.length === 0) return 50;
  const below = values.filter((v) => v < value).length;
  return (below / values.length) * 100;
}
