import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PLANS } from "./slovak-billing";

type DbReply = { data: unknown; error: { message: string } | null } | Error;
type DbCall = {
  client: "user" | "admin";
  table: string;
  operation: "select" | "upsert";
  columns?: string;
  filters?: Array<[string, unknown]>;
  payload?: unknown;
  options?: unknown;
};

const mocks = vi.hoisted(() => {
  const state = {
    userId: "11111111-1111-4111-8111-111111111111",
    authenticated: true,
    readReply: { data: null, error: null } as DbReply,
    writeReply: { data: null, error: null } as DbReply,
    calls: [] as DbCall[],
    middlewareLists: [] as unknown[][],
  };
  const resolve = async (reply: DbReply) => {
    if (reply instanceof Error) throw reply;
    return reply;
  };
  function client(kind: "user" | "admin") {
    return {
      from(table: string) {
        const call: DbCall = { client: kind, table, operation: "select", filters: [] };
        const query = {
          select(columns: string) {
            call.columns = columns;
            return query;
          },
          eq(column: string, value: unknown) {
            call.filters?.push([column, value]);
            return query;
          },
          maybeSingle() {
            state.calls.push(call);
            return resolve(state.readReply);
          },
          upsert(payload: unknown, options: unknown) {
            state.calls.push({ client: kind, table, operation: "upsert", payload, options });
            return resolve(state.writeReply);
          },
        };
        return query;
      },
    };
  }
  const user = client("user");
  const admin = client("admin");
  const requireSupabaseAuth = {
    authorize: vi.fn(async () => {
      if (!state.authenticated) throw new Error("Unauthorized fixture");
      return { userId: state.userId, supabase: user };
    }),
  };
  const unexpectedStripe = vi.fn(() => {
    throw new Error("A wrapper test must never initialize Stripe");
  });
  return { state, user, admin, requireSupabaseAuth, unexpectedStripe };
});

