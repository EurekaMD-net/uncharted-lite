import { describe, expect, it, vi } from "vitest";
import { TtlCache, Upstream, UpstreamError } from "./upstream.js";

const CONFIG = { upstreamUrl: "http://up.test", upstreamApiKey: "sekret" };

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("Upstream", () => {
  it("injects X-Api-Key and hits the right path", async () => {
    const fetchFn = vi.fn(async () => jsonResponse({ entidades: [] }));
    const up = new Upstream(CONFIG, new TtlCache(), fetchFn as typeof fetch);
    await up.entidades();
    const [url, init] = fetchFn.mock.calls[0]! as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe("http://up.test/entidades");
    expect((init.headers as Record<string, string>)["X-Api-Key"]).toBe(
      "sekret",
    );
  });

  it("caches within TTL — second call does not refetch", async () => {
    const fetchFn = vi.fn(async () => jsonResponse({ entidades: [] }));
    const up = new Upstream(CONFIG, new TtlCache(), fetchFn as typeof fetch);
    await up.entidades();
    await up.entidades();
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("expired cache entries refetch", async () => {
    let now = 0;
    const cache = new TtlCache(() => now);
    const fetchFn = vi.fn(async () => jsonResponse({ entidades: [] }));
    const up = new Upstream(CONFIG, cache, fetchFn as typeof fetch);
    await up.entidades();
    now = 2 * 60 * 60 * 1000; // beyond the 1h TTL
    await up.entidades();
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it("non-2xx throws UpstreamError with status", async () => {
    const fetchFn = vi.fn(async () => jsonResponse({ error: "nope" }, 401));
    const up = new Upstream(CONFIG, new TtlCache(), fetchFn as typeof fetch);
    await expect(up.entidades()).rejects.toThrowError(UpstreamError);
    await expect(up.entidades()).rejects.toMatchObject({ status: 401 });
  });

  it("builds the opportunity query with comma-joined SCIAN codes", async () => {
    const fetchFn = vi.fn(async () =>
      jsonResponse({ cve_mun: "14039", colonias: [] }),
    );
    const up = new Upstream(CONFIG, new TtlCache(), fetchFn as typeof fetch);
    await up.opportunityByColonia("14039", ["464111", "464112"]);
    const [url] = fetchFn.mock.calls[0]! as unknown as [string];
    expect(url).toContain("cve_mun=14039");
    expect(url).toContain("target_scian=464111%2C464112");
    expect(url).toContain("limit=200");
  });
});

describe("TtlCache", () => {
  it("get after expiry returns undefined and evicts", () => {
    let now = 0;
    const cache = new TtlCache(() => now);
    cache.set("k", 1, 100);
    expect(cache.get("k")).toBe(1);
    now = 101;
    expect(cache.get("k")).toBeUndefined();
  });
});
