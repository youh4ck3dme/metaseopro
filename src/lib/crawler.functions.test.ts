import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const requireSupabaseAuth = { name: "requireSupabaseAuth" };
  const built = {
    middleware: [] as unknown[],
    validate: (d: unknown) => d,
    handler: null as null | ((args: { data: unknown; context: { userId: string } }) => unknown),
  };
  return { requireSupabaseAuth, built, runCrawlForUser: vi.fn() };
});

vi.mock("@tanstack/react-start", () => ({
  createServerFn: () => {
    const builder = {
      middleware: (m: unknown[]) => {
        mocks.built.middleware = m;
        return builder;
      },
      validator: (fn: (d: unknown) => unknown) => {
        mocks.built.validate = fn;
        return builder;
      },
      // The TanStack compiler passes an RPC reference first and the handler last.
      handler: (...args: unknown[]) => {
        const fn = args[args.length - 1] as (a: {
          data: unknown;
          context: { userId: string };
        }) => unknown;
        mocks.built.handler = fn;
        return {
          __executeServer: async (a: { data?: unknown; context?: { userId: string } } = {}) =>
            fn({ data: mocks.built.validate(a.data), context: { userId: "user-1" } }),
        };
      },
    };
    return builder;
  },
}));
vi.mock("@/integrations/supabase/auth-middleware", () => ({
  requireSupabaseAuth: mocks.requireSupabaseAuth,
}));
vi.mock("./crawler.server", async (orig) => ({
  ...(await orig<typeof import("./crawler.server")>()),
  runCrawlForUser: mocks.runCrawlForUser,
}));

import type * as CrawlerFunctions from "./crawler.functions";
// @ts-expect-error TanStack's Vite compiler supplies this provider module and its generated exports.
import * as provider from "./crawler.functions?tss-serverfn-split";

const crawlSiteHandler =
  provider.crawlSiteFn_createServerFn_handler as typeof CrawlerFunctions.crawlSiteFn;

describe("crawlSiteFn", () => {
  beforeEach(() => mocks.runCrawlForUser.mockReset());

  it("is protected by requireSupabaseAuth (not the Bearer-only requireUser)", () => {
    expect(mocks.built.middleware).toEqual([mocks.requireSupabaseAuth]);
  });

  it("validates its input", () => {
    expect(() => mocks.built.validate({})).toThrow();
    expect(() => mocks.built.validate({ url: "https://mojweb.sk", pageLimit: 999 })).toThrow();
    expect(mocks.built.validate({ url: "https://mojweb.sk", pageLimit: 5 })).toEqual({
      url: "https://mojweb.sk",
      pageLimit: 5,
    });
  });

  it("runs the crawl for the authenticated user id with rate/concurrency limits", async () => {
    mocks.runCrawlForUser.mockResolvedValue({ ok: true });
    const data = { url: "https://mojweb.sk" };
    const out = await crawlSiteHandler({ data });
    expect(out).toEqual({ ok: true });
    expect(mocks.runCrawlForUser).toHaveBeenCalledWith("user-1", data);
  });
});
