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

/**
 * Launched coverage. Only these claves are reachable through the public
 * cascade — everything else is "próximamente". This is deliberate scrape
 * protection: the BFF will not fan out the warehouse beyond launched metros.
 */
export const ESTADOS_ACTIVOS = new Set(["14"]);
export const MUNICIPIOS_ACTIVOS = new Set(["14039"]);

export const ENTIDAD_RE = /^(0[1-9]|[12][0-9]|3[0-2])$/;
export const CVE_MUN_RE = /^[0-9]{5}$/;
