/**
 * Giro → SCIAN config. The single place giros are defined — UI copy, pricing,
 * engine tuning, and the SCIAN clase codes the opportunity engine targets.
 * Codes verified against live DENUE `clase_actividad_id` 2026-07-19 (the
 * label column has ~1-3% scramble noise; the id column is the reliable key).
 *
 * The UI never sees `scian` — the BFF keeps it server-side (zero jargon).
 */
export interface GiroConfig {
  id: string;
  label: string;
  emoji: string;
  /** Full-report price in MXN — per giro, higher-capital giros pay more. */
  precio: number;
  /** SCIAN clase codes (6-digit) passed as target_scian upstream. */
  scian: string[];
  /**
   * Competitors a zone comfortably sustains — saturation is measured
   * relative to this, not as a flat per-competitor penalty.
   */
  tolerancia: number;
  /** Weight of buying power vs foot traffic in demand (0..1). */
  pesoPoder: number;
}

export const GIROS: Record<string, GiroConfig> = {
  farmacia: {
    id: "farmacia",
    label: "Farmacia",
    emoji: "💊",
    precio: 349,
    scian: ["464111", "464112"],
    tolerancia: 5,
    pesoPoder: 0.6,
  },
  abarrotes: {
    id: "abarrotes",
    label: "Tiendita / Abarrotes",
    emoji: "🛒",
    precio: 199,
    scian: ["461110"],
    tolerancia: 12,
    pesoPoder: 0.35,
  },
  ferreteria: {
    id: "ferreteria",
    label: "Ferretería",
    emoji: "🔧",
    precio: 299,
    scian: ["467111"],
    tolerancia: 4,
    pesoPoder: 0.45,
  },
  papeleria: {
    id: "papeleria",
    label: "Papelería",
    emoji: "✏️",
    precio: 199,
    scian: ["465311"],
    tolerancia: 5,
    pesoPoder: 0.4,
  },
  cafe: {
    id: "cafe",
    label: "Cafetería",
    emoji: "☕",
    precio: 249,
    scian: ["722515"],
    tolerancia: 9,
    pesoPoder: 0.6,
  },
  estetica: {
    id: "estetica",
    label: "Estética / Salón",
    emoji: "💈",
    precio: 199,
    scian: ["812110"],
    tolerancia: 8,
    pesoPoder: 0.5,
  },
};

/** Public projection for the UI — no SCIAN, no engine tuning. */
export function girosPublic() {
  return Object.values(GIROS).map(({ id, label, emoji, precio }) => ({
    id,
    label,
    emoji,
    precio,
  }));
}
