import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type DbReply = { data: unknown; error: { code?: string; message: string } | null } | Error;
type DbCall = {
  client: "user" | "admin";
  table: string;
  operation: "select" | "insert" | "update";
  columns?: string;
  filters: Array<[string, unknown]>;
  payload?: unknown;
};

const mocks = vi.hoisted(() => {
  const state = {
    subscriptionReplies: [] as DbReply[],
    usageReplies: [] as DbReply[],
    calls: [] as DbCall[],
    userId: "synthetic-authenticated-user",
  };

  function client(kind: "user" | "admin") {
    return {
      from(table: string) {
        const call: DbCall = { client: kind, table, operation: "select", filters: [] };
        const finish = async () => {
          state.calls.push(call);
          if (
            (kind === "user" && table !== "subscriptions") ||
            (kind === "admin" && table !== "content_plan_usage")
          ) {
            throw new Error("Unexpected database table or client in fixture");
          }
          const result = (
            table === "subscriptions" ? state.subscriptionReplies : state.usageReplies
          ).shift();
          if (!result) throw new Error("No queued database fixture");
          if (result instanceof Error) throw result;
          return result;
        };
        const query = {
          select(columns?: string) {
            call.columns = columns;
            return query;
          },
          insert(payload: unknown) {
            call.operation = "insert";
            call.payload = payload;
            return query;
          },
          update(payload: unknown) {
            call.operation = "update";
            call.payload = payload;
            return query;
          },
          eq(column: string, value: unknown) {
            call.filters.push([column, value]);
            return query;
          },
          maybeSingle: finish,
          then<T, U>(
            resolve?: (result: Exclude<DbReply, Error>) => T | PromiseLike<T>,
            reject?: (error: unknown) => U | PromiseLike<U>,
          ) {
            return finish().then(resolve, reject);
          },
        };
        return query;
      },
    };
  }

  return { state, user: client("user"), admin: client("admin") };
});

// This fixture executes the compiler's provider handlers and Zod validator, not RPC transport/auth/RLS.
vi.mock("@tanstack/react-start", () => ({
  createServerFn: () => {
    let validate = (data: unknown) => data;
    const builder = {
      middleware: () => builder,
      validator: (fn: (data: unknown) => unknown) => {
        validate = fn;
        return builder;
      },
      handler: (
        _rpc: unknown,
        fn: (args: {
          data: unknown;
          context: { userId: string; supabase: typeof mocks.user };
        }) => Promise<unknown>,
      ) => ({
        __executeServer: async (args: { data?: unknown } = {}) =>
          fn({
            data: validate(args.data),
            context: { userId: mocks.state.userId, supabase: mocks.user },
          }),
      }),
    };
    return builder;
  },
}));
vi.mock("@/integrations/supabase/auth-middleware", () => ({ requireSupabaseAuth: {} }));
vi.mock("@/integrations/supabase/client.server", () => ({ supabaseAdmin: mocks.admin }));

import type * as ContentPlanFunctions from "./content-plan.functions";
// @ts-expect-error TanStack's Vite compiler supplies this provider module and its generated exports.
import * as provider from "./content-plan.functions?tss-serverfn-split";

const checkContentPlanAccess =
  provider.checkContentPlanAccess_createServerFn_handler as typeof ContentPlanFunctions.checkContentPlanAccess;
const generateContentPlan =
  provider.generateContentPlan_createServerFn_handler as typeof ContentPlanFunctions.generateContentPlan;

const NOW = Date.parse("2026-11-16T12:00:00.000Z");
const HOUR = 60 * 60 * 1000;
const OLD_FIRST_USE = new Date(NOW - 48 * HOUR).toISOString();
const FUTURE_PERIOD_END = new Date(NOW + 30 * 24 * HOUR).toISOString();
const INPUT = { niche: "Syntetické SEO", goal: "Ukážkový obsahový plán", extra: "" };
const PLAN = "# Syntetický plán bez živého AI volania";
const RAW_DETAIL = "SYNTHETIC_PRIVATE_RESPONSE_MUST_NOT_ESCAPE";

const fetchMock = vi.fn<typeof fetch>();

function subscription(plan = "pro", status = "active", end = FUTURE_PERIOD_END) {
  return { plan, status, current_period_end: end };
}

function queueSubscription(data: ReturnType<typeof subscription> | null) {
  mocks.state.subscriptionReplies.push({ data, error: null });
}

