import type Stripe from "stripe";
import { PLANS } from "./slovak-billing";
import {
  billingEventStore,
  CheckoutReferenceSchema,
  StripeInvoiceReferenceSchema,
  SubscriptionProjectionSchema,
  STRIPE_SUBSCRIPTION_STATUSES,
  type BillingEventInput,
  type BillingEventLease,
  type BillingClaim,
  type CheckoutReference,
  type StripeInvoiceReference,
  type SubscriptionProjection,
} from "./billing-store.server";

export const BILLING_WEBHOOK_EVENTS = new Set([
  "checkout.session.completed",
  "checkout.session.async_payment_succeeded",
  "checkout.session.async_payment_failed",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "customer.subscription.paused",
  "customer.subscription.resumed",
  "invoice.payment_succeeded",
  "invoice.payment_failed",
  "invoice.paid",
]);

type PaidPlan = "pro" | "agency";
export type ConfiguredPriceIds = { pro?: string; agency?: string };
export type StripeReconciliationClient = {
  subscriptions: {
    list(
      input: Stripe.SubscriptionListParams,
    ): Promise<{ data: Stripe.Subscription[]; has_more: boolean }>;
  };
  invoices: { retrieve(id: string): Promise<Stripe.Invoice> };
  checkout: { sessions: { retrieve(id: string): Promise<Stripe.Checkout.Session> } };
};
export type BillingEventStore = {
  claim(input: BillingEventInput): Promise<BillingClaim>;
  finalize(
    lease: BillingEventLease,
    projection: SubscriptionProjection,
    invoice: StripeInvoiceReference | null,
    checkout: CheckoutReference | null,
  ): Promise<boolean>;
  fail(lease: BillingEventLease, errorCode: string): Promise<boolean>;
};

