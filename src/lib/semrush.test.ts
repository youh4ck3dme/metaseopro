import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearSemrushMemoryCache, getCachedDomainSnapshot, SemrushError } from "./semrush.server";

describe("Semrush intelligent cache & quota protection", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-10T12:00:00Z"));
    clearSemrushMemoryCache();
    vi.stubEnv("LOVABLE_API_KEY", "test-lovable-key");
    vi.stubEnv("SEMRUSH_API_KEY", "test-semrush-key");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.useRealTimers();
  });

  it("writes to cache on first call and reads from cache before TTL expires without extra API calls", async () => {
    let apiCallCount = 0;

    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        apiCallCount++;
        if (url.includes("/domains/domain_ranks")) {
          return Response.json({
            data: {
              columnNames: ["Db", "Dn", "Rk", "Or", "Ot"],
              rows: [["sk", "priklad.sk", "1200", "450", "2800"]],
            },
          });
        }
        if (url.includes("/domains/domain_organic")) {
          return Response.json({
            data: {
              columnNames: ["Ph", "Po", "Nq"],
              rows: [["seo audit", "1", "1200"]],
            },
          });
        }
        if (url.includes("/backlinks/backlinks_overview")) {
          return Response.json({
            data: {
              columnNames: ["total", "domains_num"],
              rows: [["150", "35"]],
            },
          });
        }
        return Response.json({ data: { columnNames: [], rows: [] } });
      }),
    );

    // 1. Prvé volanie — načíta z live API
    const res1 = await getCachedDomainSnapshot("priklad.sk", "sk");
    expect(res1.domain).toBe("priklad.sk");
    expect(res1.cached).toBe(false);
    expect(res1.overview?.Ot).toBe("2800");
    const initialCalls = apiCallCount;
    expect(initialCalls).toBeGreaterThan(0);

    // 2. Druhé volanie o 3 dni neskôr (v rámci 7-dňového TTL)
    vi.advanceTimersByTime(3 * 24 * 60 * 60 * 1000);

    const res2 = await getCachedDomainSnapshot("priklad.sk", "sk");
    expect(res2.domain).toBe("priklad.sk");
    expect(res2.cached).toBe(true);
    expect(res2.stale).toBeFalsy();
    expect(res2.overview?.Ot).toBe("2800");
    // Žiadne nové volania na Semrush API!
    expect(apiCallCount).toBe(initialCalls);
  });

  it("returns stale cached data with warning on 429 quota exhaustion when cache is expired", async () => {
    let mockMode: "success" | "rate_limited" = "success";

    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (mockMode === "rate_limited") {
          return new Response(
            JSON.stringify({ error: "ERROR 134: You have exceeded your Semrush API quota limit" }),
            { status: 429, headers: { "Content-Type": "application/json" } },
          );
        }

        if (url.includes("/domains/domain_ranks")) {
          return Response.json({
            data: {
              columnNames: ["Db", "Dn", "Rk", "Or", "Ot"],
              rows: [["sk", "eshop.sk", "500", "850", "12000"]],
            },
          });
        }
        return Response.json({ data: { columnNames: [], rows: [] } });
      }),
    );

    // 1. Úspešné počiatočné načítanie
    const initial = await getCachedDomainSnapshot("eshop.sk", "sk");
    expect(initial.cached).toBe(false);
    expect(initial.overview?.Ot).toBe("12000");

    // 2. Prejde 8 dní (TTL 7 dní vypršalo)
    vi.advanceTimersByTime(8 * 24 * 60 * 60 * 1000);

    // 3. Semrush API začne vracať 429 / ERROR 134
    mockMode = "rate_limited";

    const staleResult = await getCachedDomainSnapshot("eshop.sk", "sk");
    expect(staleResult.domain).toBe("eshop.sk");
    expect(staleResult.cached).toBe(true);
    expect(staleResult.stale).toBe(true);
    expect(staleResult.warning).toContain("Zobrazené archivované dáta kvôli vyťaženiu API");
    expect(staleResult.overview?.Ot).toBe("12000");
  });

  it("throws SemrushError 429 when no cache exists and API quota is exceeded", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        return new Response(
          JSON.stringify({ error: "ERROR 134: You have exceeded your Semrush API quota limit" }),
          { status: 429, headers: { "Content-Type": "application/json" } },
        );
      }),
    );

    await expect(getCachedDomainSnapshot("uncached-domain.sk", "sk")).rejects.toThrow(SemrushError);
  });
});