function queueUsageCheck(firstUsedAt: string | null) {
  mocks.state.usageReplies.push({
    data: firstUsedAt ? { first_used_at: firstUsedAt, generations_count: 7 } : null,
    error: null,
  });
}

function queueExistingGeneration(firstUsedAt: string, canGenerate: boolean) {
  mocks.state.usageReplies.push(
    { data: null, error: { code: "23505", message: "Synthetic existing usage row" } },
    { data: { first_used_at: firstUsedAt }, error: null },
  );
  if (canGenerate) {
    mocks.state.usageReplies.push(
      { data: { generations_count: 7 }, error: null },
      { data: null, error: null },
    );
  }
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  vi.stubEnv("MISTRAL_API_KEY", "synthetic-test-placeholder-not-a-live-key");
  mocks.state.subscriptionReplies.length = 0;
  mocks.state.usageReplies.length = 0;
  mocks.state.calls.length = 0;
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(
    new Response(JSON.stringify({ choices: [{ message: { content: PLAN } }] })),
  );
  vi.stubGlobal("fetch", fetchMock);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Content Plan paid access after the first 24 hours", () => {
  it.each([
    ["pro", "active"],
    ["pro", "trialing"],
    ["agency", "active"],
    ["agency", "trialing"],
  ])("allows the check for %s/%s without restarting the free window", async (plan, status) => {
    queueSubscription(subscription(plan, status));
    queueUsageCheck(OLD_FIRST_USE);

    await expect(checkContentPlanAccess()).resolves.toEqual({
      allowed: true,
      isFirstDay: false,
      generationsCount: 7,
      firstUsedAt: OLD_FIRST_USE,
    });
    expect(mocks.state.calls).toEqual([
      {
        client: "user",
        table: "subscriptions",
        operation: "select",
        columns: "plan, status, current_period_end",
        filters: [["user_id", mocks.state.userId]],
      },
      {
        client: "admin",
        table: "content_plan_usage",
        operation: "select",
        columns: "*",
        filters: [["user_id", mocks.state.userId]],
      },
    ]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    ["pro", "active"],
    ["agency", "trialing"],
  ])("generates for %s/%s after 48 hours and preserves the result API", async (plan, status) => {
    queueSubscription(subscription(plan, status));
    queueExistingGeneration(OLD_FIRST_USE, true);

    await expect(generateContentPlan({ data: INPUT })).resolves.toEqual({ plan: PLAN });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(mocks.state.calls.find((call) => call.operation === "update")).toMatchObject({
      filters: [["user_id", mocks.state.userId]],
      payload: { generations_count: 8, last_used_at: new Date(NOW).toISOString() },
    });
  });

  it.each([
    ["expired", subscription("pro", "active", new Date(NOW - 1).toISOString())],
    ["past_due", subscription("agency", "past_due")],
    ["canceled", subscription("pro", "canceled")],
  ])("denies %s access in both check and generate before any AI request", async (_name, row) => {
    queueSubscription(row);
    queueUsageCheck(OLD_FIRST_USE);
    await expect(checkContentPlanAccess()).resolves.toMatchObject({
      allowed: false,
      isFirstDay: false,
    });

    queueSubscription(row);
    queueExistingGeneration(OLD_FIRST_USE, false);
    await expect(generateContentPlan({ data: INPUT })).rejects.toThrow("PAYMENT_REQUIRED");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mocks.state.calls.some((call) => call.operation === "update")).toBe(false);
  });
});

