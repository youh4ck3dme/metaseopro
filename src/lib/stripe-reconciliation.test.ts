import { describe, expect, it, vi } from "vitest";
import type Stripe from "stripe";
import {
  configuredPriceIds,
  invoiceSubscriptionId,
  projectCurrentSubscriptions,
  reconcileStripeEvent,
  type BillingEventStore,
  type StripeReconciliationClient,
} from "./stripe-reconciliation.server";
import type { BillingClaim, BillingEventLease } from "./billing-store.server";

const USER = "11111111-1111-4111-8111-111111111111";
const CUSTOMER = "cus_fixture";
const PRICE_IDS = { pro: "price_pro", agency: "price_agency" };
const CLAIM = {
  status: "claimed" as const,
  userId: USER,
  customerId: CUSTOMER,
  livemode: true,
  leaseToken: "22222222-2222-4222-8222-222222222222",
  generation: 7,
  checkoutSessionId: null,
  checkoutOperationId: null,
  currentSubscriptionId: "sub_current",
};

function subscription(overrides: Record<string, unknown> = {}): Stripe.Subscription {
  return {
    id: "sub_current",
    customer: CUSTOMER,
    livemode: true,
    status: "active",
    created: 1700000000,
    cancel_at_period_end: false,
    canceled_at: null,
    trial_end: null,
    metadata: { userId: USER, application: "seo4web", plan: "pro" },
    items: {
      has_more: false,
      data: [
        {
          id: "si_fixture",
          quantity: 1,
          current_period_start: 1793491200,
          current_period_end: 1796083200,
          price: {
            id: "price_pro",
            livemode: true,
            active: true,
            currency: "eur",
            unit_amount: 3900,
            type: "recurring",
            tax_behavior: "inclusive",
            recurring: { interval: "month", interval_count: 1, usage_type: "licensed" },
          },
        },
      ],
    },
    ...overrides,
  } as unknown as Stripe.Subscription;
}

function project(subs: Stripe.Subscription[], extra: Record<string, unknown> = {}) {
  return projectCurrentSubscriptions({
    subscriptions: subs,
    hasMore: false,
    customerId: CUSTOMER,
    userId: USER,
    livemode: true,
    currentSubscriptionId: "sub_current",
    eventSubscriptionId: "sub_current",
    priceIds: PRICE_IDS,
    ...extra,
  });
}

function event(type: string, object: Record<string, unknown> = {}): Stripe.Event {
  return {
    id: "evt_fixture",
    type,
    livemode: true,
    created: 1,
    data: {
      object: {
        id: type.startsWith("invoice.")
          ? "in_fixture"
          : type.startsWith("checkout.")
            ? "cs_fixture"
            : "sub_current",
        customer: CUSTOMER,
        subscription: "sub_current",
        ...object,
      },
    },
  } as unknown as Stripe.Event;
}

function dependencies(claim: BillingClaim = CLAIM) {
  const store: BillingEventStore = {
    claim: vi.fn().mockResolvedValue(claim),
    finalize: vi.fn().mockResolvedValue(true),
    fail: vi.fn().mockResolvedValue(true),
  };
  const stripe: StripeReconciliationClient = {
    subscriptions: { list: vi.fn().mockResolvedValue({ data: [subscription()], has_more: false }) },
    invoices: {
      retrieve: vi.fn().mockResolvedValue({
        id: "in_fixture",
        customer: CUSTOMER,
        livemode: true,
        number: "SYNTHETIC-001",
        hosted_invoice_url: "https://invoice.stripe.com/synthetic-fixture",
        invoice_pdf: "https://invoice.stripe.com/synthetic-fixture.pdf",
        status: "paid",
        currency: "eur",
        amount_paid: 3900,
        created: 1793491200,
        parent: { subscription_details: { subscription: "sub_current" } },
      }),
    },
    checkout: {
      sessions: {
        retrieve: vi.fn().mockResolvedValue({
          id: "cs_fixture",
          customer: CUSTOMER,
          livemode: true,
          mode: "subscription",
          metadata: {},
        }),
      },
    },
  };
  return { store, stripe };
}

