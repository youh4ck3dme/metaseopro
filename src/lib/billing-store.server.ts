// Service-role billing boundary. RPCs live in the reviewed billing migration.
// Generated Supabase types are deliberately not edited before that migration exists.
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export const STRIPE_SUBSCRIPTION_STATUSES = [
  "active",
  "trialing",
  "past_due",
  "canceled",
  "incomplete",
  "incomplete_expired",
  "unpaid",
  "paused",
] as const;
export type StripeSubscriptionStatus = (typeof STRIPE_SUBSCRIPTION_STATUSES)[number];

const StripeCustomerId = z
  .string()
  .regex(/^cus_[A-Za-z0-9_]+$/)
  .max(255);
const StripeSubscriptionId = z
  .string()
  .regex(/^sub_[A-Za-z0-9_]+$/)
  .max(255);
const IsoDate = z.string().datetime({ offset: true });
const LeaseSchema = z
  .object({
    userId: z.string().uuid(),
    customerId: StripeCustomerId,
    livemode: z.boolean(),
    leaseToken: z.string().uuid(),
    generation: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
    checkoutSessionId: z.string().max(255).nullable(),
    checkoutOperationId: z.string().uuid().nullable(),
    // Checkout claims always set this; event claims do not have an operation.
    checkoutOperationCompleted: z.boolean().optional(),
    currentSubscriptionId: StripeSubscriptionId.nullable(),
  })
  .strict();
export type BillingLease = z.infer<typeof LeaseSchema>;

const ClaimSchema = z.discriminatedUnion("status", [
  LeaseSchema.extend({ status: z.literal("claimed") }),
  z.object({ status: z.literal("busy") }).strict(),
  z.object({ status: z.literal("completed") }).strict(),
  z.object({ status: z.literal("unmapped") }).strict(),
  z
    .object({
      status: z.literal("conflict"),
      code: z.enum([
        "REQUEST_INPUT_CONFLICT",
        "CHECKOUT_PENDING_INPUT_CONFLICT",
        "CHECKOUT_PENDING_OTHER_OPERATION",
      ]),
    })
    .strict(),
  z
    .object({
      status: z.literal("blocked"),
      code: z.literal("CHECKOUT_OPERATION_RECONCILIATION_REQUIRED"),
    })
    .strict(),
]);
export type BillingClaim = z.infer<typeof ClaimSchema>;
export type ClaimedBillingLease = Extract<BillingClaim, { status: "claimed" }>;
export type BillingEventLease = ClaimedBillingLease & { eventId: string };

export const SubscriptionProjectionSchema = z
  .object({
    subscriptionId: StripeSubscriptionId.nullable(),
    priceId: z
      .string()
      .regex(/^price_[A-Za-z0-9_]+$/)
      .max(255)
      .nullable(),
    plan: z.enum(["free", "pro", "agency"]),
    status: z.enum(STRIPE_SUBSCRIPTION_STATUSES),
    currentPeriodStart: IsoDate.nullable(),
    currentPeriodEnd: IsoDate.nullable(),
    cancelAtPeriodEnd: z.boolean(),
    canceledAt: IsoDate.nullable(),
    trialEnd: IsoDate.nullable(),
  })
  .strict();
export type SubscriptionProjection = z.infer<typeof SubscriptionProjectionSchema>;

export const StripeInvoiceReferenceSchema = z
  .object({
    id: z
      .string()
      .regex(/^in_[A-Za-z0-9_]+$/)
      .max(255),
    subscriptionId: StripeSubscriptionId.nullable(),
    number: z.string().max(255).nullable(),
    hostedInvoiceUrl: z.string().url().max(4096).nullable(),
    invoicePdfUrl: z.string().url().max(4096).nullable(),
    status: z.enum(["draft", "open", "paid", "uncollectible", "void"]).nullable(),
    currency: z.string().regex(/^[a-z]{3}$/),
    amountPaid: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
    created: z.number().int().min(0).max(253402300799),
  })
  .strict();
export type StripeInvoiceReference = z.infer<typeof StripeInvoiceReferenceSchema>;

export const CheckoutReferenceSchema = z
  .object({
    operationId: z.string().uuid(),
    requestHash: z.string().regex(/^[a-f0-9]{64}$/),
    sessionId: z
      .string()
      .regex(/^cs_[A-Za-z0-9_]+$/)
      .max(255),
  })
  .strict();
export type CheckoutReference = z.infer<typeof CheckoutReferenceSchema>;

type RpcName =
  | "billing_link_customer"
  | "billing_claim_checkout"
  | "billing_finalize_checkout"
  | "billing_fail_checkout"
  | "billing_claim_event"
  | "billing_finalize_event"
  | "billing_fail_event";
type RpcClient = {
  rpc(
    name: RpcName,
    args: Record<string, unknown>,
  ): PromiseLike<{
    data: unknown;
    error: { code?: string; message?: string } | null;
  }>;
};

export class BillingStoreError extends Error {
  constructor(
    public readonly operation: RpcName,
    public readonly code: string,
  ) {
    super(`Billing persistence failed (${operation}: ${code}).`);
    this.name = "BillingStoreError";
  }
}