describe("Content Plan superadmin bypass (ADMIN_USER_IDS only)", () => {
  it("lets the superadmin check and generate after the free day without a subscription", async () => {
    vi.stubEnv("ADMIN_USER_IDS", mocks.state.userId);
    queueUsageCheck(OLD_FIRST_USE);
    await expect(checkContentPlanAccess()).resolves.toMatchObject({ allowed: true });

    queueExistingGeneration(OLD_FIRST_USE, true);
    await expect(generateContentPlan({ data: INPUT })).resolves.toEqual({ plan: PLAN });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(mocks.state.calls.some((call) => call.table === "subscriptions")).toBe(false);
  });

  it("does not bypass for a user whose id is not listed, even with ADMIN_EMAILS set", async () => {
    vi.stubEnv("ADMIN_USER_IDS", "");
    vi.stubEnv("ADMIN_EMAILS", "owner@example.com");
    queueSubscription(null);
    queueExistingGeneration(OLD_FIRST_USE, false);
    await expect(generateContentPlan({ data: INPUT })).rejects.toThrow("PAYMENT_REQUIRED");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("Content Plan free 24-hour window", () => {
  it.each([
    [24 * HOUR - 1, true],
    [24 * HOUR, false],
    [48 * HOUR, false],
  ])("keeps the original boundary at elapsed %s ms (allowed=%s)", async (elapsed, allowed) => {
    const first = new Date(NOW - elapsed).toISOString();
    queueSubscription(null);
    queueUsageCheck(first);
    await expect(checkContentPlanAccess()).resolves.toMatchObject({
      allowed,
      isFirstDay: allowed,
    });

    queueSubscription(null);
    queueExistingGeneration(first, allowed);
    const generating = generateContentPlan({ data: INPUT });
    if (allowed) {
      await expect(generating).resolves.toEqual({ plan: PLAN });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } else {
      await expect(generating).rejects.toThrow("PAYMENT_REQUIRED");
      expect(fetchMock).not.toHaveBeenCalled();
    }
  });

  it("allows a first-time free user and stores one first-use timestamp", async () => {
    queueSubscription(null);
    queueUsageCheck(null);
    await expect(checkContentPlanAccess()).resolves.toEqual({
      allowed: true,
      isFirstDay: true,
      generationsCount: 0,
      firstUsedAt: null,
    });

    queueSubscription(null);
    mocks.state.usageReplies.push(
      { data: { first_used_at: new Date(NOW).toISOString() }, error: null },
      { data: { generations_count: 0 }, error: null },
      { data: null, error: null },
    );
    await expect(generateContentPlan({ data: INPUT })).resolves.toEqual({ plan: PLAN });
    expect(mocks.state.calls.find((call) => call.operation === "insert")?.payload).toEqual({
      user_id: mocks.state.userId,
      first_used_at: new Date(NOW).toISOString(),
      last_used_at: new Date(NOW).toISOString(),
      generations_count: 0,
    });
  });
});

describe.each(["check", "generate"] as const)(
  "%s fails closed on access lookup errors",
  (operation) => {
    const invoke = () =>
      operation === "check" ? checkContentPlanAccess() : generateContentPlan({ data: INPUT });

    it.each(["returned", "rejected"])(
      "sanitizes a %s subscription error before using DB writes or AI",
      async (mode) => {
        mocks.state.subscriptionReplies.push(
          mode === "returned"
            ? { data: null, error: { message: RAW_DETAIL } }
            : new Error(RAW_DETAIL),
        );

        await expect(invoke()).rejects.toThrow("Nepodarilo sa overiť predplatné.");
        expect(mocks.state.calls.every((call) => call.table === "subscriptions")).toBe(true);
        expect(fetchMock).not.toHaveBeenCalled();
        expect(console.error).not.toHaveBeenCalled();
      },
    );

    it("sanitizes a usage error even for an otherwise valid paid entitlement", async () => {
      queueSubscription(subscription());
      mocks.state.usageReplies.push({ data: null, error: { code: "XX000", message: RAW_DETAIL } });

      await expect(invoke()).rejects.toThrow("Nepodarilo sa overiť používanie plánovača.");
      expect(fetchMock).not.toHaveBeenCalled();
      expect(console.error).not.toHaveBeenCalled();
    });
  },
);

describe("Content Plan provider error sanitization", () => {
  beforeEach(() => {
    queueSubscription(subscription());
    queueExistingGeneration(OLD_FIRST_USE, false);
  });

  it("logs only the HTTP status, not the raw provider body", async () => {
    fetchMock.mockResolvedValueOnce(new Response(RAW_DETAIL, { status: 503 }));
    await expect(generateContentPlan({ data: INPUT })).rejects.toThrow("Chyba AI gateway.");
    expect(console.error).toHaveBeenCalledExactlyOnceWith("Content plan AI request failed", {
      status: 503,
    });
    expect(mocks.state.calls.some((call) => call.operation === "update")).toBe(false);
  });

  it("does not return raw network exception details", async () => {
    fetchMock.mockRejectedValueOnce(new Error(RAW_DETAIL));
    await expect(generateContentPlan({ data: INPUT })).rejects.toThrow(
      "AI poskytovateľ momentálne neodpovedá.",
    );
    expect(console.error).not.toHaveBeenCalled();
  });

  it("does not expose malformed provider response text through a JSON parse error", async () => {
    fetchMock.mockResolvedValueOnce(new Response(RAW_DETAIL));
    await expect(generateContentPlan({ data: INPUT })).rejects.toThrow(
      "AI poskytovateľ vrátil neplatnú odpoveď.",
    );
    expect(console.error).not.toHaveBeenCalled();
  });
});
