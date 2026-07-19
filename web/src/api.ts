/** Typed client for the Lite BFF — the only network surface the app has. */

export interface Giro {
  id: string;
  label: string;
  emoji: string;
  precio: number;
}

export interface Estado {
  clave: string;
  nombre: string;
  activo: boolean;
}

export interface Municipio {
  cve: string;
  nombre: string;
  activo: boolean;
}

export interface Factor {
  nivel: number;
  frase: string;
  grain: "colonia" | "zona" | "ciudad";
}

export type Luz = "verde" | "amber" | "roja";

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

export interface VerdictResponse {
  ok: true;
  giro: Giro;
  lugar: { municipio: string; municipioNombre: string; colonia: string };
  veredicto: Veredicto;
}

export interface Zona {
  colonia: string;
  /** Zone population (rounded to hundreds) when the AGEB path served it. */
  habitantes: number | null;
  score: number;
  luz: Luz;
  palabra: string;
  comp: number;
  campoLibre: boolean;
  gente: "alta" | "media" | "baja";
  riesgo: "bajo" | "medio" | "alto";
}

export interface ExploreResponse {
  ok: true;
  municipioNombre: string;
  zonas: Zona[];
}

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(path);
  const body = (await res.json().catch(() => null)) as
    (T & { ok: boolean; error?: string }) | null;
  if (!res.ok || !body || body.ok === false) {
    throw new ApiError(
      body?.error ?? "Algo salió mal. Intenta de nuevo.",
      res.status,
    );
  }
  return body;
}

export const api = {
  giros: () => get<{ giros: Giro[] }>("/api/giros"),
  estados: () => get<{ estados: Estado[] }>("/api/estados"),
  municipios: (estado: string) =>
    get<{ municipios: Municipio[]; proximamente?: boolean }>(
      `/api/municipios?estado=${encodeURIComponent(estado)}`,
    ),
  colonias: (municipio: string) =>
    get<{ colonias: string[]; proximamente?: boolean }>(
      `/api/colonias?municipio=${encodeURIComponent(municipio)}`,
    ),
  verdict: (giro: string, municipio: string, colonia: string) =>
    get<VerdictResponse>(
      `/api/verdict?giro=${encodeURIComponent(giro)}&municipio=${encodeURIComponent(municipio)}&colonia=${encodeURIComponent(colonia)}`,
    ),
  explore: (giro: string, municipio: string) =>
    get<ExploreResponse>(
      `/api/explore?giro=${encodeURIComponent(giro)}&municipio=${encodeURIComponent(municipio)}`,
    ),
};
