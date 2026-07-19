import { useEffect, useRef, useState } from "react";
import { api, type Estado, type Giro, type Municipio, type Zona } from "./api";
import { useAsync } from "./hooks";
import {
  Cargando,
  ErrorNota,
  FactorBar,
  LUZ_COLOR,
  Semaforo,
} from "./components";
import type { AppState } from "./state";

interface ViewProps {
  state: AppState;
  giros: Giro[];
  estados: Estado[];
  set: (patch: Partial<AppState>) => void;
}

/** Focus the view heading on navigation so screen readers announce it. */
function useFocusHeading(deps: unknown[]) {
  const ref = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    ref.current?.focus({ preventScroll: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return ref;
}

export function Home({ set }: Pick<ViewProps, "set">) {
  const h = useFocusHeading([]);
  return (
    <section className="fade" style={{ paddingTop: 22 }}>
      <p className="eyebrow" style={{ margin: "0 0 14px" }}>
        Antes de firmar la renta
      </p>
      <h1
        ref={h}
        tabIndex={-1}
        className="display"
        style={{
          fontSize: "clamp(34px,6vw,58px)",
          fontWeight: 800,
          margin: "0 0 18px",
          maxWidth: "15ch",
        }}
      >
        Averigua si el local{" "}
        <span style={{ color: "var(--jade)" }}>te conviene</span>.
      </h1>
      <p
        style={{
          fontSize: 18,
          color: "var(--ink-soft)",
          maxWidth: "52ch",
          margin: "0 0 34px",
          lineHeight: 1.5,
        }}
      >
        El estudio de mercado que nunca pudiste pagar — por el precio de una
        comida. Dime qué quieres abrir y te digo dónde tienes buena mano.
      </p>
      <div
        className="paths-grid"
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 16,
          maxWidth: 720,
        }}
      >
        <button className="choice" onClick={() => set({ modo: "explorar" })}>
          <div style={{ fontSize: 26, marginBottom: 12 }} aria-hidden="true">
            🧭
          </div>
          <div
            className="display"
            style={{ fontSize: 21, fontWeight: 700, marginBottom: 6 }}
          >
            No sé dónde abrir
          </div>
          <div
            style={{ color: "var(--ink-soft)", fontSize: 15, lineHeight: 1.45 }}
          >
            Explora las mejores zonas para tu giro y compáralas.
          </div>
          <div
            style={{
              marginTop: 14,
              fontSize: 13,
              fontWeight: 700,
              color: "var(--jade)",
            }}
          >
            Explorar zonas · gratis →
          </div>
        </button>
        <button className="choice" onClick={() => set({ modo: "validar" })}>
          <div style={{ fontSize: 26, marginBottom: 12 }} aria-hidden="true">
            📍
          </div>
          <div
            className="display"
            style={{ fontSize: 21, fontWeight: 700, marginBottom: 6 }}
          >
            Ya tengo un local en mente
          </div>
          <div
            style={{ color: "var(--ink-soft)", fontSize: 15, lineHeight: 1.45 }}
          >
            Dame la zona y te doy el veredicto antes de que firmes.
          </div>
          <div
            style={{
              marginTop: 14,
              fontSize: 13,
              fontWeight: 700,
              color: "var(--jade)",
            }}
          >
            Validar ubicación →
          </div>
        </button>
      </div>
      <p style={{ fontSize: 13, color: "var(--ink-soft)", margin: "26px 0 0" }}>
        Empezamos en{" "}
        <strong style={{ color: "var(--ink)" }}>Guadalajara</strong>. CDMX y
        Monterrey, próximamente.
      </p>
    </section>
  );
}

function GiroSelect({
  giros,
  value,
  onChange,
}: {
  giros: Giro[];
  value: string | null;
  onChange: (v: string | null) => void;
}) {
  return (
    <div>
      <label className="field" htmlFor="giroSel">
        ¿Qué quieres abrir?
      </label>
      <select
        id="giroSel"
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value || null)}
      >
        <option value="">Elige un giro…</option>
        {giros.map((g) => (
          <option key={g.id} value={g.id}>
            {g.emoji} {g.label}
          </option>
        ))}
      </select>
    </div>
  );
}

