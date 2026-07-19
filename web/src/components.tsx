import type { Factor, Luz } from "./api";

export const LUZ_COLOR: Record<Luz, string> = {
  verde: "var(--jade)",
  amber: "var(--amber)",
  roja: "var(--brick)",
};

export function Semaforo({ luz, palabra }: { luz: Luz; palabra: string }) {
  return (
    <div className="semaforo" role="img" aria-label={`Semáforo: ${palabra}`}>
      <span className={`luz roja ${luz === "roja" ? "on" : ""}`} />
      <span className={`luz amber ${luz === "amber" ? "on" : ""}`} />
      <span className={`luz verde ${luz === "verde" ? "on" : ""}`} />
    </div>
  );
}

const GRAIN_LABEL: Record<Factor["grain"], string> = {
  colonia: "en tu colonia",
  zona: "en la zona",
  ciudad: "en tu ciudad",
};

function colorNivel(n: number): string {
  return n >= 66 ? "var(--jade)" : n >= 42 ? "var(--amber)" : "var(--brick)";
}

export function FactorBar({
  nombre,
  factor,
  sufijo,
}: {
  nombre: string;
  factor: Factor;
  sufijo?: string;
}) {
  return (
    <div className="factor">
      <div className="head">
        <span className="name">
          {nombre}
          {sufijo ? ` · ${sufijo}` : ""}
        </span>
        <span className="grain">{GRAIN_LABEL[factor.grain]}</span>
      </div>
      <div className="bar-track">
        <div
          className="bar-fill"
          style={{
            width: `${factor.nivel}%`,
            background: colorNivel(factor.nivel),
          }}
        />
      </div>
      <p style={{ margin: 0, fontSize: 16, lineHeight: 1.5 }}>{factor.frase}</p>
    </div>
  );
}

export function Cargando({ msg }: { msg: string }) {
  return (
    <div
      role="status"
      style={{ color: "var(--ink-soft)", fontSize: 15, padding: "8px 2px" }}
    >
      {msg}
    </div>
  );
}

export function ErrorNota({ msg }: { msg: string }) {
  return (
    <div
      role="alert"
      className="aviso"
      style={{ borderLeft: "3px solid var(--brick)" }}
    >
      {msg}
    </div>
  );
}
