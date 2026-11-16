import Stripe from "stripe";
import { z } from "zod";
import {
  claimCheckout,
  failCheckout,
  finalizeCheckout,
  linkBillingCustomer,
  type BillingCheckoutInput,
  type BillingClaim,
  type BillingCustomerInput,
  type BillingLease,
} from "./billing-store.server";
import { blocksNewCheckout } from "./billing-policy";
import { resolveBillingOrigin, resolveBillingReturnUrl } from "./billing-redirect.server";
import { automaticTaxForCheckout } from "./stripe.server";
import {
  normalizeDIC,
  normalizeICDPH,
  normalizeICO,
  PLANS,
  validateCompanyBilling,
} from "./slovak-billing";

export const CheckoutInputSchema = z
  .object({
    plan: z.enum(["pro", "agency"]),
    requestId: z.string().uuid().optional(),
    companyName: z.string().trim().max(255).optional(),
    ico: z.string().trim().max(20).optional(),
    dic: z.string().trim().max(20).optional(),
    icDph: z.string().trim().max(20).optional(),
    successUrl: z.string().max(2048).optional(),
    cancelUrl: z.string().max(2048).optional(),
  })
  .strict();
export type CheckoutInput = z.infer<typeof CheckoutInputSchema>;
export const CustomerPortalInputSchema = z
  .object({ returnUrl: z.string().max(2048).optional() })
  .strict();

export class BillingActionError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "BillingActionError";
  }
}
function billingError(code: string, message: string): never {
  throw new BillingActionError(code, message);
}

export interface CheckoutStore {
  loadCustomer(userId: string): Promise<string | null>;
  link(input: BillingCustomerInput): Promise<void>;
  claim(input: BillingCheckoutInput): Promise<BillingClaim>;
  finalize(lease: BillingLease, sessionId: string): Promise<boolean>;
  fail(lease: BillingLease): Promise<boolean>;
}
export function checkoutStore(loadCustomer: CheckoutStore["loadCustomer"]): CheckoutStore {
  return {
    loadCustomer,
    link: linkBillingCustomer,
    claim: claimCheckout,
    finalize: finalizeCheckout,
    fail: failCheckout,
  };
}
export interface BillingDependencies {
  stripe: Stripe | null;
  livemode: boolean;
  store: CheckoutStore;
  env?: NodeJS.ProcessEnv;
}

function requireStripe(stripe: Stripe | null): Stripe {
  return (
    stripe ??
    billingError(
      "NOT_CONFIGURED",
      "Platby ešte nie sú nakonfigurované. Predplatné nebolo aktivované.",
    )
  );
}
function verifyCustomer(
  customer: Stripe.Customer | Stripe.DeletedCustomer,
  userId: string,
  livemode: boolean,
): asserts customer is Stripe.Customer {
  if (
    customer.deleted ||
    customer.livemode !== livemode ||
    (customer.metadata.userId && customer.metadata.userId !== userId)
  ) {
    billingError(
      "CUSTOMER_MISMATCH",
      "Stripe zákazníka sa nepodarilo bezpečne priradiť k tomuto účtu.",
    );
  }
}
async function ownedCustomer(
  userId: string,
  deps: BillingDependencies,
  allowCreate: boolean,
): Promise<string> {
  const stripe = requireStripe(deps.stripe);
  const customerId = await deps.store.loadCustomer(userId);
  if (customerId) {
    const customer = await stripe.customers.retrieve(customerId);
    verifyCustomer(customer, userId, deps.livemode);
    await deps.store.link({ userId, customerId: customer.id, livemode: deps.livemode });
    return customer.id;
  }
  if (!allowCreate)
    billingError("NO_CUSTOMER", "K tomuto účtu ešte nie je priradený Stripe zákazník.");
  // Only immutable identity goes into this idempotent request. Checkout collects email/address.
  const customer = await stripe.customers.create(
    { metadata: { userId, application: "seo4web" } },
    { idempotencyKey: `seo4web:customer:${deps.livemode ? "live" : "test"}:${userId}` },
  );
  verifyCustomer(customer, userId, deps.livemode);
  await deps.store.link({ userId, customerId: customer.id, livemode: deps.livemode });
  return customer.id;
}