function LugarSelects({
  estados,
  municipios,
  state,
  set,
}: {
  estados: Estado[];
  municipios: Municipio[];
  state: AppState;
  set: ViewProps["set"];
}) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
      <div>
        <label className="field" htmlFor="estadoSel">
          Estado
        </label>
        <select
          id="estadoSel"
          value={state.estado}
          onChange={(e) => set({ estado: e.target.value, colonia: null })}
        >
          {estados.map((e) => (
            <option key={e.clave} value={e.clave} disabled={!e.activo}>
              {e.nombre}
              {e.activo ? "" : " · próximamente"}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className="field" htmlFor="muniSel">
          Ciudad
        </label>
        <select
          id="muniSel"
          value={state.municipio}
          onChange={(e) => set({ municipio: e.target.value, colonia: null })}
          disabled={municipios.length === 0}
        >
          {municipios.map((m) => (
            <option key={m.cve} value={m.cve} disabled={!m.activo}>
              {m.nombre}
              {m.activo ? "" : " · próximamente"}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

/**
 * When the estado changes, the previous municipio may not exist in the new
 * list — snap to the first active municipio so the controlled select never
 * points at a phantom value. (Latent until a second metro launches.)
 */
function useMunicipioGuard(
  state: AppState,
  set: ViewProps["set"],
  municipios: Municipio[],
) {
  useEffect(() => {
    if (municipios.length === 0) return;
    if (!municipios.some((m) => m.cve === state.municipio)) {
      const target = municipios.find((m) => m.activo) ?? municipios[0]!;
      set({ municipio: target.cve, colonia: null });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [municipios, state.municipio]);
}

export function Explorar({ state, giros, estados, set }: ViewProps) {
  const h = useFocusHeading([]);
  const munis = useAsync(() => api.municipios(state.estado), [state.estado]);
  useMunicipioGuard(state, set, munis.data?.municipios ?? []);
  const ranking = useAsync(
    () => api.explore(state.giro!, state.municipio),
    [state.giro, state.municipio],
    Boolean(state.giro && state.municipio),
  );
  const giroLabel =
    giros.find((g) => g.id === state.giro)?.label.toLowerCase() ?? "";

  return (
    <>
      <button
        className="btn-ghost fade no-print"
        style={{ margin: "18px 0 22px" }}
        onClick={() => set({ modo: null, colonia: null })}
      >
        ← Volver
      </button>
      <section className="fade">
        <p className="eyebrow" style={{ margin: "0 0 10px" }}>
          Explorar zonas · gratis
        </p>
        <h2
          ref={h}
          tabIndex={-1}
          className="display"
          style={{ fontSize: 30, fontWeight: 800, margin: "0 0 22px" }}
        >
          Las mejores zonas para tu negocio
        </h2>
        <div
          className="card"
          style={{
            padding: 20,
            maxWidth: 520,
            marginBottom: 28,
            display: "grid",
            gap: 16,
          }}
        >
          <GiroSelect
            giros={giros}
            value={state.giro}
            onChange={(giro) => set({ giro })}
          />
          <LugarSelects
            estados={estados}
            municipios={munis.data?.municipios ?? []}
            state={state}
            set={set}
          />
        </div>
        <div aria-live="polite">
          {!state.giro ? (
            <Cargando msg="Elige un giro arriba para ver el ranking de zonas." />
          ) : ranking.loading ? (
            <Cargando msg="Calculando las zonas con datos reales…" />
          ) : ranking.error ? (
            <ErrorNota msg={ranking.error} />
          ) : ranking.data ? (
            <RankingList
              zonas={ranking.data.zonas}
              municipioNombre={ranking.data.municipioNombre}
              giroLabel={giroLabel}
              onPick={(colonia) => {
                set({ modo: "validar", colonia });
                window.scrollTo({ top: 0, behavior: "smooth" });
              }}
            />
          ) : null}
        </div>
      </section>
    </>
  );
}

function RankingList({
  zonas,
  municipioNombre,
  giroLabel,
  onPick,
}: {
  zonas: Zona[];
  municipioNombre: string;
  giroLabel: string;
  onPick: (colonia: string) => void;
}) {
  if (zonas.length === 0)
    return (
      <Cargando msg="No encontramos zonas con suficiente actividad para este giro." />
    );
  return (
    <>
      <p style={{ fontSize: 13, color: "var(--ink-soft)", margin: "0 0 14px" }}>
        {zonas.length} zonas de {municipioNombre} ordenadas de mejor a peor para{" "}
        <strong style={{ color: "var(--ink)" }}>{giroLabel}</strong>
      </p>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {zonas.map((z, i) => (
          <button
            key={z.colonia}
            className={`card rank-row ${i === 0 ? "top" : ""}`}
            onClick={() => onPick(z.colonia)}
            aria-label={`${z.colonia}: ${z.palabra}, ${z.score} de 100. Ver veredicto completo.`}
          >
            <span className="rank-num">{String(i + 1).padStart(2, "0")}</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div
                className="display"
                style={{ fontSize: 18, fontWeight: 700 }}
              >
                {z.colonia}
                {z.campoLibre && (
                  <span className="badge-libre">campo libre</span>
                )}
              </div>
              <div style={{ fontSize: 13, color: "var(--ink-soft)" }}>
                {z.comp === 0
                  ? `ninguna ${giroLabel}`
                  : `${z.comp} ${giroLabel}${z.comp === 1 ? "" : "s"}`}{" "}
                cerca · gente {z.gente} · riesgo {z.riesgo}
              </div>
            </div>
            <div className="rank-score">
              <div className="bar-track">
                <div
                  className="bar-fill"
                  style={{ width: `${z.score}%`, background: LUZ_COLOR[z.luz] }}
                />
              </div>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  marginTop: 6,
                  alignItems: "baseline",
                }}
              >
                <span
                  className="mono"
                  style={{ fontSize: 12, color: "var(--ink-soft)" }}
                >
                  {z.score}/100
                </span>
                <span
                  style={{
                    fontSize: 12,
                    fontWeight: 700,
                    color: LUZ_COLOR[z.luz],
                  }}
                >
                  {z.palabra}
                </span>
              </div>
            </div>
          </button>
        ))}
      </div>
      <p style={{ fontSize: 13, color: "var(--ink-soft)", margin: "20px 0 0" }}>
        Toca una zona para ver el veredicto completo y decidir con datos.
      </p>
    </>
  );
}

export function Validar({ state, giros, estados, set }: ViewProps) {
  const h = useFocusHeading([]);
  const munis = useAsync(() => api.municipios(state.estado), [state.estado]);
  useMunicipioGuard(state, set, munis.data?.municipios ?? []);
  const cols = useAsync(() => api.colonias(state.municipio), [state.municipio]);
  const verdict = useAsync(
    () => api.verdict(state.giro!, state.municipio, state.colonia!),
    [state.giro, state.municipio, state.colonia],
    Boolean(state.giro && state.municipio && state.colonia),
  );
  const [desbloqueado, setDesbloqueado] = useState(false);
  useEffect(() => {
    setDesbloqueado(false);
  }, [state.giro, state.municipio, state.colonia]);

  return (
    <>
      <button
        className="btn-ghost fade no-print"
        style={{ margin: "18px 0 22px" }}
        onClick={() => set({ modo: null, colonia: null })}
      >
        ← Volver
      </button>
      <section className="fade">
        <p className="eyebrow" style={{ margin: "0 0 10px" }}>
          Validar ubicación
        </p>
        <h2
          ref={h}
          tabIndex={-1}
          className="display"
          style={{ fontSize: 30, fontWeight: 800, margin: "0 0 22px" }}
        >
          ¿Me conviene esta zona?
        </h2>
        <div
          className="card no-print"
          style={{
            padding: 20,
            maxWidth: 520,
            marginBottom: 28,
            display: "grid",
            gap: 16,
          }}
        >
          <GiroSelect
            giros={giros}
            value={state.giro}
            onChange={(giro) => set({ giro })}
          />
          <LugarSelects
            estados={estados}
            municipios={munis.data?.municipios ?? []}
            state={state}
            set={set}
          />
          <div>
            <label className="field" htmlFor="zonaSel">
              ¿En qué colonia está el local?
            </label>
            <select
              id="zonaSel"
              value={state.colonia ?? ""}
              onChange={(e) => set({ colonia: e.target.value || null })}
              disabled={cols.loading || !cols.data}
            >
              <option value="">
                {cols.loading ? "Cargando colonias…" : "Elige una colonia…"}
              </option>
              {(cols.data?.colonias ?? []).map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
            <p
              style={{
                fontSize: 12,
                color: "var(--ink-soft)",
                margin: "9px 0 0",
              }}
            >
              Muy pronto: escribe la dirección exacta del local y la ubicamos
              por ti.
            </p>
          </div>
        </div>
        <div aria-live="polite">
          {!state.giro || !state.colonia ? (
            <Cargando msg="Elige el giro y la colonia para ver el veredicto." />
          ) : verdict.loading ? (
            <Cargando msg="Cruzando los datos de tu zona…" />
          ) : verdict.error ? (
            <ErrorNota msg={verdict.error} />
          ) : verdict.data ? (
            <VerdictCard
              data={verdict.data}
              desbloqueado={desbloqueado}
              onDesbloquear={() => setDesbloqueado(true)}
              onComparar={() => set({ modo: "explorar", colonia: null })}
            />
          ) : null}
        </div>
      </section>
    </>
  );
}

function VerdictCard({
  data,
  desbloqueado,
  onDesbloquear,
  onComparar,
}: {
  data: import("./api").VerdictResponse;
  desbloqueado: boolean;
  onDesbloquear: () => void;
  onComparar: () => void;
}) {
  const v = data.veredicto;
  const color = LUZ_COLOR[v.luz];
  return (
    <div className="card fade" style={{ padding: 24, overflow: "hidden" }}>
      <div
        style={{
          display: "flex",
          gap: 22,
          alignItems: "center",
          flexWrap: "wrap",
        }}
      >
        <Semaforo luz={v.luz} palabra={v.palabra} />
        <div style={{ flex: 1, minWidth: 200 }}>
          <div
            style={{ fontSize: 13, color: "var(--ink-soft)", fontWeight: 600 }}
          >
            {data.giro.emoji} {data.giro.label} en {data.lugar.colonia},{" "}
            {data.lugar.municipioNombre}
          </div>
          <div
            className="display"
            style={{
              fontSize: 40,
              fontWeight: 800,
              color,
              lineHeight: 1.05,
              margin: "4px 0 2px",
            }}
          >
            {v.palabra}
          </div>
          <div style={{ fontSize: 15, color: "var(--ink-soft)" }}>
            {v.sub}
            {v.campoLibre
              ? " — sin negocios como el tuyo aún: léelo con calma abajo."
              : ""}
          </div>
        </div>
        <div style={{ textAlign: "center" }}>
          <div
            className="mono"
            style={{ fontSize: 30, fontWeight: 700, color }}
          >
            {v.score}
          </div>
          <div
            style={{
              fontSize: 11,
              color: "var(--ink-soft)",
              letterSpacing: ".08em",
            }}
          >
            DE 100
          </div>
        </div>
      </div>

      <div
        style={{
          marginTop: 22,
          paddingTop: 20,
          borderTop: "1px solid var(--line)",
        }}
      >
        <FactorBar
          nombre="Competencia cerca"
          sufijo="gratis"
          factor={v.competencia}
        />
      </div>

      {desbloqueado ? (
        <ReporteCompleto data={data} onComparar={onComparar} />
      ) : (
        <Paywall precio={data.giro.precio} onDesbloquear={onDesbloquear} />
      )}
    </div>
  );
}

function Paywall({
  precio,
  onDesbloquear,
}: {
  precio: number;
  onDesbloquear: () => void;
}) {
  return (
    <div style={{ marginTop: 18, position: "relative" }}>
      <div className="locked" aria-hidden="true">
        <div style={{ paddingTop: 18, borderTop: "1px solid var(--line)" }}>
          <div
            style={{
              fontSize: 12,
              fontWeight: 700,
              textTransform: "uppercase",
              color: "var(--jade)",
              marginBottom: 8,
            }}
          >
            Gente y demanda
          </div>
          <p style={{ margin: "0 0 14px", fontSize: 16 }}>
            La zona tiene un movimiento de gente que…
          </p>
          <div
            style={{
              fontSize: 12,
              fontWeight: 700,
              textTransform: "uppercase",
              color: "var(--jade)",
              marginBottom: 8,
            }}
          >
            Recomendación
          </div>
          <p style={{ margin: 0, fontSize: 16 }}>
            Con esta combinación te conviene entrar si…
          </p>
        </div>
      </div>
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 16,
        }}
      >
        <div
          style={{
            background: "var(--paper-2)",
            border: "1.5px solid var(--jade)",
            borderRadius: 16,
            padding: 22,
            textAlign: "center",
            maxWidth: 400,
            boxShadow: "0 12px 40px -16px rgba(31,107,79,.5)",
          }}
        >
          <div
            className="display"
            style={{ fontSize: 19, fontWeight: 700, marginBottom: 6 }}
          >
            Desbloquea el reporte completo
          </div>
          <p
            style={{
              fontSize: 14,
              color: "var(--ink-soft)",
              margin: "0 0 16px",
              lineHeight: 1.45,
            }}
          >
            Gente y demanda, poder de compra, riesgo de la zona y una
            recomendación clara de sí o no.
          </p>
          <button
            className="btn-primary"
            style={{ width: "100%" }}
            onClick={onDesbloquear}
          >
            Ver reporte completo · ${precio} MXN
          </button>
          <p
            style={{
              fontSize: 12,
              color: "var(--ink-soft)",
              margin: "12px 0 0",
              lineHeight: 1.45,
            }}
          >
            Pago único por este reporte. Si los datos de tu zona vienen
            incompletos, te lo decimos antes de cobrar.
          </p>
          <p
            className="mono"
            style={{
              fontSize: 11,
              color: "var(--ink-soft)",
              margin: "8px 0 0",
            }}
          >
            demo — aquí iría el cobro con tarjeta / OXXO / SPEI
          </p>
        </div>
      </div>
    </div>
  );
}

function ReporteCompleto({
  data,
  onComparar,
}: {
  data: import("./api").VerdictResponse;
  onComparar: () => void;
}) {
  const v = data.veredicto;
  return (
    <div
      className="fade"
      style={{
        marginTop: 18,
        paddingTop: 20,
        borderTop: "1px solid var(--line)",
        display: "grid",
        gap: 20,
      }}
    >
      <FactorBar nombre="Gente y demanda" factor={v.gente} />
      <FactorBar nombre="Poder de compra" factor={v.poder} />
      <FactorBar nombre="Riesgo de la zona" factor={v.riesgo} />
      <div>
        <div
          style={{
            fontSize: 12,
            fontWeight: 700,
            letterSpacing: ".1em",
            textTransform: "uppercase",
            color: "var(--jade)",
            marginBottom: 8,
          }}
        >
          Recomendación
        </div>
        <p style={{ margin: 0, fontSize: 16, lineHeight: 1.5 }}>
          {v.recomendacion}
        </p>
      </div>
      <details className="como">
        <summary>¿De dónde salen estos datos?</summary>
        Contamos los negocios como el tuyo en el directorio nacional del INEGI
        (DENUE), medimos cuánta gente vive y se mueve por la zona con el Censo,
        estimamos el poder de compra con datos oficiales de ingreso y pobreza, y
        el riesgo con las cifras públicas de incidencia delictiva. Cada factor
        te dice a qué nivel aplica: <strong>en tu colonia</strong> es lo más
        fino; <strong>en tu ciudad</strong> es el promedio del municipio.
      </details>
      <div className="aviso">
        <strong style={{ color: "var(--ink)" }}>Ojo:</strong> esto te orienta
        con datos públicos del DENUE/INEGI, que tienen margen. No sustituye
        caminar la zona ni tu instinto de negocio. La decisión es tuya.
      </div>
      <div
        className="no-print"
        style={{ display: "flex", gap: 10, flexWrap: "wrap" }}
      >
        <button className="btn-primary" onClick={() => window.print()}>
          Guardar reporte (PDF)
        </button>
        <button className="btn-ghost" onClick={onComparar}>
          Comparar con otra zona
        </button>
      </div>
    </div>
  );
}