export class StripeReconciliationError extends Error {
  constructor(public readonly code: string) {
    super("Stripe billing reconciliation requires a retry or operator review.");
    this.name = "StripeReconciliationError";
  }
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function stripeId(value: unknown, prefix: string): string | null {
  const id = typeof value === "string" ? value : record(value)?.id;
  return typeof id === "string" &&
    id.length <= 255 &&
    id.startsWith(prefix) &&
    /^[A-Za-z0-9_]+$/.test(id)
    ? id
    : null;
}

export function invoiceSubscriptionId(invoice: unknown): string | null {
  const data = record(invoice);
  const modern = record(record(data?.parent)?.subscription_details)?.subscription;
  // Event destinations can retain an older payload version; retrieve() uses the installed SDK version.
  return stripeId(modern, "sub_") || stripeId(data?.subscription, "sub_");
}

function eventSubscriptionId(event: Stripe.Event): string | null {
  const data = record(event.data.object);
  if (event.type.startsWith("customer.subscription.")) return stripeId(data?.id, "sub_");
  if (event.type.startsWith("invoice.")) return invoiceSubscriptionId(data);
  return stripeId(data?.subscription, "sub_");
}

function iso(seconds: number | null | undefined): string | null {
  if (seconds === null || seconds === undefined) return null;
  if (!Number.isSafeInteger(seconds) || seconds < 0 || seconds > 253402300799) {
    throw new StripeReconciliationError("INVALID_STRIPE_TIMESTAMP");
  }
  return new Date(seconds * 1000).toISOString();
}

export function configuredPriceIds(): ConfiguredPriceIds {
  const pro = process.env.STRIPE_PRICE_PRO_MONTHLY?.trim();
  const agency = process.env.STRIPE_PRICE_AGENCY_MONTHLY?.trim();
  if (pro && agency && pro === agency)
    throw new StripeReconciliationError("DUPLICATE_CONFIGURED_PRICE");
  return { pro, agency };
}

function validatePrice(item: Stripe.SubscriptionItem, plan: PaidPlan, livemode: boolean) {
  const price = item.price;
  if (
    item.quantity !== 1 ||
    price.livemode !== livemode ||
    price.currency !== "eur" ||
    price.unit_amount !== PLANS[plan].priceMonthly * 100 ||
    price.type !== "recurring" ||
    price.recurring?.interval !== "month" ||
    price.recurring.interval_count !== 1 ||
    price.recurring.usage_type !== "licensed" ||
    price.tax_behavior !== "inclusive"
  ) {
    throw new StripeReconciliationError("SUBSCRIPTION_PRICE_POLICY_MISMATCH");
  }
  // price.active gates NEW sales, not continued entitlement on an already subscribed archived price.
}

function resolvePlan(
  subscription: Stripe.Subscription,
  ids: ConfiguredPriceIds,
): { plan: PaidPlan; item: Stripe.SubscriptionItem } {
  if (subscription.items.has_more || subscription.items.data.length !== 1) {
    throw new StripeReconciliationError("UNSUPPORTED_SUBSCRIPTION_ITEMS");
  }
  if (ids.pro && ids.agency && ids.pro === ids.agency) {
    throw new StripeReconciliationError("DUPLICATE_CONFIGURED_PRICE");
  }
  const item = subscription.items.data[0];
  let plan: PaidPlan | undefined;
  if (ids.pro && item.price.id === ids.pro) plan = "pro";
  if (ids.agency && item.price.id === ids.agency) plan = "agency";
  if (!plan && !subscription.livemode && subscription.metadata.application === "seo4web") {
    const candidate = subscription.metadata.plan;
    if (candidate === "pro" || candidate === "agency") plan = candidate;
  }
  if (!plan) throw new StripeReconciliationError("UNRECOGNIZED_SUBSCRIPTION_PRICE");
  validatePrice(item, plan, subscription.livemode);
  return { plan, item };
}

export function projectCurrentSubscriptions(input: {
  subscriptions: Stripe.Subscription[];
  hasMore: boolean;
  customerId: string;
  userId: string;
  livemode: boolean;
  currentSubscriptionId: string | null;
  eventSubscriptionId: string | null;
  priceIds: ConfiguredPriceIds;
}): SubscriptionProjection {
  if (input.hasMore) throw new StripeReconciliationError("SUBSCRIPTION_RECONCILIATION_LIMIT");
  for (const sub of input.subscriptions) {
    if (stripeId(sub.customer, "cus_") !== input.customerId || sub.livemode !== input.livemode) {
      throw new StripeReconciliationError("SUBSCRIPTION_CUSTOMER_MODE_MISMATCH");
    }
    if (sub.metadata.userId && sub.metadata.userId !== input.userId) {
      throw new StripeReconciliationError("SUBSCRIPTION_OWNER_METADATA_MISMATCH");
    }
    if (!(STRIPE_SUBSCRIPTION_STATUSES as readonly string[]).includes(sub.status)) {
      throw new StripeReconciliationError("UNSUPPORTED_SUBSCRIPTION_STATUS");
    }
  }
  const current = input.subscriptions.filter(
    (s) => s.status !== "canceled" && s.status !== "incomplete_expired",
  );
  if (current.length > 1) throw new StripeReconciliationError("MULTIPLE_CURRENT_SUBSCRIPTIONS");
  // Terminal selection affects history only. No event.created timestamp controls entitlement or dedupe.
  const selected =
    current[0] ||
    input.subscriptions.find((s) => s.id === input.currentSubscriptionId) ||
    input.subscriptions.find((s) => s.id === input.eventSubscriptionId) ||
    [...input.subscriptions].sort((a, b) => b.created - a.created || b.id.localeCompare(a.id))[0];
  if (!selected) {
    if (input.currentSubscriptionId || input.eventSubscriptionId) {
      throw new StripeReconciliationError("EXPECTED_SUBSCRIPTION_NOT_FOUND");
    }
    return SubscriptionProjectionSchema.parse({
      subscriptionId: null,
      priceId: null,
      plan: "free",
      status: "canceled",
      currentPeriodStart: null,
      currentPeriodEnd: null,
      cancelAtPeriodEnd: false,
      canceledAt: null,
      trialEnd: null,
    });
  }
  if (selected.status === "canceled" || selected.status === "incomplete_expired") {
    // Revocation must still land for an archived/legacy price that is no longer in the catalog.
    // A missing catalog match can never keep a terminated subscription entitled.
    let plan: "free" | PaidPlan = "free";
    try {
      plan = resolvePlan(selected, input.priceIds).plan;
    } catch {
      /* terminal, no paid entitlement */
    }
    const item = selected.items.data[0];
    return SubscriptionProjectionSchema.parse({
      subscriptionId: selected.id,
      priceId: stripeId(item?.price?.id, "price_"),
      plan,
      status: selected.status,
      currentPeriodStart: iso(item?.current_period_start),
      currentPeriodEnd: iso(item?.current_period_end),
      cancelAtPeriodEnd: selected.cancel_at_period_end,
      canceledAt: iso(selected.canceled_at),
      trialEnd: iso(selected.trial_end),
    });
  }
  const { plan, item } = resolvePlan(selected, input.priceIds);
  const start = iso(item.current_period_start);
  const end = iso(item.current_period_end);
  if (!start || !end || item.current_period_end <= item.current_period_start) {
    throw new StripeReconciliationError("INVALID_ITEM_BILLING_PERIOD");
  }
  return SubscriptionProjectionSchema.parse({
    subscriptionId: selected.id,
    priceId: item.price.id,
    plan,
    status: selected.status,
    currentPeriodStart: start,
    currentPeriodEnd: end,
    cancelAtPeriodEnd: selected.cancel_at_period_end,
    canceledAt: iso(selected.canceled_at),
    trialEnd: iso(selected.trial_end),
  });
}

function invoiceReference(
  invoice: Stripe.Invoice,
  lease: BillingEventLease,
): StripeInvoiceReference {
  if (
    stripeId(invoice.customer, "cus_") !== lease.customerId ||
    invoice.livemode !== lease.livemode
  ) {
    throw new StripeReconciliationError("INVOICE_CUSTOMER_MODE_MISMATCH");
  }
  for (const url of [invoice.hosted_invoice_url, invoice.invoice_pdf]) {
    if (url) {
      const parsed = new URL(url);
      if (parsed.protocol !== "https:" || parsed.username || parsed.password) {
        throw new StripeReconciliationError("INVALID_STRIPE_INVOICE_URL");
      }
    }
  }
  return StripeInvoiceReferenceSchema.parse({
    id: invoice.id,
    subscriptionId: invoiceSubscriptionId(invoice),
    number: invoice.number,
    hostedInvoiceUrl: invoice.hosted_invoice_url,
    invoicePdfUrl: invoice.invoice_pdf,
    status: invoice.status,
    currency: invoice.currency,
    amountPaid: invoice.amount_paid,
    created: invoice.created,
  });
}

function checkoutReference(
  session: Stripe.Checkout.Session,
  lease: BillingEventLease,
): CheckoutReference | null {
  if (
    stripeId(session.customer, "cus_") !== lease.customerId ||
    session.livemode !== lease.livemode
  ) {
    throw new StripeReconciliationError("CHECKOUT_CUSTOMER_MODE_MISMATCH");
  }
  const operationId = session.metadata?.checkoutOperationId;
  const requestHash = session.metadata?.checkoutRequestHash;
  if (!operationId && !requestHash) return null; // Legacy checkout: mapping must be verified separately.
  return CheckoutReferenceSchema.parse({ operationId, requestHash, sessionId: session.id });
}

export async function reconcileStripeEvent(
  event: Stripe.Event,
  stripe: StripeReconciliationClient,
  store: BillingEventStore = billingEventStore,
  priceIds?: ConfiguredPriceIds,
): Promise<"processed" | "duplicate" | "ignored"> {
  if (!BILLING_WEBHOOK_EVENTS.has(event.type)) return "ignored";
  const customerId = stripeId(record(event.data.object)?.customer, "cus_");
  if (!customerId) throw new StripeReconciliationError("EVENT_CUSTOMER_MISSING");
  const claim = await store.claim({
    eventId: event.id,
    eventType: event.type,
    customerId,
    livemode: event.livemode,
  });
  if (claim.status === "completed") return "duplicate";
  if (claim.status !== "claimed") {
    throw new StripeReconciliationError(
      claim.status === "busy" ? "BILLING_LEASE_BUSY" : "BILLING_CUSTOMER_UNMAPPED",
    );
  }
  const lease: BillingEventLease = { ...claim, eventId: event.id };
  try {
    // Every Stripe read is AFTER durable claim of the shared customer lease.
    const subscriptions = await stripe.subscriptions.list({
      customer: customerId,
      status: "all",
      limit: 100,
    });
    const projection = projectCurrentSubscriptions({
      subscriptions: subscriptions.data,
      hasMore: subscriptions.has_more,
      customerId,
      userId: lease.userId,
      livemode: lease.livemode,
      currentSubscriptionId: lease.currentSubscriptionId,
      eventSubscriptionId: eventSubscriptionId(event),
      priceIds: priceIds ?? configuredPriceIds(),
    });
    let invoice: StripeInvoiceReference | null = null;
    let checkout: CheckoutReference | null = null;
    if (event.type.startsWith("invoice.")) {
      const id = stripeId(record(event.data.object)?.id, "in_");
      if (!id) throw new StripeReconciliationError("EVENT_INVOICE_MISSING");
      invoice = invoiceReference(await stripe.invoices.retrieve(id), lease);
    }
    if (event.type.startsWith("checkout.session.")) {
      const id = stripeId(record(event.data.object)?.id, "cs_");
      if (!id) throw new StripeReconciliationError("EVENT_CHECKOUT_MISSING");
      checkout = checkoutReference(await stripe.checkout.sessions.retrieve(id), lease);
    }
    if (!(await store.finalize(lease, projection, invoice, checkout))) {
      throw new StripeReconciliationError("BILLING_LEASE_LOST");
    }
    return "processed";
  } catch (error) {
    const code =
      error instanceof StripeReconciliationError ? error.code : "BILLING_RECONCILIATION_FAILED";
    try {
      await store.fail(lease, code);
    } catch {
      /* Preserve retryable failure; never acknowledge success. */
    }
    throw new StripeReconciliationError(code);
  }
}
