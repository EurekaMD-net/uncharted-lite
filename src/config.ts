export interface BffConfig {
  port: number;
  /** Base URL of the México Uncharted API (no trailing slash). */
  upstreamUrl: string;
  /** X-Api-Key for the upstream — never leaves this process. */
  upstreamApiKey: string;
  /** Absolute path to the built web app (SPA) to serve statically. */
  webDist: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): BffConfig {
  const upstreamApiKey = env.UNCHARTED_API_KEY ?? "";
  if (!upstreamApiKey) {
    throw new Error("UNCHARTED_API_KEY is required (upstream X-Api-Key)");
  }
  const port = Number(env.PORT ?? 8096);
  return {
    port: Number.isFinite(port) && port > 0 ? port : 8096,
    upstreamUrl: (env.UPSTREAM_URL ?? "http://127.0.0.1:3030").replace(
      /\/$/,
      "",
    ),
    upstreamApiKey,
    // Relative to process CWD — @hono/node-server's serveStatic resolves
    // root against cwd, so the service must run from the repo root.
    webDist: env.WEB_DIST ?? "./web/dist",
  };
}

// Coverage is NATIONAL (operator ruling 2026-07-19: the single-metro gate in
// the original brief was misleading — all 32 estados and every municipio are
// open). Scrape protection now rests on the per-IP rate limits plus the
// cooked-endpoint boundary: nothing raw ever crosses the wire.
export const ENTIDAD_RE = /^(0[1-9]|[12][0-9]|3[0-2])$/;
export const CVE_MUN_RE = /^[0-9]{5}$/;
