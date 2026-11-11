import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import Stripe from "stripe";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  normalizeDIC,
  normalizeICDPH,
  normalizeICO,
  PLANS,
  validateCompanyBilling,
  type PlanId,
} from "./slovak-billing";

const CheckoutInputSchema = z.object({
  plan: z.enum(["pro", "agency"]),
  companyName: z.string().trim().max(255).optional(),
  ico: z.string().trim().max(20).optional(),
  dic: z.string().trim().max(20).optional(),
  icDph: z.string().trim().max(20).optional(),
  successUrl: z
    .string()
    .trim()
    .refine((u) => u.startsWith("/") && !u.startsWith("//"), {
      message: "successUrl musí byť relatívna cesta začínajúca /",
    })
    .optional(),
  cancelUrl: z
    .string()
    .trim()
    .refine((u) => u.startsWith("/") && !u.startsWith("//"), {
      message: "cancelUrl musí byť relatívna cesta začínajúca /",
    })
    .optional(),
});

function getStripeClient(): Stripe | null {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) return null;
  return new Stripe(secretKey, {
    apiVersion: "2025-02-24.acacia" as never,
    httpClient: Stripe.createFetchHttpClient(),
  });
}

export const createCheckoutSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => CheckoutInputSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { userId, claims } = context;

    // 1. Validate Slovak B2B billing details if provided
    const billingValidation = validateCompanyBilling({
      companyName: data.companyName,
      ico: data.ico,
      dic: data.dic,
      icDph: data.icDph,
    });

    if (!billingValidation.valid) {
      const firstError = Object.values(billingValidation.errors)[0];
      throw new Error(firstError || "Neplatné firemné fakturačné údaje.");
    }

    const planConfig = PLANS[data.plan];
    const stripe = getStripeClient();

    const normalizedIco = data.ico ? normalizeICO(data.ico) : "";
    const normalizedDic = data.dic ? normalizeDIC(data.dic) : "";
    const normalizedIcDph = data.icDph ? normalizeICDPH(data.icDph) : "";

    const userEmail = typeof claims?.email === "string" ? claims.email : undefined;

    // 2. Safe URL builder: enforce trusted application origin
    const baseOrigin = process.env.SITE_URL || "https://seo4web.lovable.app";
    const successUrl = data.successUrl
      ? new URL(data.successUrl, baseOrigin).toString()
      : `${baseOrigin}/dashboard?payment=success&session_id={CHECKOUT_SESSION_ID}`;
    const cancelUrl = data.cancelUrl
      ? new URL(data.cancelUrl, baseOrigin).toString()
      : `${baseOrigin}/dashboard?payment=cancelled`;

    // Poistka: Cieľová URL musí mať zhodný origin
    if (
      new URL(successUrl).origin !== new URL(baseOrigin).origin ||
      new URL(cancelUrl).origin !== new URL(baseOrigin).origin
    ) {
      throw new Error("Neplatná cieľová URL pre presmerovanie.");
    }

    // If Stripe is not yet configured with secret key, return a mock checkout session in dev/demo
    if (!stripe) {
      return {
        url: `${successUrl.replace("{CHECKOUT_SESSION_ID}", "demo_mock_session")}&demo=true&plan=${data.plan}`,
        mock: true,
        message: "STRIPE_SECRET_KEY nie je nastavený. Bol vytvorený demo checkout.",
      };
    }

    // 2. Build metadata with corporate tax identifiers
    const metadata: Record<string, string> = {
      userId,
      plan: data.plan,
      companyName: data.companyName || "",
      ico: normalizedIco,
      dic: normalizedDic,
      icDph: normalizedIcDph,
    };

    // 3. Resolve price ID or create inline recurring line items
    const configuredPriceId = planConfig.priceIdEnvVar
      ? process.env[planConfig.priceIdEnvVar]
      : undefined;

    const lineItems: Stripe.Checkout.SessionCreateParams.LineItem[] = configuredPriceId
      ? [{ price: configuredPriceId, quantity: 1 }]
      : [
          {
            price_data: {
              currency: "eur",
              product_data: {
                name: `SEO4WEB ${planConfig.name}`,
                description: `Predplatné SEO4WEB ${planConfig.name} pre ${data.companyName || userEmail || "váš účet"}`,
              },
              unit_amount: planConfig.priceMonthly * 100,
              recurring: { interval: "month" },
            },
            quantity: 1,
          },
        ];

    // 4. Create Stripe Checkout Session
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer_email: userEmail,
      client_reference_id: userId,
      line_items: lineItems,
      success_url: successUrl,
      cancel_url: cancelUrl,
      metadata,
      subscription_data: {
        metadata,
      },
      tax_id_collection: {
        enabled: true,
      },
      allow_promotion_codes: true,
    });

    if (!session.url) {
      throw new Error("Nepodarilo sa vytvoriť Stripe Checkout URL.");
    }

    return {
      url: session.url,
      sessionId: session.id,
      mock: false,
    };
  });

