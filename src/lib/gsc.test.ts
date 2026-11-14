import { afterEach, describe, expect, it, vi } from "vitest";
import {
  assertUserPropertyAccess,
  fetchLiveDecayRows,
  getLivePeriods,
  listUserVerifiedProperties,
} from "./gsc.server";

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
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url, init) => {
        const body = JSON.parse(init.body);
        const previous = body.startDate === "2026-05-05";
        return Response.json({
          rows: previous
            ? [
                {
                  keys: [
                    body.dimensions[0] === "page" ? "https://example.com/lost" : "lost keyword",
                  ],
                  clicks: 20,
                  impressions: 100,
                  position: 7,
                },
              ]
            : [],
        });
      }),
    );
    const rows = await fetchLiveDecayRows(
      "https://example.com/",
      12,
      getLivePeriods(new Date("2026-11-03T00:59:00Z")),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      url: "https://example.com/lost",
      clicksPrev: 20,
      clicksNow: 0,
      impressionsNow: 0,
      positionNow: 0,
    });
    expect(rows[0]?.topQueries[0]).toMatchObject({
      query: "lost keyword",
      clicksPrev: 20,
      clicksNow: 0,
    });
  });

  it("enforces multi-tenant isolation so unauthorized users cannot access competitor properties", async () => {
    vi.stubEnv("LOVABLE_API_KEY", "test-only");
    vi.stubEnv("GOOGLE_SEARCH_CONSOLE_API_KEY", "test-only");
    vi.stubEnv("ADMIN_EMAILS", "founder@seo4web.sk");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          siteEntry: [
            { siteUrl: "https://vip-client.sk/", permissionLevel: "siteOwner" },
            { siteUrl: "https://another-client.sk/", permissionLevel: "siteOwner" },
          ],
        }),
      ),
    );

    // Non-admin user without access
    const regularProps = await listUserVerifiedProperties("user-123", "stranger@comp.sk");
    expect(regularProps).toEqual([]);

    await expect(
      assertUserPropertyAccess("user-123", "https://vip-client.sk/", "stranger@comp.sk"),
    ).rejects.toThrow("GSC_USER_UNAUTHORIZED_FOR_PROPERTY");

    // Admin user has access
    const adminProps = await listUserVerifiedProperties("admin-uuid", "founder@seo4web.sk");
    expect(adminProps).toHaveLength(2);

    const verified = await assertUserPropertyAccess(
      "admin-uuid",
      "https://vip-client.sk/",
      "founder@seo4web.sk",
    );
    expect(verified).toBe("https://vip-client.sk/");
  });
});

describe("ADMIN_EMAILS env-based admin resolution (fail-closed, no hardcoded addresses)", () => {
  const stubSites = () =>
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          siteEntry: [{ siteUrl: "https://vip-client.sk/", permissionLevel: "siteOwner" }],
        }),
      ),
    );

  const stubCreds = () => {
    vi.stubEnv("LOVABLE_API_KEY", "test-only");
    vi.stubEnv("GOOGLE_SEARCH_CONSOLE_API_KEY", "test-only");
  };

  it("treats nobody as admin when ADMIN_EMAILS is missing or empty", async () => {
    stubCreds();
    vi.stubEnv("ADMIN_EMAILS", "");
    stubSites();
    const props = await listUserVerifiedProperties("user-1", "someone@example.com");
    expect(props).toEqual([]);
    await expect(
      assertUserPropertyAccess("user-1", "https://vip-client.sk/", "someone@example.com"),
    ).rejects.toThrow("GSC_USER_UNAUTHORIZED_FOR_PROPERTY");
  });

  it("parses comma-separated ADMIN_EMAILS with trim + lowercase and matches case-insensitively", async () => {
    stubCreds();
    vi.stubEnv("ADMIN_EMAILS", " A@x.sk , b@y.sk ");
    stubSites();
    const props = await listUserVerifiedProperties("user-1", "A@X.SK");
    expect(props).toHaveLength(1);
    await expect(
      assertUserPropertyAccess("user-1", "https://vip-client.sk/", "a@x.sk"),
    ).resolves.toBe("https://vip-client.sk/");
  });

  it("does not treat a non-listed email as admin", async () => {
    stubCreds();
    vi.stubEnv("ADMIN_EMAILS", "admin@example.com");
    stubSites();
    await expect(
      assertUserPropertyAccess("user-9", "https://vip-client.sk/", "stranger@example.com"),
    ).rejects.toThrow("GSC_USER_UNAUTHORIZED_FOR_PROPERTY");
  });

  it("treats nobody as admin when ADMIN_EMAILS is completely unset", async () => {
    stubCreds();
    const original = process.env.ADMIN_EMAILS;
    delete process.env.ADMIN_EMAILS;
    try {
      stubSites();
      const props = await listUserVerifiedProperties("user-2", "whoever@example.com");
      expect(props).toEqual([]);
      await expect(
        assertUserPropertyAccess("user-2", "https://vip-client.sk/", "whoever@example.com"),
      ).rejects.toThrow("GSC_USER_UNAUTHORIZED_FOR_PROPERTY");
    } finally {
      if (original !== undefined) process.env.ADMIN_EMAILS = original;
    }
  });
});
