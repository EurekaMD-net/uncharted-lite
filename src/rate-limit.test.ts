import { describe, expect, it } from "vitest";
import { clientIp, RateLimiter } from "./rate-limit.js";

describe("RateLimiter", () => {
  it("allows up to max hits within the window, then rejects", () => {
    let t = 0;
    const rl = new RateLimiter({ windowMs: 1000, max: 3 }, () => t);
    expect(rl.allow("a")).toBe(true);
    expect(rl.allow("a")).toBe(true);
    expect(rl.allow("a")).toBe(true);
    expect(rl.allow("a")).toBe(false);
  });

  it("slides the window — old hits expire", () => {
    let t = 0;
    const rl = new RateLimiter({ windowMs: 1000, max: 2 }, () => t);
    rl.allow("a");
    rl.allow("a");
    expect(rl.allow("a")).toBe(false);
    t = 1001;
    expect(rl.allow("a")).toBe(true);
  });

  it("tracks keys independently", () => {
    let t = 0;
    const rl = new RateLimiter({ windowMs: 1000, max: 1 }, () => t);
    expect(rl.allow("a")).toBe(true);
    expect(rl.allow("b")).toBe(true);
    expect(rl.allow("a")).toBe(false);
  });

  it("prune drops idle keys", () => {
    let t = 0;
    const rl = new RateLimiter({ windowMs: 1000, max: 5 }, () => t);
    rl.allow("a");
    t = 2000;
    rl.prune();
    // after prune the key is gone; fresh allowance
    for (let i = 0; i < 5; i++) expect(rl.allow("a")).toBe(true);
    expect(rl.allow("a")).toBe(false);
  });
});

describe("clientIp", () => {
  it("takes the LAST X-Forwarded-For hop — the one the trusted proxy appended", () => {
    expect(clientIp("1.2.3.4, 5.6.7.8")).toBe("5.6.7.8");
    expect(clientIp("9.9.9.9")).toBe("9.9.9.9");
  });
  it("a forged first hop cannot rotate the rate-limit key", () => {
    expect(clientIp("forged-a, 5.6.7.8")).toBe(clientIp("forged-b, 5.6.7.8"));
  });
  it("falls back to 'local' when absent or empty", () => {
    expect(clientIp(undefined)).toBe("local");
    expect(clientIp("")).toBe("local");
    expect(clientIp("5.6.7.8, ")).toBe("local");
  });
});
