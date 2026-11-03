import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchLiveDecayRows, getLivePeriods } from "./gsc.server";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe("GSC comparison regressions", () => {
  it("calculates exactly two adjacent inclusive 90-day windows at request time", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-03T00:59:00Z"));
    expect(getLivePeriods()).toEqual({
      now: "2026-08-03 – 2026-10-31",
      prev: "2026-05-05 – 2026-08-02",
    });
    vi.setSystemTime(new Date("2026-11-04T00:59:00Z"));
    expect(getLivePeriods().now).toBe("2026-08-04 – 2026-11-01");
  });

  it("retains URLs and queries which lost all current traffic", async () => {
    vi.stubEnv("LOVABLE_API_KEY", "test-only");
    vi.stubEnv("GOOGLE_SEARCH_CONSOLE_API_KEY", "test-only");
    vi.stubGlobal("fetch", vi.fn(async (_url, init) => {
      const body = JSON.parse(init.body);
      const previous = body.startDate === "2026-05-05";
      return Response.json({ rows: previous ? [{
        keys: [body.dimensions[0] === "page" ? "https://example.com/lost" : "lost keyword"],
        clicks: 20, impressions: 100, position: 7,
      }] : [] });
    }));
    const rows = await fetchLiveDecayRows("https://example.com/", 12,
      getLivePeriods(new Date("2026-11-03T00:59:00Z")));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ url: "https://example.com/lost", clicksPrev: 20, clicksNow: 0, impressionsNow: 0, positionNow: 0 });
    expect(rows[0]?.topQueries[0]).toMatchObject({ query: "lost keyword", clicksPrev: 20, clicksNow: 0 });
  });
});