// Provider handlers and real Zod validators run here. The auth callback is a test fixture;
// middleware attachment/ordering in this adapter is not a live JWT, RPC transport or RLS test.
vi.mock("@tanstack/react-start", () => ({
  createServerFn: () => {
    let validate = (data: unknown) => data;
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
        mocks.state.middlewareLists.push(middleware);
        return {
          __executeServer: async (args: { data?: unknown } = {}) => {
            if (!middleware.includes(mocks.requireSupabaseAuth)) {
              throw new Error("Missing auth middleware on provider handler");
            }
            const context = await mocks.requireSupabaseAuth.authorize();
            return fn({ data: validate(args.data), context });
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
vi.mock("@/integrations/supabase/client.server", () => ({ supabaseAdmin: mocks.admin }));
vi.mock("./stripe.server", () => ({
  getStripeClient: mocks.unexpectedStripe,
  stripeLivemode: mocks.unexpectedStripe,
  automaticTaxForCheckout: mocks.unexpectedStripe,
}));

import type * as BillingFunctions from "./billing.functions";
// @ts-expect-error TanStack's Vite compiler supplies this provider module and its generated exports.
import * as provider from "./billing.functions?tss-serverfn-split";

const getUserSubscription =
  provider.getUserSubscription_createServerFn_handler as typeof BillingFunctions.getUserSubscription;
const updateCompanyBillingDetails =
  provider.updateCompanyBillingDetails_createServerFn_handler as typeof BillingFunctions.updateCompanyBillingDetails;
const createCheckoutSession =
  provider.createCheckoutSession_createServerFn_handler as typeof BillingFunctions.createCheckoutSession;
const createCustomerPortalSession =
  provider.createCustomerPortalSession_createServerFn_handler as typeof BillingFunctions.createCustomerPortalSession;

const NOW = Date.parse("2026-11-16T12:00:00.000Z");
const FUTURE_END = "2026-12-16T12:00:00.000Z";
const RAW_ERROR = "SYNTHETIC_PRIVATE_DATABASE_DETAIL";

function row(changes: Record<string, unknown> = {}) {
  return {
    plan: "pro",
    status: "active",
    current_period_end: FUTURE_END,
    stripe_customer_id: "cus_synthetic_fixture",
    company_name: "Syntetická skúšobná firma",
    ico: "00000001",
    dic: "1000000001",
    ic_dph: "SK1000000001",
    billing_address: { country: "Slovensko" },
    last_invoice_number: "SYNTHETIC-001",
    last_invoice_url: "https://example.invalid/synthetic-invoice",
    ...changes,
  };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  mocks.state.authenticated = true;
  mocks.state.readReply = { data: null, error: null };
  mocks.state.writeReply = { data: null, error: null };
  mocks.state.calls.length = 0;
  mocks.requireSupabaseAuth.authorize.mockClear();
  mocks.unexpectedStripe.mockClear();
  vi.stubGlobal(
    "fetch",
    vi.fn(() => {
      throw new Error("No network is permitted in billing wrapper unit tests");
    }),
  );
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("billing serverFn auth wrapping (mock boundary only)", () => {
  it("registers requireSupabaseAuth on all four provider handlers", () => {
    expect(mocks.state.middlewareLists).toHaveLength(4);
    for (const middleware of mocks.state.middlewareLists) {
      expect(middleware).toEqual([mocks.requireSupabaseAuth]);
    }
  });

  it.each([
    ["subscription", () => getUserSubscription()],
    ["billing update", () => updateCompanyBillingDetails({ data: {} })],
    ["checkout", () => createCheckoutSession({ data: { plan: "pro" } })],
    ["portal", () => createCustomerPortalSession({ data: {} })],
  ] as const)("stops %s when the mock authentication boundary rejects", async (_name, invoke) => {
    mocks.state.authenticated = false;
    await expect(invoke()).rejects.toThrow("Unauthorized fixture");
    expect(mocks.requireSupabaseAuth.authorize).toHaveBeenCalledTimes(1);
    expect(mocks.state.calls).toEqual([]);
    expect(mocks.unexpectedStripe).not.toHaveBeenCalled();
  });
});

describe("getUserSubscription", () => {
  it("returns inactive/free with no Stripe customer when no row exists", async () => {
    await expect(getUserSubscription()).resolves.toEqual({
      plan: "free",
      billingPlan: "free",
      status: "inactive",
      config: PLANS.free,
      hasStripeCustomer: false,
      companyName: null,
      ico: null,
      dic: null,
      icDph: null,
      billingAddress: null,
      lastInvoiceNumber: null,
      lastInvoiceUrl: null,
      currentPeriodEnd: null,
    });
    expect(mocks.state.calls).toHaveLength(1);
    expect(mocks.state.calls[0]).toMatchObject({
      client: "user",
      table: "subscriptions",
      operation: "select",
      filters: [["user_id", mocks.state.userId]],
    });
  });

  it.each([
    ["pro", "active"],
    ["agency", "trialing"],
  ] as const)("preserves effective and billing plans for unexpired %s/%s", async (plan, status) => {
    mocks.state.readReply = { data: row({ plan, status }), error: null };
    const result = await getUserSubscription();
    expect(result).toMatchObject({ plan, billingPlan: plan, status, config: PLANS[plan] });
    expect(result.hasStripeCustomer).toBe(true);
    expect(result.companyName).toBe("Syntetická skúšobná firma");
    expect(result.lastInvoiceNumber).toBe("SYNTHETIC-001");
    expect(result).not.toHaveProperty("stripe_customer_id");
  });

  it.each(["canceled", "past_due"])(
    "keeps portal eligibility for a %s customer without paid access",
    async (status) => {
      mocks.state.readReply = { data: row({ plan: "agency", status }), error: null };
      await expect(getUserSubscription()).resolves.toMatchObject({
        plan: "free",
        billingPlan: "agency",
        config: PLANS.free,
        status,
        hasStripeCustomer: true,
      });
    },
  );

  it("expires access at period end while retaining the billing tier and customer", async () => {
    mocks.state.readReply = {
      data: row({ current_period_end: new Date(NOW).toISOString() }),
      error: null,
    };
    await expect(getUserSubscription()).resolves.toMatchObject({
      plan: "free",
      billingPlan: "pro",
      status: "active",
      hasStripeCustomer: true,
      config: PLANS.free,
    });
  });

  it("reports a retained customer on a free plan and false when the customer is absent", async () => {
    mocks.state.readReply = { data: row({ plan: "free", status: "inactive" }), error: null };
    expect((await getUserSubscription()).hasStripeCustomer).toBe(true);
    mocks.state.readReply = { data: row({ stripe_customer_id: null }), error: null };
    expect((await getUserSubscription()).hasStripeCustomer).toBe(false);
  });

  it("rejects a DB error with a public message instead of returning fake free/active", async () => {
    mocks.state.readReply = { data: null, error: { message: RAW_ERROR } };
    await expect(getUserSubscription()).rejects.toThrow(
      "Stav predplatného sa nepodarilo načítať. Skús ho obnoviť.",
    );
  });

  it("sanitizes a rejected lookup Promise without leaking its raw message", async () => {
    mocks.state.readReply = new Error(RAW_ERROR);
    const request = getUserSubscription();
    await expect(request).rejects.toMatchObject({
      message: "Stav predplatného sa nepodarilo načítať. Skús ho obnoviť.",
    });
    await expect(request).rejects.not.toThrow(RAW_ERROR);
    expect(mocks.state.calls).toHaveLength(1);
  });
});

describe("updateCompanyBillingDetails", () => {
  it("uses an admin upsert with only the authenticated owner and allowlisted normalized fields", async () => {
    await expect(
      updateCompanyBillingDetails({
        data: {
          companyName: "  Syntetická skúšobná firma  ",
          ico: " 0000 0001 ",
          dic: " 1000 000001 ",
          icDph: " sk 1000000001 ",
          address: " Testovacia 1 ",
          city: " Testovacie mesto ",
          zip: " 00000 ",
          country: " Slovensko ",
        },
      }),
    ).resolves.toEqual({ success: true });

    expect(mocks.state.calls).toEqual([
      {
        client: "admin",
        table: "subscriptions",
        operation: "upsert",
        payload: {
          user_id: mocks.state.userId,
          company_name: "Syntetická skúšobná firma",
          ico: "00000001",
          dic: "1000000001",
          ic_dph: "SK1000000001",
          billing_address: {
            line1: "Testovacia 1",
            city: "Testovacie mesto",
            postal_code: "00000",
            country: "Slovensko",
          },
          updated_at: new Date(NOW).toISOString(),
        },
        options: { onConflict: "user_id" },
      },
    ]);
  });

  it.each([
    "plan",
    "status",
    "stripe_customer_id",
    "stripe_subscription_id",
    "customerId",
    "userId",
    "user_id",
    "updated_at",
  ])("rejects the unknown override field %s before writing", async (key) => {
    const data = { companyName: "Syntetická firma", [key]: "synthetic-override" };
    await expect(updateCompanyBillingDetails({ data })).rejects.toMatchObject({ name: "ZodError" });
    expect(mocks.state.calls).toEqual([]);
  });

  it("rejects malformed company identifiers before writing", async () => {
    await expect(updateCompanyBillingDetails({ data: { ico: "bad-ico" } })).rejects.toThrow(
      "Zadané IČO má neplatný formát",
    );
    expect(mocks.state.calls).toEqual([]);
  });

  it("returns a public save error when the admin upsert reports a database error", async () => {
    mocks.state.writeReply = { data: null, error: { message: RAW_ERROR } };
    await expect(
      updateCompanyBillingDetails({ data: { companyName: "Syntetická firma" } }),
    ).rejects.toThrow("Nepodarilo sa uložiť fakturačné údaje.");
    expect(mocks.state.calls).toHaveLength(1);
  });

  it("sanitizes a rejected admin upsert Promise without leaking its raw message", async () => {
    mocks.state.writeReply = new Error(RAW_ERROR);
    const request = updateCompanyBillingDetails({ data: { companyName: "Syntetická firma" } });
    await expect(request).rejects.toMatchObject({
      message: "Nepodarilo sa uložiť fakturačné údaje.",
    });
    await expect(request).rejects.not.toThrow(RAW_ERROR);
    expect(mocks.state.calls).toHaveLength(1);
    expect(mocks.state.calls[0]).toMatchObject({ client: "admin", operation: "upsert" });
  });
});
