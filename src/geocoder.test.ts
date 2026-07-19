import { describe, expect, it, vi } from "vitest";
import { Geocoder, GeocoderBusyError } from "./geocoder.js";

const CONFIG = { url: "http://nominatim.test", userAgent: "test-agent/1.0" };

function nominatimResponse(rows: unknown[]): Response {
  return new Response(JSON.stringify(rows), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

const ROW = {
  lat: "20.6680547",
  lon: "-103.3694922",
  display_name: "480, Avenida Chapultepec, Americana, Guadalajara, México",
};

describe("Geocoder", () => {
  it("parses the first result and sends the identifying User-Agent", async () => {
    const fetchFn = vi.fn(async () => nominatimResponse([ROW]));
    const geo = new Geocoder(CONFIG, fetchFn as typeof fetch);
    const r = await geo.search("Av. Chapultepec 480, Guadalajara, México");
    expect(r).toEqual({
      lat: 20.6680547,
      lon: -103.3694922,
      displayName: ROW.display_name,
    });
    const [url, init] = fetchFn.mock.calls[0]! as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toContain("countrycodes=mx");
    expect(url).toContain("limit=1");
    expect((init.headers as Record<string, string>)["User-Agent"]).toBe(
      "test-agent/1.0",
    );
  });

  it("returns null (and caches it) when Nominatim finds nothing", async () => {
    const fetchFn = vi.fn(async () => nominatimResponse([]));
    const geo = new Geocoder(CONFIG, fetchFn as typeof fetch);
    expect(await geo.search("xyz nowhere")).toBeNull();
    expect(await geo.search("xyz nowhere")).toBeNull();
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("caches by normalized query (case/whitespace-insensitive)", async () => {
    const fetchFn = vi.fn(async () => nominatimResponse([ROW]));
    const geo = new Geocoder(CONFIG, fetchFn as typeof fetch);
    await geo.search("Av. Chapultepec 480");
    await geo.search("  av. CHAPULTEPEC   480 ");
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("serializes calls with ≥1.1s spacing (public Nominatim policy)", async () => {
    let now = 0;
    const sleeps: number[] = [];
    const fetchFn = vi.fn(async () => nominatimResponse([ROW]));
    const geo = new Geocoder(
      CONFIG,
      fetchFn as typeof fetch,
      () => now,
      async (ms) => {
        sleeps.push(ms);
        now += ms;
      },
    );
    await geo.search("query one");
    await geo.search("query two"); // distinct key → real second call
    expect(fetchFn).toHaveBeenCalledTimes(2);
    // second call had to wait out the spacing window
    expect(sleeps.length).toBe(1);
    expect(sleeps[0]).toBeGreaterThan(0);
    expect(sleeps[0]).toBeLessThanOrEqual(1100);
  });

  it("rejects with GeocoderBusyError beyond the queue depth cap", async () => {
    let release: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const fetchFn = vi.fn(async () => {
      await gate; // hold the first request open so the queue backs up
      return nominatimResponse([ROW]);
    });
    const geo = new Geocoder(
      CONFIG,
      fetchFn as typeof fetch,
      () => 0,
      async () => {},
    );
    const inFlight = Array.from({ length: 8 }, (_, i) =>
      geo.search(`query ${i}`),
    );
    await expect(geo.search("query overflow")).rejects.toThrowError(
      GeocoderBusyError,
    );
    release!();
    const results = await Promise.all(inFlight);
    expect(results.every((r) => r?.lat)).toBe(true);
  });

  it("propagates upstream failures without caching them", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(new Response("busy", { status: 429 }))
      .mockResolvedValue(nominatimResponse([ROW]));
    const geo = new Geocoder(
      CONFIG,
      fetchFn as typeof fetch,
      () => 0,
      async () => {},
    );
    await expect(geo.search("q")).rejects.toThrow(/nominatim 429/);
    // retry after failure hits the network again and succeeds
    expect((await geo.search("q"))?.lat).toBeCloseTo(20.668, 3);
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });
});
