import { useCallback, useEffect, useState } from "react";
import { api } from "./api";
import { useAsync } from "./hooks";
import { readHash, writeHash, type AppState } from "./state";
import { Cargando, ErrorNota } from "./components";
import { Explorar, Home, Validar } from "./views";

export default function App() {
  const [state, setState] = useState<AppState>(() => readHash(location.hash));

  // hash → state (back/forward, shared links)
  useEffect(() => {
    const onHash = () => setState(readHash(location.hash));
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const set = useCallback((patch: Partial<AppState>) => {
    setState((prev) => ({ ...prev, ...patch }));
  }, []);

  // state → hash in an effect, NOT inside the updater: updaters must stay
  // pure (StrictMode double-invokes them, which pushed duplicate history
  // entries). hashchange loops back harmlessly — readHash is idempotent.
  useEffect(() => {
    const h = writeHash(state);
    if (location.hash !== h && !(location.hash === "" && h === "")) {
      history.pushState(null, "", h === "" ? location.pathname : h);
    }
  }, [state]);

  const giros = useAsync(() => api.giros(), []);
  const estados = useAsync(() => api.estados(), []);

  return (
    <>
      <header
        className="wrap"
        style={{
          paddingTop: 26,
          paddingBottom: 14,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 11 }}>
          <div
            aria-hidden="true"
            style={{
              width: 34,
              height: 34,
              borderRadius: 9,
              background: "var(--jade)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="#F7FBF8"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M9 20l-5.5 2.5V6L9 3.5m0 16.5l6-2.5m-6 2.5V3.5m6 14l5.5 2.5V6L15 3.5m0 14V3.5m-6 0l6 2.5" />
            </svg>
          </div>
          <div>
            <div className="display" style={{ fontWeight: 800, fontSize: 19 }}>
              Uncharted
            </div>
            <div
              style={{ fontSize: 11, color: "var(--ink-soft)", marginTop: -2 }}
            >
              por EurekaMS
            </div>
          </div>
        </div>
        <span
          className="pill no-print"
          title="Demo con datos reales de Guadalajara"
        >
          ● Demo · datos reales
        </span>
      </header>

      <main className="wrap" style={{ paddingBottom: 80 }}>
        {giros.error || estados.error ? (
          <ErrorNota msg={giros.error ?? estados.error ?? ""} />
        ) : !giros.data || !estados.data ? (
          <Cargando msg="Cargando…" />
        ) : state.modo === "explorar" ? (
          <Explorar
            state={state}
            giros={giros.data.giros}
            estados={estados.data.estados}
            set={set}
          />
        ) : state.modo === "validar" ? (
          <Validar
            state={state}
            giros={giros.data.giros}
            estados={estados.data.estados}
            set={set}
          />
        ) : (
          <Home set={set} />
        )}
      </main>

      <footer
        className="wrap"
        style={{
          padding: "26px 20px 44px",
          borderTop: "1px solid var(--line)",
          color: "var(--ink-soft)",
          fontSize: 12.5,
          lineHeight: 1.6,
        }}
      >
        Uncharted te orienta con datos del DENUE/INEGI y fuentes públicas.{" "}
        <strong style={{ color: "var(--ink)" }}>No es una garantía</strong>: los
        datos tienen margen de error y la decisión final es tuya.
      </footer>
    </>
  );
}
