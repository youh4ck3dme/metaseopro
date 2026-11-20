import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type DbReply = { data: unknown; error: { message: string } | null } | Error;

const mocks = vi.hoisted(() => {
  const state = {
    userId: "00000000-0000-4000-8000-0000000000bb",
    authenticated: true,
    reply: { data: null, error: null } as DbReply,
    reads: 0,
    adminThrows: false,
  };
  const user = {
    from(table: string) {
      const query = {
        select() {
          return query;
        },
        eq() {
          return query;
        },
        async maybeSingle() {
          if (table !== "subscriptions") throw new Error("Unexpected table in fixture");
          state.reads += 1;
          if (state.reply instanceof Error) throw state.reply;
          return state.reply;
        },
      };
      return query;
    },
  };
  const requireSupabaseAuth = {
    authorize: vi.fn(async () => {
      if (!state.authenticated) throw new Error("Unauthorized fixture");
      return { userId: state.userId, supabase: user };
    }),
  };
  return { state, user, requireSupabaseAuth };
});

// Same adapter as billing.functions.test.ts: real handler, auth callback is a fixture.
vi.mock("@tanstack/react-start", () => ({
  createServerFn: () => {
    let validate: ((data: unknown) => unknown) | null = null;
    let middleware: unknown[] = [];
    const builder = {
      middleware(items: unknown[]) {
        middleware = items;
        return builder;
      },
      validator(fn: (data: unknown) => unknown) {
        validate = fn;
        return builder;
      },
      handler(
        _rpc: unknown,
        fn: (args: {
          data: unknown;
          context: { userId: string; supabase: typeof mocks.user };
        }) => Promise<unknown>,
      ) {
        return {
          __executeServer: async (args: { data?: unknown } = {}) => {
            if (!middleware.includes(mocks.requireSupabaseAuth)) {
              throw new Error("Missing auth middleware on provider handler");
            }
            const context = await mocks.requireSupabaseAuth.authorize();
            const data = validate ? validate(args.data) : args.data;
            return fn({ data, context });
          },
        };
      },
    };
    return builder;
  },
}));
vi.mock("@/integrations/supabase/auth-middleware", () => ({
  requireSupabaseAuth: mocks.requireSupabaseAuth,
}));
vi.mock("./admin.server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./admin.server")>();
  return {
    ...actual,
    isAdminUser: (user: Parameters<typeof actual.isAdminUser>[0]) => {
      if (mocks.state.adminThrows) throw new Error("synthetic admin lookup failure");
      return actual.isAdminUser(user);
    },
  };
});

import type * as ViewerRoleFunctions from "./viewer-role.functions";
// @ts-expect-error TanStack's Vite compiler supplies this provider module and its generated exports.
import * as provider from "./viewer-role.functions?tss-serverfn-split";

const getViewerRole =
  provider.getViewerRole_createServerFn_handler as typeof ViewerRoleFunctions.getViewerRole;

type Call = (args?: { data?: unknown }) => Promise<unknown>;
const run = (data?: unknown) => (getViewerRole as unknown as Call)({ data });

const ADMIN_ID = "00000000-0000-4000-8000-0000000000aa";
const USER_ID = "00000000-0000-4000-8000-0000000000bb";

beforeEach(() => {
  mocks.state.userId = USER_ID;
  mocks.state.authenticated = true;
  mocks.state.reply = { data: null, error: null };
  mocks.state.reads = 0;
  mocks.state.adminThrows = false;
  vi.stubEnv("ADMIN_USER_IDS", ADMIN_ID);
  vi.stubEnv("ADMIN_EMAILS", "");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("getViewerRole server function", () => {
  it("returns admin for the verified token user id in ADMIN_USER_IDS", async () => {
    mocks.state.userId = ADMIN_ID;
    await expect(run()).resolves.toEqual({ isAdmin: true, plan: "admin" });
    expect(mocks.state.reads).toBe(0);
  });

  it("returns the subscription plan for a regular user", async () => {
    mocks.state.reply = {
      data: { plan: "pro", status: "active", current_period_end: "2999-01-01T00:00:00.000Z" },
      error: null,
    };
    await expect(run()).resolves.toEqual({ isAdmin: false, plan: "pro" });
  });

  it("ignores any client-supplied role/flag input", async () => {
    const spoof = { isAdmin: true, plan: "admin", role: "admin", userId: ADMIN_ID, id: ADMIN_ID };
    await expect(run(spoof)).resolves.toEqual({ isAdmin: false, plan: "free" });
  });

  it("does not use ADMIN_EMAILS even when ADMIN_USER_IDS is unset", async () => {
    vi.stubEnv("ADMIN_USER_IDS", "");
    vi.stubEnv("ADMIN_EMAILS", "owner@example.com");
    mocks.state.userId = ADMIN_ID;
    await expect(run({ email: "owner@example.com" })).resolves.toEqual({
      isAdmin: false,
      plan: "free",
    });
  });

  it("fails closed (not admin) when the admin lookup throws", async () => {
    mocks.state.userId = ADMIN_ID;
    mocks.state.adminThrows = true;
    await expect(run()).resolves.toEqual({ isAdmin: false, plan: "free" });
  });

  it("returns a generic error when the subscription read fails", async () => {
    mocks.state.reply = new Error("SYNTHETIC_PRIVATE_DATABASE_DETAIL");
    await expect(run()).rejects.toThrow("Stav účtu sa nepodarilo načítať. Skús ho obnoviť.");
    await expect(run()).rejects.not.toThrow("SYNTHETIC_PRIVATE_DATABASE_DETAIL");
  });

  it("rejects unauthenticated callers", async () => {
    mocks.state.authenticated = false;
    await expect(run()).rejects.toThrow("Unauthorized fixture");
  });
});
