import type Stripe from "stripe";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BillingClaim } from "./billing-store.server";

// Unit tests must never initialize or contact the real persistence boundary.
vi.mock("./billing-store.server", () => {
  const unexpected = () => {
    throw new Error("Unexpected real billing-store call");
  };
  return {
    claimCheckout: unexpected,
    failCheckout: unexpected,
    finalizeCheckout: unexpected,
    linkBillingCustomer: unexpected,
  };
});

import {
  startCheckout,
  openCustomerPortal,
  type BillingDependencies,
  type CheckoutInput,
  type CheckoutStore,
} from "./billing-checkout.server";

const OWNER = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const REQUEST = "33333333-3333-4333-8333-333333333333";
const LEASE = "44444444-4444-4444-8444-444444444444";
const OPERATION = "55555555-5555-4555-8555-555555555555";
const OLD_OPERATION = "66666666-6666-4666-8666-666666666666";
const CUSTOMER = "cus_owned";
const CHECKOUT_URL = "https://checkout.stripe.com/c/pay/cs_fixture";
const PORTAL_URL = "https://billing.stripe.com/p/session/fixture";
const SITE_URL = "https://seo4web.example";
const input: CheckoutInput = { plan: "pro", requestId: REQUEST };

function customer(livemode = true, changes: Partial<Stripe.Customer> = {}): Stripe.Customer {
  return {
    id: CUSTOMER,
    object: "customer",
    livemode,
    metadata: { userId: OWNER, application: "seo4web" },
    ...changes,
  } as Stripe.Customer;
}
function price(
  id = "price_pro",
  livemode = true,
  changes: Partial<Stripe.Price> = {},
): Stripe.Price {
  const plan = id === "price_agency" ? "agency" : "pro";
  return {
    id,
    object: "price",
    active: true,
    livemode,
    type: "recurring",
    currency: "eur",
    unit_amount: plan === "pro" ? 3900 : 8900,
    recurring: {
      interval: "month",
      interval_count: 1,
      usage_type: "licensed",
      trial_period_days: null,
    },
    billing_scheme: "per_unit",
    transform_quantity: null,
    tax_behavior: "inclusive",
    product: {
      id: "prod_" + plan,
      object: "product",
      active: true,
      livemode,
      metadata: { seo4web_plan: plan },
    } as unknown as Stripe.Product,
    ...changes,
  } as Stripe.Price;
}
function session(
  livemode = true,
  changes: Partial<Stripe.Checkout.Session> = {},
): Stripe.Checkout.Session {
  return {
    id: "cs_created",
    object: "checkout.session",
    customer: CUSTOMER,
    mode: "subscription",
    livemode,
    status: "open",
    url: CHECKOUT_URL,
    metadata: {},
    ...changes,
  } as Stripe.Checkout.Session;
}
function subscription(status: Stripe.Subscription.Status, livemode = true): Stripe.Subscription {
  return {
    id: "sub_existing",
    object: "subscription",
    customer: CUSTOMER,
    livemode,
    status,
  } as Stripe.Subscription;
}
function listing(
  data: Stripe.Subscription[] = [],
  has_more = false,
): Stripe.ApiList<Stripe.Subscription> {
  return { object: "list", url: "/v1/subscriptions", data, has_more };
}
function claimed(
  livemode = true,
  changes: Partial<Extract<BillingClaim, { status: "claimed" }>> = {},
): BillingClaim {
  return {
    status: "claimed",
    userId: OWNER,
    customerId: CUSTOMER,
    livemode,
    leaseToken: LEASE,
    generation: 1,
    checkoutSessionId: null,
    checkoutOperationId: OPERATION,
    checkoutOperationCompleted: false,
    currentSubscriptionId: null,
    ...changes,
  };
}