export const getUserSubscription = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;

    try {
      const { data, error } = await supabase
        .from("subscriptions")
        .select(
          "plan, status, current_period_end, company_name, ico, dic, ic_dph, stripe_customer_id, last_invoice_number, last_invoice_url, billing_address",
        )
        .eq("user_id", userId)
        .maybeSingle();

      if (error || !data) {
        return {
          plan: "free" as PlanId,
          status: "active",
          config: PLANS.free,
          companyName: null,
          ico: null,
          dic: null,
          icDph: null,
          billingAddress: null,
          lastInvoiceNumber: null,
          lastInvoiceUrl: null,
          currentPeriodEnd: null,
        };
      }

      const planKey = (data.plan in PLANS ? data.plan : "free") as PlanId;

      return {
        plan: planKey,
        status: data.status,
        config: PLANS[planKey],
        companyName: data.company_name,
        ico: data.ico,
        dic: data.dic,
        icDph: data.ic_dph,
        billingAddress: data.billing_address,
        lastInvoiceNumber: data.last_invoice_number,
        lastInvoiceUrl: data.last_invoice_url,
        currentPeriodEnd: data.current_period_end,
      };
    } catch {
      return {
        plan: "free" as PlanId,
        status: "active",
        config: PLANS.free,
        companyName: null,
        ico: null,
        dic: null,
        icDph: null,
        billingAddress: null,
        lastInvoiceNumber: null,
        lastInvoiceUrl: null,
        currentPeriodEnd: null,
      };
    }
  });

const UpdateBillingInputSchema = z.object({
  companyName: z.string().trim().max(255).optional(),
  ico: z.string().trim().max(20).optional(),
  dic: z.string().trim().max(20).optional(),
  icDph: z.string().trim().max(20).optional(),
  address: z.string().trim().max(255).optional(),
  city: z.string().trim().max(100).optional(),
  zip: z.string().trim().max(20).optional(),
  country: z.string().trim().max(100).optional(),
});

export const updateCompanyBillingDetails = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => UpdateBillingInputSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    const validation = validateCompanyBilling({
      companyName: data.companyName,
      ico: data.ico,
      dic: data.dic,
      icDph: data.icDph,
    });

    if (!validation.valid) {
      const firstError = Object.values(validation.errors)[0];
      throw new Error(firstError || "Neplatné fakturačné údaje.");
    }

    const normalizedIco = data.ico ? normalizeICO(data.ico) : null;
    const normalizedDic = data.dic ? normalizeDIC(data.dic) : null;
    const normalizedIcDph = data.icDph ? normalizeICDPH(data.icDph) : null;

    const billingAddress = {
      line1: data.address || null,
      city: data.city || null,
      postal_code: data.zip || null,
      country: data.country || "Slovensko",
    };

    const { error } = await supabase.from("subscriptions").upsert(
      {
        user_id: userId,
        company_name: data.companyName || null,
        ico: normalizedIco,
        dic: normalizedDic,
        ic_dph: normalizedIcDph,
        billing_address: billingAddress as unknown as import("@/integrations/supabase/types").Json,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id" },
    );

    if (error) {
      console.error("Error updating billing details:", error);
      throw new Error("Nepodarilo sa uložiť fakturačné údaje.");
    }

    return { success: true };
  });
