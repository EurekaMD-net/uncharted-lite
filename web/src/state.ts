/**
 * App state ↔ URL hash. Back button works and verdicts are shareable;
 * the unlocked (paid) state is deliberately NOT serialized.
 */
export type Modo = "explorar" | "validar" | null;

export interface AppState {
  modo: Modo;
  giro: string | null;
  estado: string;
  municipio: string;
  colonia: string | null;
  /** Free-text address (Validate Phase 2). Mutually exclusive with colonia. */
  direccion: string | null;
}

export const DEFAULT_ESTADO = "14";
export const DEFAULT_MUNICIPIO = "14039";

export function readHash(hash: string): AppState {
  const p = new URLSearchParams(hash.replace(/^#/, ""));
  const m = p.get("m");
  return {
    modo: m === "explorar" || m === "validar" ? m : null,
    giro: p.get("g"),
    estado: p.get("e") ?? DEFAULT_ESTADO,
    municipio: p.get("mu") ?? DEFAULT_MUNICIPIO,
    colonia: p.get("z"),
    direccion: p.get("d"),
  };
}

export function writeHash(s: AppState): string {
  const p = new URLSearchParams();
  if (s.modo) p.set("m", s.modo);
  if (s.giro) p.set("g", s.giro);
  if (s.estado !== DEFAULT_ESTADO) p.set("e", s.estado);
  if (s.municipio !== DEFAULT_MUNICIPIO) p.set("mu", s.municipio);
  if (s.colonia) p.set("z", s.colonia);
  if (s.direccion) p.set("d", s.direccion);
  const q = p.toString();
  return q ? `#${q}` : "";
}