describe("Stripe current subscription projection", () => {
  it("normalizes configured price IDs and rejects duplicate IDs after trimming", () => {
    vi.stubEnv("STRIPE_PRICE_PRO_MONTHLY", "  price_pro  ");
    vi.stubEnv("STRIPE_PRICE_AGENCY_MONTHLY", " price_agency ");
    try {
      expect(configuredPriceIds()).toEqual(PRICE_IDS);
      vi.stubEnv("STRIPE_PRICE_AGENCY_MONTHLY", " price_pro ");
      expect(() => configuredPriceIds()).toThrow(
        expect.objectContaining({ code: "DUPLICATE_CONFIGURED_PRICE" }),
      );
    } finally {
      vi.unstubAllEnvs();
    }
  });
  it.each([
    "active",
    "trialing",
    "past_due",
    "unpaid",
    "paused",
    "incomplete",
    "incomplete_expired",
    "canceled",
  ])("preserves actual Stripe status %s instead of collapsing to past_due", (status) => {
    expect(project([subscription({ status })]).status).toBe(status);
  });

  it("uses subscription item billing periods and cancel-at-period-end", () => {
    const result = project([subscription({ current_period_end: 1, cancel_at_period_end: true })]);
    expect(result.currentPeriodEnd).toBe("2026-12-01T00:00:00.000Z");
    expect(result.cancelAtPeriodEnd).toBe(true);
  });

  it("keeps a current subscription after a delayed deletion event for an older one", () => {
    const result = project([subscription({ id: "sub_old", status: "canceled" }), subscription()], {
      eventSubscriptionId: "sub_old",
    });
    expect(result.subscriptionId).toBe("sub_current");
    expect(result.status).toBe("active");
  });

  it("does not let two current subscriptions silently replace each other", () => {
    expect(() => project([subscription(), subscription({ id: "sub_second" })])).toThrow(
      expect.objectContaining({ code: "MULTIPLE_CURRENT_SUBSCRIPTIONS" }),
    );
  });

  it("fails closed when the bounded subscription list is incomplete", () => {
    expect(() => project([subscription()], { hasMore: true })).toThrow(
      expect.objectContaining({ code: "SUBSCRIPTION_RECONCILIATION_LIMIT" }),
    );
  });

  it("does not accept metadata-only plan assignment in live mode", () => {
    const sub = subscription();
    sub.items.data[0].price.id = "price_unconfigured";
    expect(() => project([sub])).toThrow(
      expect.objectContaining({ code: "UNRECOGNIZED_SUBSCRIPTION_PRICE" }),
    );
  });

  it("allows explicit test-mode inline metadata only with the same precise price policy", () => {
    const sub = subscription({ livemode: false });
    sub.items.data[0].price.id = "price_test_inline";
    sub.items.data[0].price.livemode = false;
    expect(project([sub], { livemode: false, priceIds: {} }).plan).toBe("pro");
    sub.items.data[0].price.unit_amount = 1;
    expect(() => project([sub], { livemode: false, priceIds: {} })).toThrow(
      expect.objectContaining({ code: "SUBSCRIPTION_PRICE_POLICY_MISMATCH" }),
    );
  });

  it.each(["currency", "unit_amount", "tax_behavior", "quantity", "interval"])(
    "rejects a changed recurring price attribute: %s",
    (attribute) => {
      const sub = subscription();
      const item = sub.items.data[0];
      if (attribute === "currency") item.price.currency = "usd";
      if (attribute === "unit_amount") item.price.unit_amount = 8900;
      if (attribute === "tax_behavior") item.price.tax_behavior = "exclusive";
      if (attribute === "quantity") item.quantity = 2;
      if (attribute === "interval") item.price.recurring!.interval = "year";
      expect(() => project([sub])).toThrow(
        expect.objectContaining({ code: "SUBSCRIPTION_PRICE_POLICY_MISMATCH" }),
      );
    },
  );

  it("does not revoke a valid existing subscription merely because its price is archived", () => {
    const sub = subscription();
    sub.items.data[0].price.active = false;
    expect(project([sub]).plan).toBe("pro");
  });

  it("still records cancellation for a legacy price absent from the current catalog", () => {
    const sub = subscription({ status: "canceled" });
    sub.items.data[0].price.id = "price_legacy";
    const result = project([sub]);
    expect(result.status).toBe("canceled");
    expect(result.plan).toBe("free");
  });

  it("rejects a customer/mode mismatch before persistence", () => {
    expect(() => project([subscription({ customer: "cus_foreign" })])).toThrow(
      expect.objectContaining({ code: "SUBSCRIPTION_CUSTOMER_MODE_MISMATCH" }),
    );
    expect(() => project([subscription({ livemode: false })])).toThrow(
      expect.objectContaining({ code: "SUBSCRIPTION_CUSTOMER_MODE_MISMATCH" }),
    );
  });

  it("rejects a foreign server metadata owner without trusting that metadata as identity", () => {
    expect(() => project([subscription({ metadata: { userId: "foreign-user" } })])).toThrow(
      expect.objectContaining({ code: "SUBSCRIPTION_OWNER_METADATA_MISMATCH" }),
    );
  });

  it("rejects missing item periods rather than inventing now plus 30 days", () => {
    const sub = subscription({ current_period_end: 1796083200 });
    sub.items.data[0].current_period_end = undefined as unknown as number;
    expect(() => project([sub])).toThrow(
      expect.objectContaining({ code: "INVALID_ITEM_BILLING_PERIOD" }),
    );
  });

  it("reads modern invoice subscription parent and legacy event payload references", () => {
    expect(
      invoiceSubscriptionId({ parent: { subscription_details: { subscription: "sub_modern" } } }),
    ).toBe("sub_modern");
    expect(invoiceSubscriptionId({ subscription: "sub_legacy" })).toBe("sub_legacy");
  });
});