async function lineItems(
  input: CheckoutInput,
  deps: BillingDependencies,
): Promise<Stripe.Checkout.SessionCreateParams.LineItem[]> {
  const stripe = requireStripe(deps.stripe);
  const config = PLANS[input.plan];
  const env = deps.env ?? process.env;
  if (
    env.STRIPE_PRICE_PRO_MONTHLY?.trim() &&
    env.STRIPE_PRICE_PRO_MONTHLY.trim() === env.STRIPE_PRICE_AGENCY_MONTHLY?.trim()
  ) {
    billingError("PRICE_MISMATCH", "Pro a Agency nemôžu používať rovnaké Stripe Price ID.");
  }
  const priceId = config.priceIdEnvVar ? env[config.priceIdEnvVar]?.trim() : undefined;
  if (!priceId) {
    if (deps.livemode)
      billingError("PRICE_REQUIRED", `Pre ${config.name} chýba produkčné Price ID.`);
    return [
      {
        price_data: {
          currency: "eur",
          unit_amount: config.priceMonthly * 100,
          tax_behavior: "inclusive",
          recurring: { interval: "month" },
          product_data: { name: `SEO4WEB ${config.name}`, metadata: { seo4web_plan: input.plan } },
        },
        quantity: 1,
      },
    ];
  }
  if (!/^price_[A-Za-z0-9_]+$/.test(priceId))
    billingError("PRICE_INVALID", "Nakonfigurované Price ID má neplatný formát.");
  const price = await stripe.prices.retrieve(priceId, { expand: ["product"] });
  const product = price.product;
  if (
    !price.active ||
    price.livemode !== deps.livemode ||
    price.type !== "recurring" ||
    price.currency !== "eur" ||
    price.unit_amount !== config.priceMonthly * 100 ||
    price.recurring?.interval !== "month" ||
    price.recurring.interval_count !== 1 ||
    price.recurring.usage_type !== "licensed" ||
    price.billing_scheme !== "per_unit" ||
    price.transform_quantity ||
    price.tax_behavior !== "inclusive" ||
    typeof product === "string" ||
    product.deleted ||
    !product.active ||
    (product.metadata.seo4web_plan && product.metadata.seo4web_plan !== input.plan)
  ) {
    billingError(
      "PRICE_MISMATCH",
      "Stripe cena nezodpovedá mesačnému cenníku aplikácie. Platbu musí skontrolovať správca.",
    );
  }
  return [{ price: price.id, quantity: 1 }];
}