async function rpc<T>(
  name: RpcName,
  args: Record<string, unknown>,
  schema: z.ZodType<T>,
): Promise<T> {
  // Narrow compatibility boundary until supported Supabase type regeneration.
  // Runtime responses and inputs are validated; this does not grant client access.
  const client = supabaseAdmin as unknown as RpcClient;
  const { data, error } = await client.rpc(name, args);
  if (error) throw new BillingStoreError(name, error.code || "DATABASE_ERROR");
  const result = schema.safeParse(data);
  if (!result.success) throw new BillingStoreError(name, "INVALID_RPC_RESPONSE");
  return result.data;
}

const CustomerInputSchema = z
  .object({
    userId: z.string().uuid(),
    customerId: StripeCustomerId,
    livemode: z.boolean(),
  })
  .strict();
export type BillingCustomerInput = z.infer<typeof CustomerInputSchema>;
const CheckoutInputSchema = CustomerInputSchema.extend({
  requestId: z.string().uuid(),
  requestHash: z.string().regex(/^[a-f0-9]{64}$/),
});
export type BillingCheckoutInput = z.infer<typeof CheckoutInputSchema>;
const AppliedSchema = z.object({ applied: z.boolean() }).strict();

function customerArgs(input: BillingCustomerInput) {
  const data = CustomerInputSchema.parse(input);
  return { p_user_id: data.userId, p_customer_id: data.customerId, p_livemode: data.livemode };
}

function leaseArgs(lease: BillingLease) {
  const data = LeaseSchema.parse({
    userId: lease.userId,
    customerId: lease.customerId,
    livemode: lease.livemode,
    leaseToken: lease.leaseToken,
    generation: lease.generation,
    checkoutSessionId: lease.checkoutSessionId,
    checkoutOperationId: lease.checkoutOperationId,
    currentSubscriptionId: lease.currentSubscriptionId,
  });
  return {
    ...customerArgs({ userId: data.userId, customerId: data.customerId, livemode: data.livemode }),
    p_lease_token: data.leaseToken,
    p_generation: data.generation,
  };
}

export async function linkBillingCustomer(input: BillingCustomerInput): Promise<void> {
  await rpc(
    "billing_link_customer",
    customerArgs(input),
    z.object({ linked: z.literal(true) }).strict(),
  );
}

export async function claimCheckout(input: BillingCheckoutInput): Promise<BillingClaim> {
  const data = CheckoutInputSchema.parse(input);
  return rpc(
    "billing_claim_checkout",
    {
      ...customerArgs({
        userId: data.userId,
        customerId: data.customerId,
        livemode: data.livemode,
      }),
      p_request_id: data.requestId,
      p_request_hash: data.requestHash,
    },
    ClaimSchema,
  );
}

export async function finalizeCheckout(lease: BillingLease, sessionId: string): Promise<boolean> {
  const id = z
    .string()
    .regex(/^cs_[A-Za-z0-9_]+$/)
    .max(255)
    .parse(sessionId);
  const result = await rpc(
    "billing_finalize_checkout",
    {
      ...leaseArgs(lease),
      p_operation_id: z.string().uuid().parse(lease.checkoutOperationId),
      p_session_id: id,
    },
    AppliedSchema,
  );
  return result.applied;
}

export async function failCheckout(lease: BillingLease): Promise<boolean> {
  const result = await rpc(
    "billing_fail_checkout",
    {
      ...leaseArgs(lease),
      p_operation_id: z.string().uuid().parse(lease.checkoutOperationId),
    },
    AppliedSchema,
  );
  return result.applied;
}

const EventInputSchema = z
  .object({
    eventId: z
      .string()
      .regex(/^evt_[A-Za-z0-9_]+$/)
      .max(255),
    eventType: z.string().min(1).max(100),
    customerId: StripeCustomerId,
    livemode: z.boolean(),
  })
  .strict();
export type BillingEventInput = z.infer<typeof EventInputSchema>;

export async function claimBillingEvent(input: BillingEventInput): Promise<BillingClaim> {
  const data = EventInputSchema.parse(input);
  return rpc(
    "billing_claim_event",
    {
      p_event_id: data.eventId,
      p_event_type: data.eventType,
      p_customer_id: data.customerId,
      p_livemode: data.livemode,
    },
    ClaimSchema,
  );
}

export async function finalizeBillingEvent(
  lease: BillingEventLease,
  projection: SubscriptionProjection,
  invoiceReference: StripeInvoiceReference | null,
  checkoutReference: CheckoutReference | null = null,
): Promise<boolean> {
  const result = await rpc(
    "billing_finalize_event",
    {
      ...leaseArgs(lease),
      p_event_id: lease.eventId,
      p_projection: SubscriptionProjectionSchema.parse(projection),
      p_invoice_reference: invoiceReference
        ? StripeInvoiceReferenceSchema.parse(invoiceReference)
        : null,
      p_checkout_reference: checkoutReference
        ? CheckoutReferenceSchema.parse(checkoutReference)
        : null,
    },
    AppliedSchema,
  );
  return result.applied;
}

export async function failBillingEvent(
  lease: BillingEventLease,
  errorCode: string,
): Promise<boolean> {
  const result = await rpc(
    "billing_fail_event",
    {
      ...leaseArgs(lease),
      p_event_id: lease.eventId,
      p_error_code: z
        .string()
        .regex(/^[A-Z0-9_:-]{1,100}$/)
        .parse(errorCode),
    },
    AppliedSchema,
  );
  return result.applied;
}

export const billingEventStore = {
  claim: claimBillingEvent,
  finalize: finalizeBillingEvent,
  fail: failBillingEvent,
};
