import { serve } from "@hono/node-server";
import { loadConfig } from "./config.js";
import { makeApp } from "./server.js";
import { Upstream } from "./upstream.js";

const config = loadConfig();
const app = makeApp({ config, upstream: new Upstream(config) });

serve(
  { fetch: app.fetch, port: config.port, hostname: "127.0.0.1" },
  (info) => {
    console.log(
      `[bff] uncharted-lite listening on 127.0.0.1:${info.port} → upstream ${config.upstreamUrl}`,
    );
  },
);
