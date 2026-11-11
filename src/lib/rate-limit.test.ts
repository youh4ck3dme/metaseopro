import { describe, expect, it } from "vitest";
import { checkRateLimit, getClientIp, checkCompositeRateLimit } from "./rate-limit.server";

describe("rate-limit server guard", () => {
  it("enforces limits and calculates retry time", () => {
    const key = `test-user-${Date.now()}`;
    const opts = { limit: 2, windowMs: 10_000 };

    expect(checkRateLimit(key, opts).ok).toBe(true);
    expect(checkRateLimit(key, opts).ok).toBe(true);

    const blocked = checkRateLimit(key, opts);
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) {
      expect(blocked.retryAfterSec).toBeGreaterThan(0);
      expect(blocked.retryAfterSec).toBeLessThanOrEqual(10);
    }
  });

  it("extracts real client IP from Cloudflare and proxy headers", () => {
    const reqWithCf = new Request("https://example.com/api", {
      headers: { "cf-connecting-ip": "194.1.2.3" },
    });
    expect(getClientIp(reqWithCf)).toBe("194.1.2.3");

    const reqWithFwd = new Request("https://example.com/api", {
      headers: { "x-forwarded-for": "85.237.234.1, 10.0.0.1" },
    });
    expect(getClientIp(reqWithFwd)).toBe("85.237.234.1");
  });

  it("checks composite rate limit for user and IP", () => {
    const req = new Request("https://example.com/api", {
      headers: { "cf-connecting-ip": "213.81.185.10" },
    });
    const userId = "test-uuid-999";
    const opts = { limit: 1, windowMs: 5_000 };

    expect(checkCompositeRateLimit("api-test", req, userId, opts).ok).toBe(true);
    expect(checkCompositeRateLimit("api-test", req, userId, opts).ok).toBe(false);
  });
});