async function assertNoCurrentSubscription(
  stripe: Stripe,
  customerId: string,
  livemode: boolean,
): Promise<void> {
  const subscriptions = await stripe.subscriptions.list({
    customer: customerId,
    status: "all",
    limit: 100,
  });
  if (subscriptions.has_more)
    billingError(
      "RECONCILIATION_REQUIRED",
      "História predplatného vyžaduje kontrolu pred novou platbou.",
    );
  for (const subscription of subscriptions.data) {
    const owner =
      typeof subscription.customer === "string" ? subscription.customer : subscription.customer.id;
    if (owner !== customerId || subscription.livemode !== livemode)
      billingError("CUSTOMER_MISMATCH", "Nepodarilo sa overiť vlastníka predplatného.");
    if (blocksNewCheckout(subscription.status)) {
      billingError(
        "USE_CUSTOMER_PORTAL",
        "Predplatné už existuje. Platbu alebo zmenu plánu vyrieš cez Spravovať predplatné v Stripe.",
      );
    }
  }
}
function sessionCustomer(session: Stripe.Checkout.Session): string | null {
  return typeof session.customer === "string" ? session.customer : (session.customer?.id ?? null);
}
function checkoutUrl(session: Stripe.Checkout.Session): string {
  if (!session.url || session.status !== "open")
    billingError(
      "SESSION_NOT_OPEN",
      "Platobná relácia už nie je otvorená. Obnov nastavenia predplatného.",
    );
  const parsed = new URL(session.url);
  if (
    parsed.protocol !== "https:" ||
    parsed.hostname !== "checkout.stripe.com" ||
    parsed.username ||
    parsed.password
  ) {
    billingError("INVALID_CHECKOUT_URL", "Stripe nevrátil platnú adresu platobnej stránky.");
  }
  return session.url;
}
async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function startCheckout(
  input: CheckoutInput,
  userId: string,
  deps: BillingDependencies,
) {
  const stripe = requireStripe(deps.stripe);
  const data = CheckoutInputSchema.parse(input);
  z.string().uuid().parse(userId);
  const validation = validateCompanyBilling(data);
  if (!validation.valid)
    billingError(
      "INVALID_BILLING",
      Object.values(validation.errors)[0] ?? "Neplatné fakturačné údaje.",
    );
  const env = deps.env ?? process.env;
  const origin = resolveBillingOrigin(env.SITE_URL, env.NODE_ENV);
  const successUrl = resolveBillingReturnUrl(
    data.successUrl,
    "/dashboard?payment=success&session_id={CHECKOUT_SESSION_ID}",
    origin,
  );
  const cancelUrl = resolveBillingReturnUrl(data.cancelUrl, "/dashboard?payment=cancelled", origin);
  // Production cannot silently run untaxed or invent a replacement price.
  const automaticTax = deps.env
    ? env.STRIPE_AUTOMATIC_TAX_ENABLED === "true"
    : automaticTaxForCheckout(deps.livemode);
  if (deps.livemode && !automaticTax)
    billingError(
      "TAX_NOT_CONFIGURED",
      "Platby čakajú na Stripe Tax a overenie daňových registrácií predajcu.",
    );
  const items = await lineItems(data, deps);
  const customerId = await ownedCustomer(userId, deps, true);
  // Avoid creating an operation for an already subscribed customer. Recheck under the lease below.
  await assertNoCurrentSubscription(stripe, customerId, deps.livemode);
  const metadata = {
    application: "seo4web",
    userId,
    plan: data.plan,
    companyName: data.companyName || "",
    ico: data.ico ? normalizeICO(data.ico) : "",
    dic: data.dic ? normalizeDIC(data.dic) : "",
    icDph: data.icDph ? normalizeICDPH(data.icDph) : "",
  };
  const params: Stripe.Checkout.SessionCreateParams = {
    mode: "subscription",
    customer: customerId,
    client_reference_id: userId,
    line_items: items,
    success_url: successUrl,
    cancel_url: cancelUrl,
    metadata,
    subscription_data: { metadata },
    tax_id_collection: { enabled: true },
    billing_address_collection: "required",
    customer_update: { address: "auto", name: "auto" },
    automatic_tax: { enabled: automaticTax },
    allow_promotion_codes: true,
  };
  const requestHash = await sha256(JSON.stringify(params));
  const claim = await deps.store.claim({
    userId,
    customerId,
    livemode: deps.livemode,
    requestId: data.requestId ?? crypto.randomUUID(),
    requestHash,
  });
  if (
    claim.status !== "claimed" ||
    !claim.checkoutOperationId ||
    typeof claim.checkoutOperationCompleted !== "boolean"
  ) {
    billingError(
      "CHECKOUT_BUSY",
      claim.status === "conflict" || claim.status === "blocked"
        ? "Predošlý pokus o platbu čaká na overenie. Nespúšťaj druhé predplatné; obnov nastavenia alebo kontaktuj podporu."
        : "Predplatné sa práve aktualizuje. Skús to o chvíľu.",
    );
  }
  try {
    await assertNoCurrentSubscription(stripe, customerId, deps.livemode);
    if (claim.checkoutOperationCompleted && !claim.checkoutSessionId) {
      billingError(
        "RECONCILIATION_REQUIRED",
        "Dokončenému pokusu chýba platobná relácia. Obráť sa na podporu.",
      );
    }
    if (claim.checkoutSessionId) {
      const previous = await stripe.checkout.sessions.retrieve(claim.checkoutSessionId);
      if (
        sessionCustomer(previous) !== customerId ||
        previous.livemode !== deps.livemode ||
        previous.mode !== "subscription"
      ) {
        billingError(
          "SESSION_OWNER_MISMATCH",
          "Vlastníka predchádzajúcej platby sa nepodarilo overiť.",
        );
      }
      if (previous.status === "complete")
        billingError(
          "PAYMENT_PENDING",
          "Predchádzajúca platba sa spracúva. Obnov stav predplatného.",
        );
      if (previous.status !== "open" && previous.status !== "expired") {
        billingError(
          "RECONCILIATION_REQUIRED",
          "Stav predchádzajúcej platby nie je známy. Najprv ho musí overiť podpora.",
        );
      }
      if (previous.status === "open" && previous.metadata?.checkoutRequestHash === requestHash) {
        const url = checkoutUrl(previous);
        if (!(await deps.store.finalize(claim, previous.id)))
          billingError("LEASE_LOST", "Stav platby sa zmenil. Obnov nastavenia predplatného.");
        return { url, sessionId: previous.id, mock: false as const };
      }
      if (
        claim.checkoutOperationCompleted ||
        previous.metadata?.checkoutOperationId === claim.checkoutOperationId
      ) {
        billingError(
          "SESSION_EXPIRED",
          "Tento pokus o platbu vypršal. Zatvor dialóg a vytvor nový pokus.",
        );
      }
      if (previous.status === "open") {
        const expired = await stripe.checkout.sessions.expire(previous.id);
        if (
          expired.id !== previous.id ||
          expired.status !== "expired" ||
          sessionCustomer(expired) !== customerId ||
          expired.livemode !== deps.livemode
        ) {
          billingError(
            "RECONCILIATION_REQUIRED",
            "Predchádzajúcu platobnú reláciu sa nepodarilo uzavrieť.",
          );
        }
      }
    }
    const session = await stripe.checkout.sessions.create(
      {
        ...params,
        metadata: {
          ...metadata,
          checkoutOperationId: claim.checkoutOperationId,
          checkoutRequestHash: requestHash,
        },
      },
      { idempotencyKey: `seo4web:checkout:${claim.checkoutOperationId}` },
    );
    if (
      sessionCustomer(session) !== customerId ||
      session.livemode !== deps.livemode ||
      session.mode !== "subscription"
    ) {
      billingError("SESSION_OWNER_MISMATCH", "Stripe vrátil neočakávanú platobnú reláciu.");
    }
    const url = checkoutUrl(session);
    if (!(await deps.store.finalize(claim, session.id)))
      billingError(
        "LEASE_LOST",
        "Platba sa pripravila, ale potvrdenie čaká na overenie. Opakuj ten istý pokus.",
      );
    return { url, sessionId: session.id, mock: false as const };
  } catch (error) {
    // Keep the durable operation/key after uncertain network outcomes; only release this lease.
    await deps.store.fail(claim).catch(() => undefined);
    throw error;
  }
}

export async function openCustomerPortal(
  input: z.infer<typeof CustomerPortalInputSchema>,
  userId: string,
  deps: BillingDependencies,
) {
  const stripe = requireStripe(deps.stripe);
  const data = CustomerPortalInputSchema.parse(input);
  z.string().uuid().parse(userId);
  const env = deps.env ?? process.env;
  const origin = resolveBillingOrigin(env.SITE_URL, env.NODE_ENV);
  const returnUrl = resolveBillingReturnUrl(data.returnUrl, "/settings/agency?tab=billing", origin);
  const customerId = await ownedCustomer(userId, deps, false);
  // Delinquent/canceled customers also need this to update payment details and view invoices.
  const session = await stripe.billingPortal.sessions.create({
    customer: customerId,
    return_url: returnUrl,
  });
  const url = new URL(session.url);
  if (
    url.protocol !== "https:" ||
    url.hostname !== "billing.stripe.com" ||
    url.username ||
    url.password
  ) {
    billingError("INVALID_PORTAL_URL", "Stripe nevrátil platnú adresu zákazníckeho portálu.");
  }
  return { url: session.url };
}
