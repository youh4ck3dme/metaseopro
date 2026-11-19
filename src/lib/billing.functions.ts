import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { Json } from "@/integrations/supabase/types";
import {
  BillingActionError,
  CheckoutInputSchema,
  CustomerPortalInputSchema,
  checkoutStore,
  openCustomerPortal,
  startCheckout,
} from "./billing-checkout.server";
import { getStripeClient, stripeLivemode } from "./stripe.server";
import { getEffectivePlan } from "./billing-policy";
import {
  normalizeDIC,
  normalizeICDPH,
  normalizeICO,
  PLANS,
  validateCompanyBilling,
  type PlanId,
} from "./slovak-billing";

/** Database/API bodies may contain customer data; expose only our reviewed action errors. */
function publicBillingError(error: unknown): Error {
  if (error instanceof BillingActionError) return new Error(error.message);
  return new Error(
    "Platobnú službu sa nepodarilo overiť. Obnov stav predplatného; ak chyba pretrváva, kontaktuj podporu.",
  );
}

export const createCheckoutSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => CheckoutInputSchema.parse(input))
  .handler(async ({ data, context }) => {
    try {
      const stripe = getStripeClient();
      const store = checkoutStore(async (userId) => {
        const { data: row, error } = await context.supabase
          .from("subscriptions")
          .select("stripe_customer_id")
          .eq("user_id", userId)
          .maybeSingle();
        if (error) throw new Error("BILLING_CUSTOMER_LOOKUP_FAILED");
        return row?.stripe_customer_id ?? null;
      });
      return await startCheckout(data, context.userId, {
        stripe,
        livemode: stripe ? stripeLivemode() : false,
        store,
      });
    } catch (error) {
      throw publicBillingError(error);
    }
  });

export const createCustomerPortalSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => CustomerPortalInputSchema.parse(input))
  .handler(async ({ data, context }) => {
    try {
      const stripe = getStripeClient();
      const store = checkoutStore(async (userId) => {
        const { data: row, error } = await context.supabase
          .from("subscriptions")
          .select("stripe_customer_id")
          .eq("user_id", userId)
          .maybeSingle();
        if (error) throw new Error("BILLING_CUSTOMER_LOOKUP_FAILED");
        return row?.stripe_customer_id ?? null;
      });
      return await openCustomerPortal(data, context.userId, {
        stripe,
        livemode: stripe ? stripeLivemode() : false,
        store,
      });
    } catch (error) {
      throw publicBillingError(error);
    }
  });

export const getUserSubscription = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    try {
      const { data, error } = await context.supabase
        .from("subscriptions")
        .select(
          "plan, status, current_period_end, company_name, ico, dic, ic_dph, stripe_customer_id, last_invoice_number, last_invoice_url, billing_address",
        )
        .eq("user_id", context.userId)
        .maybeSingle();
      if (error) throw error;
      const plan = getEffectivePlan(data);
      const billingPlan: PlanId =
        data?.plan === "pro" || data?.plan === "agency" ? data.plan : "free";
      return {
        plan,
        billingPlan,
        status: data?.status ?? "inactive",
        config: PLANS[plan],
        hasStripeCustomer: Boolean(data?.stripe_customer_id),
        companyName: data?.company_name ?? null,
        ico: data?.ico ?? null,
        dic: data?.dic ?? null,
        icDph: data?.ic_dph ?? null,
        billingAddress: data?.billing_address ?? null,
        lastInvoiceNumber: data?.last_invoice_number ?? null,
        lastInvoiceUrl: data?.last_invoice_url ?? null,
        currentPeriodEnd: data?.current_period_end ?? null,
      };
    } catch {
      throw new Error("Stav predplatného sa nepodarilo načítať. Skús ho obnoviť.");
    }
  });

const UpdateBillingInputSchema = z
  .object({
    companyName: z.string().trim().max(255).optional(),
    ico: z.string().trim().max(20).optional(),
    dic: z.string().trim().max(20).optional(),
    icDph: z.string().trim().max(20).optional(),
    address: z.string().trim().max(255).optional(),
    city: z.string().trim().max(100).optional(),
    zip: z.string().trim().max(20).optional(),
    country: z.string().trim().max(100).optional(),
  })
  .strict();

export const updateCompanyBillingDetails = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => UpdateBillingInputSchema.parse(input))
  .handler(async ({ data, context }) => {
    const validation = validateCompanyBilling(data);
    if (!validation.valid)
      throw new Error(Object.values(validation.errors)[0] || "Neplatné fakturačné údaje.");
    // The authenticated browser has SELECT only. This server allowlist cannot change plan,
    // Stripe identifiers, payment status or another user's row.
    const billingAddress: Json = {
      line1: data.address || null,
      city: data.city || null,
      postal_code: data.zip || null,
      country: data.country || "Slovensko",
    };
    try {
      const { error } = await supabaseAdmin.from("subscriptions").upsert(
        {
          user_id: context.userId,
          company_name: data.companyName || null,
          ico: data.ico ? normalizeICO(data.ico) : null,
          dic: data.dic ? normalizeDIC(data.dic) : null,
          ic_dph: data.icDph ? normalizeICDPH(data.icDph) : null,
          billing_address: billingAddress,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id" },
      );
      if (error) throw error;
    } catch {
      throw new Error("Nepodarilo sa uložiť fakturačné údaje.");
    }
    return { success: true };
  });