describe("leased Stripe webhook reconciliation", () => {
  it.each([
    ["customer.subscription.paused", "paused"],
    ["customer.subscription.resumed", "active"],
  ])("reconciles %s from the current subscription state", async (type, status) => {
    const { store, stripe } = dependencies();
    vi.mocked(stripe.subscriptions.list).mockResolvedValue({
      data: [subscription({ status })],
      has_more: false,
    });
    await reconcileStripeEvent(event(type), stripe, store, PRICE_IDS);
    expect(store.finalize).toHaveBeenCalledWith(
      expect.objectContaining({ eventId: "evt_fixture" }),
      expect.objectContaining({ status }),
      null,
      null,
    );
  });
  it("acknowledges only completed duplicates without another Stripe read", async () => {
    const { store, stripe } = dependencies({ status: "completed" });
    expect(
      await reconcileStripeEvent(event("customer.subscription.updated"), stripe, store, PRICE_IDS),
    ).toBe("duplicate");
    expect(stripe.subscriptions.list).not.toHaveBeenCalled();
    expect(store.finalize).not.toHaveBeenCalled();
  });

  it.each(["busy", "unmapped"] as const)(
    "leaves %s events retryable without an upstream call",
    async (status) => {
      const { store, stripe } = dependencies({ status });
      await expect(
        reconcileStripeEvent(event("customer.subscription.updated"), stripe, store, PRICE_IDS),
      ).rejects.toThrow();
      expect(stripe.subscriptions.list).not.toHaveBeenCalled();
      expect(store.finalize).not.toHaveBeenCalled();
    },
  );

  it("claims durably before reading Stripe and finalizes the current projection", async () => {
    const { store, stripe } = dependencies();
    const order: string[] = [];
    vi.mocked(store.claim).mockImplementation(async () => {
      order.push("claim");
      return CLAIM;
    });
    vi.mocked(stripe.subscriptions.list).mockImplementation(async () => {
      order.push("stripe");
      return { data: [subscription()], has_more: false };
    });
    vi.mocked(store.finalize).mockImplementation(async () => {
      order.push("finalize");
      return true;
    });
    expect(
      await reconcileStripeEvent(event("customer.subscription.created"), stripe, store, PRICE_IDS),
    ).toBe("processed");
    expect(order).toEqual(["claim", "stripe", "finalize"]);
    expect(store.finalize).toHaveBeenCalledWith(
      expect.objectContaining({ generation: 7 }),
      expect.objectContaining({ status: "active", plan: "pro" }),
      null,
      null,
    );
  });

  it("late invoice.payment_failed cannot regress a subscription that is now active and paid", async () => {
    const { store, stripe } = dependencies();
    await reconcileStripeEvent(
      event("invoice.payment_failed", { status: "open" }),
      stripe,
      store,
      PRICE_IDS,
    );
    expect(store.finalize).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ status: "active" }),
      expect.objectContaining({ id: "in_fixture", status: "paid" }),
      null,
    );
  });

  it("invoice.paid and payment_succeeded pass the same real invoice identity to atomic persistence", async () => {
    const { store, stripe } = dependencies();
    for (const type of ["invoice.paid", "invoice.payment_succeeded"]) {
      await reconcileStripeEvent(event(type), stripe, store, PRICE_IDS);
    }
    const references = vi.mocked(store.finalize).mock.calls.map((args) => args[2]?.id);
    expect(references).toEqual(["in_fixture", "in_fixture"]);
  });

  it("does not turn an incomplete checkout into an active synthetic 30-day subscription", async () => {
    const { store, stripe } = dependencies();
    vi.mocked(stripe.subscriptions.list).mockResolvedValue({
      data: [subscription({ status: "incomplete" })],
      has_more: false,
    });
    await reconcileStripeEvent(event("checkout.session.completed"), stripe, store, PRICE_IDS);
    expect(store.finalize).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        status: "incomplete",
        currentPeriodEnd: "2026-12-01T00:00:00.000Z",
      }),
      null,
      null,
    );
  });

  it("uses retrieved checkout operation metadata to recover the create/finalize crash gap", async () => {
    const { store, stripe } = dependencies();
    vi.mocked(stripe.checkout.sessions.retrieve).mockResolvedValue({
      id: "cs_fixture",
      customer: CUSTOMER,
      livemode: true,
      metadata: {
        checkoutOperationId: "33333333-3333-4333-8333-333333333333",
        checkoutRequestHash: "a".repeat(64),
      },
    } as unknown as Stripe.Checkout.Session);
    await reconcileStripeEvent(
      event("checkout.session.async_payment_succeeded"),
      stripe,
      store,
      PRICE_IDS,
    );
    expect(store.finalize).toHaveBeenCalledWith(expect.anything(), expect.anything(), null, {
      operationId: "33333333-3333-4333-8333-333333333333",
      requestHash: "a".repeat(64),
      sessionId: "cs_fixture",
    });
  });

  it("does not acknowledge a stale CAS finalize and releases only its own lease", async () => {
    const { store, stripe } = dependencies();
    vi.mocked(store.finalize).mockResolvedValue(false);
    await expect(
      reconcileStripeEvent(event("customer.subscription.updated"), stripe, store, PRICE_IDS),
    ).rejects.toThrow(expect.objectContaining({ code: "BILLING_LEASE_LOST" }));
    expect(store.fail).toHaveBeenCalledWith(
      expect.objectContaining({ leaseToken: CLAIM.leaseToken, generation: 7 }),
      "BILLING_LEASE_LOST",
    );
  });

  it("does not acknowledge a persistence failure even if lease release also fails", async () => {
    const { store, stripe } = dependencies();
    vi.mocked(store.finalize).mockRejectedValue(new Error("synthetic database failure"));
    vi.mocked(store.fail).mockRejectedValue(new Error("synthetic release failure"));
    await expect(
      reconcileStripeEvent(event("customer.subscription.updated"), stripe, store, PRICE_IDS),
    ).rejects.toThrow(expect.objectContaining({ code: "BILLING_RECONCILIATION_FAILED" }));
  });

  it("rejects a retrieved invoice owned by another customer", async () => {
    const { store, stripe } = dependencies();
    vi.mocked(stripe.invoices.retrieve).mockResolvedValue({
      customer: "cus_foreign",
      livemode: true,
    } as Stripe.Invoice);
    await expect(
      reconcileStripeEvent(event("invoice.paid"), stripe, store, PRICE_IDS),
    ).rejects.toThrow(expect.objectContaining({ code: "INVOICE_CUSTOMER_MODE_MISMATCH" }));
    expect(store.finalize).not.toHaveBeenCalled();
  });

  it("ignores unrequested event types without a ledger or Stripe call", async () => {
    const { store, stripe } = dependencies();
    expect(await reconcileStripeEvent(event("charge.succeeded"), stripe, store, PRICE_IDS)).toBe(
      "ignored",
    );
    expect(store.claim).not.toHaveBeenCalled();
    expect(stripe.subscriptions.list).not.toHaveBeenCalled();
  });
});
