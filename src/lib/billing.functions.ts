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
  successUrl: z.string().optional(),
  cancelUrl: z.string().optional(),
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

    // Fallback URL builder
    const fallbackOrigin = process.env.SITE_URL || "https://seo4web.lovable.app";
    const successUrl =
      data.successUrl || `${fallbackOrigin}/dashboard?payment=success&session_id={CHECKOUT_SESSION_ID}`;
    const cancelUrl = data.cancelUrl || `${fallbackOrigin}/dashboard?payment=cancelled`;

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
        .from("subscriptions" as never)
        .select(
          "plan, status, current_period_end, company_name, ico, dic, ic_dph, stripe_customer_id" as never,
        )
        .eq("user_id" as never, userId as never)
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
          currentPeriodEnd: null,
        };
      }

      const row = data as unknown as {
        plan: PlanId;
        status: string;
        current_period_end: string | null;
        company_name: string | null;
        ico: string | null;
        dic: string | null;
        ic_dph: string | null;
      };

      const planKey = (row.plan in PLANS ? row.plan : "free") as PlanId;

      return {
        plan: planKey,
        status: row.status,
        config: PLANS[planKey],
        companyName: row.company_name,
        ico: row.ico,
        dic: row.dic,
        icDph: row.ic_dph,
        currentPeriodEnd: row.current_period_end,
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
        currentPeriodEnd: null,
      };
    }
  });
