import { useEffect, useState } from "react";
import { ApiError } from "./api";

export interface Async<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  status: number | null;
}

/**
 * Minimal fetch-on-deps hook. `enabled=false` keeps it idle (dependent
 * dropdowns before their parent is chosen). Stale responses are dropped.
 */
export function useAsync<T>(
  fn: () => Promise<T>,
  deps: unknown[],
  enabled = true,
): Async<T> {
  const [state, setState] = useState<Async<T>>({
    data: null,
    loading: enabled,
    error: null,
    status: null,
  });

  useEffect(() => {
    if (!enabled) {
      setState({ data: null, loading: false, error: null, status: null });
      return;
    }
    let live = true;
    setState((s) => ({ ...s, loading: true, error: null }));
    fn().then(
      (data) => {
        if (live) setState({ data, loading: false, error: null, status: 200 });
      },
      (err: unknown) => {
        if (!live) return;
        const message =
          err instanceof ApiError
            ? err.message
            : "No pudimos cargar los datos. Revisa tu conexión.";
        const status = err instanceof ApiError ? err.status : null;
        setState({ data: null, loading: false, error: message, status });
      },
    );
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, enabled]);

  return state;
}