function fixture(livemode = true) {
  const retrieveCustomer = vi.fn(
    async (_id: string): Promise<Stripe.Customer | Stripe.DeletedCustomer> => customer(livemode),
  );
  const createCustomer = vi.fn(
    async (_params: Stripe.CustomerCreateParams, _options?: Stripe.RequestOptions) =>
      customer(livemode),
  );
  const retrievePrice = vi.fn(async (id: string, _params?: Stripe.PriceRetrieveParams) =>
    price(id, livemode),
  );
  const listSubscriptions = vi.fn(async (_params: Stripe.SubscriptionListParams) => listing());
  const retrieveSubscription = vi.fn(async (_id: string) => subscription("canceled", livemode));
  const retrieveSession = vi.fn(async (_id: string) => session(livemode, { id: "cs_previous" }));
  const expireSession = vi.fn(async (id: string) =>
    session(livemode, { id, status: "expired", url: null }),
  );
  const createSession = vi.fn(
    async (params: Stripe.Checkout.SessionCreateParams, _options?: Stripe.RequestOptions) =>
      session(livemode, { metadata: params.metadata as Stripe.Metadata }),
  );
  const createPortal = vi.fn(
    async (_params: Stripe.BillingPortal.SessionCreateParams) =>
      ({
        id: "bps_fixture",
        url: PORTAL_URL,
      }) as Stripe.BillingPortal.Session,
  );

  const store = {
    loadCustomer: vi.fn<CheckoutStore["loadCustomer"]>().mockResolvedValue(CUSTOMER),
    link: vi.fn<CheckoutStore["link"]>().mockResolvedValue(undefined),
    claim: vi
      .fn<CheckoutStore["claim"]>()
      .mockImplementation(async (_request) => claimed(livemode)),
    finalize: vi.fn<CheckoutStore["finalize"]>().mockResolvedValue(true),
    fail: vi.fn<CheckoutStore["fail"]>().mockResolvedValue(true),
  };
  const env: NodeJS.ProcessEnv = {
    NODE_ENV: "production",
    SITE_URL,
    STRIPE_AUTOMATIC_TAX_ENABLED: "true",
    STRIPE_PRICE_PRO_MONTHLY: "price_pro",
    STRIPE_PRICE_AGENCY_MONTHLY: "price_agency",
  };
  const stripe = {
    customers: { retrieve: retrieveCustomer, create: createCustomer },
    prices: { retrieve: retrievePrice },
    subscriptions: { list: listSubscriptions, retrieve: retrieveSubscription },
    checkout: {
      sessions: { retrieve: retrieveSession, expire: expireSession, create: createSession },
    },
    billingPortal: { sessions: { create: createPortal } },
  } as unknown as Stripe;
  const deps: BillingDependencies = { stripe, livemode, store, env };
  return {
    deps,
    env,
    store,
    retrieveCustomer,
    createCustomer,
    retrievePrice,
    listSubscriptions,
    retrieveSubscription,
    retrieveSession,
    expireSession,
    createSession,
    createPortal,
  };
}

function completedHistoricalCheckout() {
  const f = fixture();
  f.store.claim.mockResolvedValue(
    claimed(true, { checkoutSessionId: "cs_previous", currentSubscriptionId: "sub_existing" }),
  );
  f.listSubscriptions.mockResolvedValue(listing([subscription("canceled")]));
  f.retrieveSession.mockResolvedValue(
    session(true, {
      id: "cs_previous",
      status: "complete",
      url: null,
      payment_status: "paid",
      subscription: "sub_existing",
      metadata: { checkoutOperationId: OLD_OPERATION },
    }),
  );
  return f;
}

let networkGuard: ReturnType<typeof vi.fn<typeof fetch>>;
beforeEach(() => {
  networkGuard = vi.fn<typeof fetch>().mockRejectedValue(new Error("Unexpected network call"));
  vi.stubGlobal("fetch", networkGuard);
});
afterEach(() => {
  expect(networkGuard).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("checkout identity and configuration boundaries", () => {
  it("rejects duplicate configured plan prices before charging", async () => {
    const f = fixture();
    f.env.STRIPE_PRICE_AGENCY_MONTHLY = " price_pro ";
    await expect(startCheckout(input, OWNER, f.deps)).rejects.toMatchObject({
      code: "PRICE_MISMATCH",
    });
    expect(f.createSession).not.toHaveBeenCalled();
    expect(f.store.claim).not.toHaveBeenCalled();
  });
  it("does not replay a completed operation into a new session after reused session expires", async () => {
    const f = fixture();
    f.store.claim.mockResolvedValue(
      claimed(true, { checkoutOperationCompleted: true, checkoutSessionId: "cs_previous" }),
    );
    f.retrieveSession.mockResolvedValue(
      session(true, {
        id: "cs_previous",
        status: "expired",
        url: null,
        metadata: { checkoutOperationId: OLD_OPERATION },
      }),
    );
    await expect(startCheckout(input, OWNER, f.deps)).rejects.toMatchObject({
      code: "SESSION_EXPIRED",
    });
    expect(f.createSession).not.toHaveBeenCalled();
  });
  it("rejects caller-controlled owner, customer, mode and price fields before Stripe work", async () => {
    for (const [field, value] of [
      ["userId", OTHER],
      ["ownerId", OTHER],
      ["customerId", "cus_other"],
      ["livemode", false],
      ["priceId", "price_attacker"],
    ]) {
      const f = fixture();
      await expect(
        startCheckout({ ...input, [field as string]: value } as CheckoutInput, OWNER, f.deps),
      ).rejects.toThrow();
      expect(f.retrievePrice).not.toHaveBeenCalled();
      expect(f.store.loadCustomer).not.toHaveBeenCalled();
      expect(f.createSession).not.toHaveBeenCalled();
    }
  });

  it("validates authenticated identity and request IDs; free is not a checkout plan", async () => {
    const f = fixture();
    await expect(startCheckout(input, "not-a-uuid", f.deps)).rejects.toThrow();
    await expect(startCheckout({ ...input, requestId: "bad" }, OWNER, f.deps)).rejects.toThrow();
    await expect(
      startCheckout({ ...input, plan: "free" } as unknown as CheckoutInput, OWNER, f.deps),
    ).rejects.toThrow();
    expect(f.createSession).not.toHaveBeenCalled();
    expect(f.store.loadCustomer).not.toHaveBeenCalled();
  });

  it("returns no mock or success when Stripe is absent", async () => {
    const f = fixture();
    f.deps.stripe = null;
    await expect(startCheckout(input, OWNER, f.deps)).rejects.toMatchObject({
      code: "NOT_CONFIGURED",
    });
    await expect(openCustomerPortal({}, OWNER, f.deps)).rejects.toMatchObject({
      code: "NOT_CONFIGURED",
    });
    expect(f.store.loadCustomer).not.toHaveBeenCalled();
    expect(f.createSession).not.toHaveBeenCalled();
    expect(f.createPortal).not.toHaveBeenCalled();
  });

  it.each(["foreign", "wrong-mode", "deleted"] as const)(
    "rejects a %s stored customer",
    async (kind) => {
      const f = fixture();
      f.retrieveCustomer.mockResolvedValue(
        kind === "deleted"
          ? { id: CUSTOMER, object: "customer", deleted: true }
          : customer(kind !== "wrong-mode", {
              metadata: { userId: kind === "foreign" ? OTHER : OWNER },
            }),
      );
      await expect(startCheckout(input, OWNER, f.deps)).rejects.toMatchObject({
        code: "CUSTOMER_MISMATCH",
      });
      expect(f.store.link).not.toHaveBeenCalled();
      expect(f.store.claim).not.toHaveBeenCalled();
      expect(f.createSession).not.toHaveBeenCalled();
    },
  );

  it("retries a failed customer-link operation using the same identity-only customer key", async () => {
    const f = fixture();
    f.store.loadCustomer.mockResolvedValue(null);
    f.store.link.mockRejectedValueOnce(new Error("Mapping unavailable"));
    await expect(startCheckout(input, OWNER, f.deps)).rejects.toThrow("Mapping unavailable");
    expect(f.store.claim).not.toHaveBeenCalled();
    await startCheckout(input, OWNER, f.deps);
    expect(f.createCustomer).toHaveBeenCalledTimes(2);
    expect(f.createCustomer.mock.calls[0]).toEqual(f.createCustomer.mock.calls[1]);
    expect(f.createCustomer.mock.calls[0]).toEqual([
      { metadata: { userId: OWNER, application: "seo4web" } },
      { idempotencyKey: "seo4web:customer:live:" + OWNER },
    ]);
    expect(f.store.link).toHaveBeenLastCalledWith({
      userId: OWNER,
      customerId: CUSTOMER,
      livemode: true,
    });
  });

  it("blocks live checkout without automatic tax or a configured Price ID", async () => {
    const missingTax = fixture();
    missingTax.env.STRIPE_AUTOMATIC_TAX_ENABLED = "false";
    await expect(startCheckout(input, OWNER, missingTax.deps)).rejects.toMatchObject({
      code: "TAX_NOT_CONFIGURED",
    });
    expect(missingTax.store.loadCustomer).not.toHaveBeenCalled();
    const missingPrice = fixture();
    delete missingPrice.env.STRIPE_PRICE_PRO_MONTHLY;
    await expect(startCheckout(input, OWNER, missingPrice.deps)).rejects.toMatchObject({
      code: "PRICE_REQUIRED",
    });
    expect(missingPrice.store.loadCustomer).not.toHaveBeenCalled();
    expect(missingPrice.createSession).not.toHaveBeenCalled();
  });

  it.each([
    ["currency", { currency: "usd" }],
    ["amount", { unit_amount: 2900 }],
    ["mode", { livemode: false }],
    ["tax behavior", { tax_behavior: "exclusive" }],
    ["inactive", { active: false }],
    ["metered", { recurring: { interval: "month", interval_count: 1, usage_type: "metered" } }],
    ["annual", { recurring: { interval: "year", interval_count: 1, usage_type: "licensed" } }],
    ["unexpanded product", { product: "prod_pro" }],
    [
      "wrong product plan",
      { product: { id: "prod_other", active: true, metadata: { seo4web_plan: "agency" } } },
    ],
  ] as const)("rejects a live catalog mismatch: %s", async (_label, changes) => {
    const f = fixture();
    f.retrievePrice.mockResolvedValue(price("price_pro", true, changes as Partial<Stripe.Price>));
    await expect(startCheckout(input, OWNER, f.deps)).rejects.toMatchObject({
      code: "PRICE_MISMATCH",
    });
    expect(f.store.loadCustomer).not.toHaveBeenCalled();
    expect(f.createSession).not.toHaveBeenCalled();
  });

  it("creates a configured live session only after checks and persistence; no entitlement is returned", async () => {
    const f = fixture();
    const result = await startCheckout(input, OWNER, f.deps);
    expect(result).toEqual({ url: CHECKOUT_URL, sessionId: "cs_created", mock: false });
    expect(f.createSession).toHaveBeenCalledTimes(1);
    const [params, options] = f.createSession.mock.calls[0];
    expect(params).toMatchObject({
      mode: "subscription",
      customer: CUSTOMER,
      client_reference_id: OWNER,
      line_items: [{ price: "price_pro", quantity: 1 }],
      automatic_tax: { enabled: true },
      tax_id_collection: { enabled: true },
      billing_address_collection: "required",
      customer_update: { address: "auto", name: "auto" },
      metadata: { userId: OWNER, plan: "pro", checkoutOperationId: OPERATION },
      subscription_data: { metadata: { userId: OWNER, plan: "pro" } },
    });
    expect(new URL(params.success_url!).origin).toBe(SITE_URL);
    expect(options?.idempotencyKey).toBe("seo4web:checkout:" + OPERATION);
    expect(params.metadata?.checkoutRequestHash).toBe(f.store.claim.mock.calls[0][0].requestHash);
    expect(f.listSubscriptions).toHaveBeenCalledTimes(2);
    expect(f.store.finalize).toHaveBeenCalledWith(
      expect.objectContaining({ checkoutOperationId: OPERATION }),
      "cs_created",
    );
    expect(f.store.fail).not.toHaveBeenCalled();
  });

  it("permits a server-mapped legacy customer/product without optional metadata", async () => {
    const f = fixture();
    f.retrieveCustomer.mockResolvedValue(customer(true, { metadata: {} }));
    const legacyProduct = { ...(price().product as Stripe.Product), metadata: {} };
    f.retrievePrice.mockResolvedValue(price("price_pro", true, { product: legacyProduct }));
    expect((await startCheckout(input, OWNER, f.deps)).sessionId).toBe("cs_created");
    // This assumes loadCustomer's mapping is trusted/service-only; the database is not simulated here.
    expect(f.store.link).toHaveBeenCalledWith({
      userId: OWNER,
      customerId: CUSTOMER,
      livemode: true,
    });
  });

  it("allows inline prices only in test mode, preserving the declared catalog amount", async () => {
    const f = fixture(false);
    delete f.env.STRIPE_PRICE_PRO_MONTHLY;
    f.env.STRIPE_AUTOMATIC_TAX_ENABLED = "false";
    await startCheckout(input, OWNER, f.deps);
    expect(f.retrievePrice).not.toHaveBeenCalled();
    expect(f.createSession.mock.calls[0][0]).toMatchObject({
      line_items: [
        {
          price_data: {
            currency: "eur",
            unit_amount: 3900,
            tax_behavior: "inclusive",
            recurring: { interval: "month" },
          },
          quantity: 1,
        },
      ],
      automatic_tax: { enabled: false },
    });
  });
});

describe("preventing duplicate subscriptions and uncertain success", () => {
  it.each(["active", "past_due", "paused"] as const)(
    "does not sell a second subscription while %s",
    async (status) => {
      const f = fixture();
      f.listSubscriptions.mockResolvedValue(listing([subscription(status)]));
      await expect(startCheckout(input, OWNER, f.deps)).rejects.toMatchObject({
        code: "USE_CUSTOMER_PORTAL",
      });
      expect(f.store.claim).not.toHaveBeenCalled();
      expect(f.createSession).not.toHaveBeenCalled();
    },
  );

  it("rechecks subscription state after acquiring the lease", async () => {
    const f = fixture();
    f.listSubscriptions
      .mockResolvedValueOnce(listing())
      .mockResolvedValueOnce(listing([subscription("active")]));
    await expect(startCheckout(input, OWNER, f.deps)).rejects.toMatchObject({
      code: "USE_CUSTOMER_PORTAL",
    });
    expect(f.store.claim).toHaveBeenCalledTimes(1);
    expect(f.store.fail).toHaveBeenCalledTimes(1);
    expect(f.createSession).not.toHaveBeenCalled();
  });

  it("does not assume a paginated or mismatched subscription history is safe", async () => {
    const paginated = fixture();
    paginated.listSubscriptions.mockResolvedValue(listing([], true));
    await expect(startCheckout(input, OWNER, paginated.deps)).rejects.toMatchObject({
      code: "RECONCILIATION_REQUIRED",
    });
    expect(paginated.createSession).not.toHaveBeenCalled();
    const mismatch = fixture();
    mismatch.listSubscriptions.mockResolvedValue(
      listing([{ ...subscription("canceled"), customer: "cus_other" }]),
    );
    await expect(startCheckout(input, OWNER, mismatch.deps)).rejects.toMatchObject({
      code: "CUSTOMER_MISMATCH",
    });
    expect(mismatch.createSession).not.toHaveBeenCalled();
  });

  it.each([
    { status: "busy" },
    { status: "conflict", code: "CHECKOUT_PENDING_INPUT_CONFLICT" },
    { status: "blocked", code: "CHECKOUT_OPERATION_RECONCILIATION_REQUIRED" },
  ] as const)("does not create without an acquired operation: $status", async (claim) => {
    const f = fixture();
    f.store.claim.mockResolvedValue(claim);
    await expect(startCheckout(input, OWNER, f.deps)).rejects.toMatchObject({
      code: "CHECKOUT_BUSY",
    });
    expect(f.createSession).not.toHaveBeenCalled();
    expect(f.store.fail).not.toHaveBeenCalled();
  });

  it("retries the same pending operation with the same parameters and idempotency key after transport failure", async () => {
    const f = fixture();
    f.createSession.mockRejectedValueOnce(new Error("Connection lost after create"));
    await expect(startCheckout(input, OWNER, f.deps)).rejects.toThrow("Connection lost");
    await startCheckout(input, OWNER, f.deps);
    expect(f.createSession).toHaveBeenCalledTimes(2);
    expect(f.createSession.mock.calls[0]).toEqual(f.createSession.mock.calls[1]);
    expect(f.store.claim.mock.calls[0][0]).toEqual(f.store.claim.mock.calls[1][0]);
    expect(f.store.fail).toHaveBeenCalledTimes(1);
    expect(f.store.finalize).toHaveBeenCalledTimes(1);
  });

  it("reuses an open session with the same server-computed hash", async () => {
    const f = fixture();
    f.store.claim.mockResolvedValue(claimed(true, { checkoutSessionId: "cs_previous" }));
    f.retrieveSession.mockImplementation(async () =>
      session(true, {
        id: "cs_previous",
        metadata: {
          checkoutRequestHash: f.store.claim.mock.calls[0][0].requestHash,
          checkoutOperationId: OLD_OPERATION,
        },
      }),
    );
    expect(await startCheckout(input, OWNER, f.deps)).toEqual({
      url: CHECKOUT_URL,
      sessionId: "cs_previous",
      mock: false,
    });
    expect(f.createSession).not.toHaveBeenCalled();
    expect(f.expireSession).not.toHaveBeenCalled();
    expect(f.store.finalize).toHaveBeenCalledWith(expect.anything(), "cs_previous");
  });

  it("expires an open older plan session before creating the requested different plan", async () => {
    const f = fixture();
    f.store.claim.mockResolvedValue(claimed(true, { checkoutSessionId: "cs_previous" }));
    f.retrieveSession.mockResolvedValue(
      session(true, {
        id: "cs_previous",
        metadata: {
          plan: "pro",
          checkoutRequestHash: "0".repeat(64),
          checkoutOperationId: OLD_OPERATION,
        },
      }),
    );
    await startCheckout({ ...input, plan: "agency" }, OWNER, f.deps);
    expect(f.expireSession).toHaveBeenCalledWith("cs_previous");
    expect(f.expireSession.mock.invocationCallOrder[0]).toBeLessThan(
      f.createSession.mock.invocationCallOrder[0],
    );
    expect(f.createSession.mock.calls[0][0].line_items).toEqual([
      { price: "price_agency", quantity: 1 },
    ]);
  });

  it("does not create another session when expiration races with payment completion", async () => {
    const f = fixture();
    f.store.claim.mockResolvedValue(claimed(true, { checkoutSessionId: "cs_previous" }));
    f.expireSession.mockRejectedValue(new Error("Session is now complete"));
    await expect(startCheckout(input, OWNER, f.deps)).rejects.toThrow("now complete");
    expect(f.createSession).not.toHaveBeenCalled();
    expect(f.store.fail).toHaveBeenCalledTimes(1);
  });

  it("waits for reconciliation when the previous session is complete", async () => {
    const f = fixture();
    f.store.claim.mockResolvedValue(claimed(true, { checkoutSessionId: "cs_previous" }));
    f.retrieveSession.mockResolvedValue(
      session(true, { id: "cs_previous", status: "complete", url: null }),
    );
    await expect(startCheckout(input, OWNER, f.deps)).rejects.toMatchObject({
      code: "PAYMENT_PENDING",
    });
    expect(f.expireSession).not.toHaveBeenCalled();
    expect(f.createSession).not.toHaveBeenCalled();
    expect(f.store.finalize).not.toHaveBeenCalled();
  });

  it.each(["paid", "no_payment_required"] as const)(
    "allows a new operation after an owned %s historical checkout and confirmed cancellation",
    async (paymentStatus) => {
      const f = completedHistoricalCheckout();
      f.retrieveSession.mockResolvedValue(
        session(true, {
          id: "cs_previous",
          status: "complete",
          url: null,
          payment_status: paymentStatus,
          subscription: "sub_existing",
          metadata: { checkoutOperationId: OLD_OPERATION },
        }),
      );
      await expect(startCheckout(input, OWNER, f.deps)).resolves.toMatchObject({
        sessionId: "cs_created",
        mock: false,
      });
      expect(f.retrieveSubscription).toHaveBeenCalledWith("sub_existing");
      expect(f.retrieveSubscription.mock.invocationCallOrder[0]).toBeLessThan(
        f.createSession.mock.invocationCallOrder[0],
      );
      expect(f.createSession).toHaveBeenCalledTimes(1);
      expect(f.createSession.mock.calls[0][1]?.idempotencyKey).toBe(
        `seo4web:checkout:${OPERATION}`,
      );
      expect(f.expireSession).not.toHaveBeenCalled();
      expect(f.store.finalize).toHaveBeenCalledWith(expect.anything(), "cs_created");
    },
  );

  it("keeps an unpaid completed checkout blocked even when its subscription is terminal", async () => {
    const f = completedHistoricalCheckout();
    f.retrieveSession.mockResolvedValue(
      session(true, {
        id: "cs_previous",
        status: "complete",
        url: null,
        payment_status: "unpaid",
        subscription: "sub_existing",
        metadata: { checkoutOperationId: OLD_OPERATION },
      }),
    );
    await expect(startCheckout(input, OWNER, f.deps)).rejects.toMatchObject({
      code: "PAYMENT_PENDING",
    });
    expect(f.retrieveSubscription).not.toHaveBeenCalled();
    expect(f.createSession).not.toHaveBeenCalled();
  });

  it.each<{ label: string; metadata?: Stripe.Metadata; subscription?: null }>([
    { label: "same operation", metadata: { checkoutOperationId: OPERATION } },
    { label: "legacy operation", metadata: {} },
    { label: "invalid operation", metadata: { checkoutOperationId: "not-an-operation-uuid" } },
    { label: "missing subscription", subscription: null },
  ])("does not bypass completion with $label evidence", async ({ label: _label, ...changes }) => {
    const f = completedHistoricalCheckout();
    f.retrieveSession.mockResolvedValue(
      session(true, {
        id: "cs_previous",
        status: "complete",
        url: null,
        payment_status: "paid",
        subscription: "sub_existing",
        metadata: { checkoutOperationId: OLD_OPERATION },
        ...changes,
      }),
    );
    await expect(startCheckout(input, OWNER, f.deps)).rejects.toMatchObject({
      code: "PAYMENT_PENDING",
    });
    expect(f.retrieveSubscription).not.toHaveBeenCalled();
    expect(f.createSession).not.toHaveBeenCalled();
  });

  it("does not replay a completed operation even with a different historical pointer", async () => {
    const f = completedHistoricalCheckout();
    f.store.claim.mockResolvedValue(
      claimed(true, { checkoutSessionId: "cs_previous", checkoutOperationCompleted: true }),
    );
    await expect(startCheckout(input, OWNER, f.deps)).rejects.toMatchObject({
      code: "PAYMENT_PENDING",
    });
    expect(f.retrieveSubscription).not.toHaveBeenCalled();
    expect(f.createSession).not.toHaveBeenCalled();
  });

  it.each([
    { label: "wrong ID", id: "sub_other" },
    { label: "wrong customer", customer: "cus_other" },
    { label: "wrong mode", livemode: false },
    { label: "wrong metadata owner", metadata: { userId: OTHER } },
  ])("rejects historical subscription with $label", async ({ label: _label, ...changes }) => {
    const f = completedHistoricalCheckout();
    f.retrieveSubscription.mockResolvedValue({ ...subscription("canceled"), ...changes });
    await expect(startCheckout(input, OWNER, f.deps)).rejects.toMatchObject({
      code: "SUBSCRIPTION_OWNER_MISMATCH",
    });
    expect(f.createSession).not.toHaveBeenCalled();
    expect(f.store.fail).toHaveBeenCalledTimes(1);
  });

  it.each(["active", "incomplete", "past_due", "paused"] as const)(
    "does not bypass a completed checkout when refreshed subscription is %s",
    async (status) => {
      const f = completedHistoricalCheckout();
      f.retrieveSubscription.mockResolvedValue(subscription(status));
      await expect(startCheckout(input, OWNER, f.deps)).rejects.toMatchObject({
        code: "PAYMENT_PENDING",
      });
      expect(f.createSession).not.toHaveBeenCalled();
      expect(f.store.fail).toHaveBeenCalledTimes(1);
    },
  );

  it("does not create when historical subscription verification is unavailable", async () => {
    const f = completedHistoricalCheckout();
    f.retrieveSubscription.mockRejectedValue(new Error("Fixture lookup unavailable"));
    await expect(startCheckout(input, OWNER, f.deps)).rejects.toThrow("Fixture lookup unavailable");
    expect(f.createSession).not.toHaveBeenCalled();
    expect(f.store.fail).toHaveBeenCalledTimes(1);
  });

  it("does not replace a session unless Stripe confirms expiration of that owned session", async () => {
    for (const changes of [
      { status: "open" as const },
      { id: "cs_other" },
      { customer: "cus_other" },
      { livemode: false },
    ]) {
      const f = fixture();
      f.store.claim.mockResolvedValue(claimed(true, { checkoutSessionId: "cs_previous" }));
      f.expireSession.mockResolvedValue(
        session(true, { id: "cs_previous", status: "expired", ...changes }),
      );
      await expect(startCheckout(input, OWNER, f.deps)).rejects.toThrow();
      expect(f.expireSession).toHaveBeenCalledWith("cs_previous");
      expect(f.createSession).not.toHaveBeenCalled();
      expect(f.store.fail).toHaveBeenCalledTimes(1);
    }
  });

  it("does not revive an expired session belonging to the same pending operation", async () => {
    const f = fixture();
    f.store.claim.mockResolvedValue(claimed(true, { checkoutSessionId: "cs_previous" }));
    f.retrieveSession.mockResolvedValue(
      session(true, {
        id: "cs_previous",
        status: "expired",
        url: null,
        metadata: { checkoutOperationId: OPERATION },
      }),
    );
    await expect(startCheckout(input, OWNER, f.deps)).rejects.toMatchObject({
      code: "SESSION_EXPIRED",
    });
    expect(f.createSession).not.toHaveBeenCalled();
  });

  it("does not create a second checkout when the previous session state is unknown", async () => {
    const f = fixture();
    f.store.claim.mockResolvedValue(claimed(true, { checkoutSessionId: "cs_previous" }));
    f.retrieveSession.mockResolvedValue(
      session(true, { id: "cs_previous", status: null, url: null }),
    );
    await expect(startCheckout(input, OWNER, f.deps)).rejects.toThrow();
    expect(f.expireSession).not.toHaveBeenCalled();
    expect(f.createSession).not.toHaveBeenCalled();
    expect(f.store.finalize).not.toHaveBeenCalled();
  });

  it("does not expire or replace a previous session with a different owner or mode", async () => {
    for (const changes of [
      { customer: "cus_other" },
      { livemode: false },
      { mode: "payment" as const },
    ]) {
      const f = fixture();
      f.store.claim.mockResolvedValue(claimed(true, { checkoutSessionId: "cs_previous" }));
      f.retrieveSession.mockResolvedValue(session(true, { id: "cs_previous", ...changes }));
      await expect(startCheckout(input, OWNER, f.deps)).rejects.toMatchObject({
        code: "SESSION_OWNER_MISMATCH",
      });
      expect(f.expireSession).not.toHaveBeenCalled();
      expect(f.createSession).not.toHaveBeenCalled();
    }
  });

  it.each(["lost-lease", "write-error"] as const)(
    "does not return a checkout URL on finalization %s",
    async (kind) => {
      const f = fixture();
      if (kind === "lost-lease") {
        f.store.finalize.mockResolvedValue(false);
        f.store.fail.mockRejectedValue(new Error("Lease release unavailable"));
      } else f.store.finalize.mockRejectedValue(new Error("Finalization write failed"));
      const result = startCheckout(input, OWNER, f.deps);
      if (kind === "lost-lease") await expect(result).rejects.toMatchObject({ code: "LEASE_LOST" });
      else await expect(result).rejects.toThrow("Finalization write failed");
      expect(f.createSession).toHaveBeenCalledTimes(1);
      expect(f.store.fail).toHaveBeenCalledTimes(1);
    },
  );

  it("does not return a reused URL after its lease is lost", async () => {
    const f = fixture();
    f.store.claim.mockResolvedValue(claimed(true, { checkoutSessionId: "cs_previous" }));
    f.retrieveSession.mockImplementation(async () =>
      session(true, {
        id: "cs_previous",
        metadata: { checkoutRequestHash: f.store.claim.mock.calls[0][0].requestHash },
      }),
    );
    f.store.finalize.mockResolvedValue(false);
    await expect(startCheckout(input, OWNER, f.deps)).rejects.toMatchObject({ code: "LEASE_LOST" });
    expect(f.createSession).not.toHaveBeenCalled();
    expect(f.store.fail).toHaveBeenCalledTimes(1);
  });

  it("checks owner, mode and redirect origin on returned Stripe sessions", async () => {
    for (const changes of [
      { customer: "cus_other" },
      { livemode: false },
      { mode: "payment" as const },
      { url: "https://evil.example/pay" },
    ]) {
      const f = fixture();
      f.createSession.mockResolvedValue(session(true, changes));
      await expect(startCheckout(input, OWNER, f.deps)).rejects.toThrow();
      expect(f.store.finalize).not.toHaveBeenCalled();
      expect(f.store.fail).toHaveBeenCalledTimes(1);
    }
  });
});

describe("customer portal recovery", () => {
  it("uses the owned customer and same-origin return path without checking paid entitlement", async () => {
    const f = fixture();
    f.env.STRIPE_AUTOMATIC_TAX_ENABLED = "false";
    delete f.env.STRIPE_PRICE_PRO_MONTHLY;
    f.listSubscriptions.mockRejectedValue(new Error("Portal must not depend on entitlement"));
    expect(
      await openCustomerPortal({ returnUrl: "/settings/agency?tab=billing" }, OWNER, f.deps),
    ).toEqual({ url: PORTAL_URL });
    expect(f.createPortal).toHaveBeenCalledWith({
      customer: CUSTOMER,
      return_url: SITE_URL + "/settings/agency?tab=billing",
    });
    expect(f.listSubscriptions).not.toHaveBeenCalled();
    expect(f.retrievePrice).not.toHaveBeenCalled();
    expect(f.store.claim).not.toHaveBeenCalled();
    expect(f.createSession).not.toHaveBeenCalled();
  });

  it("rejects arbitrary return URLs and client-supplied ownership", async () => {
    for (const returnUrl of ["https://evil.example", "//evil.example", "/\\evil.example"]) {
      const f = fixture();
      await expect(openCustomerPortal({ returnUrl }, OWNER, f.deps)).rejects.toThrow();
      expect(f.createPortal).not.toHaveBeenCalled();
      expect(f.store.loadCustomer).not.toHaveBeenCalled();
    }
    const f = fixture();
    await expect(
      openCustomerPortal(
        { customerId: "cus_other" } as unknown as Parameters<typeof openCustomerPortal>[0],
        OWNER,
        f.deps,
      ),
    ).rejects.toThrow();
    expect(f.createPortal).not.toHaveBeenCalled();
  });

  it("does not create a customer for an account that has never used billing", async () => {
    const f = fixture();
    f.store.loadCustomer.mockResolvedValue(null);
    await expect(openCustomerPortal({}, OWNER, f.deps)).rejects.toMatchObject({
      code: "NO_CUSTOMER",
    });
    expect(f.createCustomer).not.toHaveBeenCalled();
    expect(f.createPortal).not.toHaveBeenCalled();
  });

  it("rejects cross-user customers and unexpected portal origins", async () => {
    const foreign = fixture();
    foreign.retrieveCustomer.mockResolvedValue(customer(true, { metadata: { userId: OTHER } }));
    await expect(openCustomerPortal({}, OWNER, foreign.deps)).rejects.toMatchObject({
      code: "CUSTOMER_MISMATCH",
    });
    expect(foreign.createPortal).not.toHaveBeenCalled();
    const wrongUrl = fixture();
    wrongUrl.createPortal.mockResolvedValue({
      id: "bps_fixture",
      url: "https://evil.example/portal",
    } as Stripe.BillingPortal.Session);
    await expect(openCustomerPortal({}, OWNER, wrongUrl.deps)).rejects.toMatchObject({
      code: "INVALID_PORTAL_URL",
    });
  });
});
