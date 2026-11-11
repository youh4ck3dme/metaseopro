import { createFileRoute } from "@tanstack/react-router";
import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { checkRateLimit } from "@/lib/rate-limit.server";
import {
  buildSuperfakturaPayload,
  createSuperfakturaInvoice,
  sendInvoiceEmail,
  type InvoiceResult,
} from "@/lib/invoicing.server";

function getSupabaseAdmin() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return null;
  return createClient<Database>(url, key, {
    auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
  });
}

function getStripeClient(): Stripe | null {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) return null;
  return new Stripe(secretKey, {
    apiVersion: "2025-02-24.acacia" as never,
    httpClient: Stripe.createFetchHttpClient(),
  });
}

/**
 * Prepares payload and issues invoice via SuperFaktúra module.
 * Applies Slovak 20% VAT vs. EU Reverse Charge (§ 69 ods. 3 zákona o DPH).
 */
export async function forwardToSlovakInvoicing(
  session: Stripe.Checkout.Session,
  plan: string,
): Promise<{
  status: "sent" | "skipped" | "error" | "mock";
  invoiceNumber?: string;
  invoiceUrl?: string;
  result?: InvoiceResult;
}> {
  try {
    const metadata = session.metadata || {};
    const amountTotal = (session.amount_total ?? 3900) / 100;
    const currency = (session.currency ?? "eur").toUpperCase();

    const payload = buildSuperfakturaPayload({
      plan,
      amountTotal,
      currency,
      variableSymbol: session.id
        .slice(-10)
        .replace(/[^0-9]/g, "")
        .padStart(8, "2026"),
      stripeSessionId: session.id,
      client: {
        name: metadata.companyName || session.customer_details?.name || "Zákazník SEO4WEB",
        ico: metadata.ico || undefined,
        dic: metadata.dic || undefined,
        ic_dph: metadata.icDph || undefined,
        email: session.customer_details?.email || "",
        address: session.customer_details?.address?.line1 || undefined,
        city: session.customer_details?.address?.city || undefined,
        zip: session.customer_details?.address?.postal_code || undefined,
        country: session.customer_details?.address?.country || "Slovensko",
      },
    });

    const res = await createSuperfakturaInvoice(payload);

    if (res.success && res.invoiceId && payload.Client.email) {
      await sendInvoiceEmail(res.invoiceId, payload.Client.email);
    }

    return {
      status: res.mock ? "mock" : res.success ? "sent" : "error",
      invoiceNumber: res.invoiceNumber,
      invoiceUrl: res.invoiceUrl || res.invoicePdfUrl,
      result: res,
    };
  } catch (err) {
    console.error("[Stripe Invoicing Error] Nepodarilo sa vystaviť faktúru:", err);
    return { status: "error" };
  }
}

export const Route = createFileRoute("/api/public/stripe-webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const contentLength = Number(request.headers.get("content-length") ?? "0");
        if (contentLength > 64 * 1024) {
          return new Response(JSON.stringify({ error: "Payload too large" }), {
            status: 413,
            headers: { "Content-Type": "application/json" },
          });
        }

        const clientIp =
          request.headers.get("cf-connecting-ip") ||
          request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
          "unknown";
        const rl = checkRateLimit(`stripe-webhook:${clientIp}`, {
          limit: 120,
          windowMs: 60_000,
        });
        if (!rl.ok) {
          return new Response(JSON.stringify({ error: "Too many requests" }), {
            status: 429,
            headers: {
              "Content-Type": "application/json",
              "Retry-After": String(rl.retryAfterSec),
            },
          });
        }

        const stripe = getStripeClient();
        const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

        if (!stripe || !webhookSecret) {
          console.warn(
            "Stripe webhook received but STRIPE_SECRET_KEY or WEBHOOK_SECRET is missing.",
          );
          return new Response(
            JSON.stringify({ received: true, note: "Stripe keys not configured" }),
            {
              headers: { "Content-Type": "application/json" },
            },
          );
        }

        const signature = request.headers.get("stripe-signature");
        if (!signature) {
          return new Response(JSON.stringify({ error: "Missing stripe-signature header" }), {
            status: 400,
            headers: { "Content-Type": "application/json" },
          });
        }

        const rawBody = await request.text();
        let event: Stripe.Event;

        try {
          event = await stripe.webhooks.constructEventAsync(rawBody, signature, webhookSecret);
        } catch (err) {
          console.error("Stripe webhook signature verification failed:", err);
          return new Response(JSON.stringify({ error: "Invalid webhook signature" }), {
            status: 400,
            headers: { "Content-Type": "application/json" },
          });
        }

        const supabase = getSupabaseAdmin();
        if (!supabase) {
          return new Response(JSON.stringify({ error: "Supabase connection unavailable" }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          });
        }

        try {
          switch (event.type) {
            case "checkout.session.completed": {
              const session = event.data.object as Stripe.Checkout.Session;
              const userId = session.client_reference_id || session.metadata?.userId;
              const plan = session.metadata?.plan || "pro";

              if (userId) {
                const now = new Date();
                const periodEnd = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

                // Trigger automated Slovak B2B invoice creation via SuperFaktúra
                const invoiceOutcome = await forwardToSlovakInvoicing(session, plan);

                await supabase.from("subscriptions").upsert(
                  {
                    user_id: userId,
                    stripe_customer_id:
                      typeof session.customer === "string" ? session.customer : null,
                    stripe_subscription_id:
                      typeof session.subscription === "string" ? session.subscription : null,
                    plan,
                    status: "active",
                    company_name: session.metadata?.companyName || null,
                    ico: session.metadata?.ico || null,
                    dic: session.metadata?.dic || null,
                    ic_dph: session.metadata?.icDph || null,
                    billing_address:
                      (session.customer_details?.address as unknown as
                        import("@/integrations/supabase/types").Json | null) || null,
                    last_invoice_number: invoiceOutcome.invoiceNumber || null,
                    last_invoice_url: invoiceOutcome.invoiceUrl || null,
                    current_period_end: periodEnd.toISOString(),
                    updated_at: now.toISOString(),
                  },
                  { onConflict: "user_id" },
                );
              }
              break;
            }

            case "customer.subscription.updated": {
              const subscription = event.data.object as Stripe.Subscription;
              const status = subscription.status === "active" ? "active" : "past_due";
              const currentPeriodEnd = new Date(
                (subscription as unknown as { current_period_end: number }).current_period_end *
                  1000,
              ).toISOString();

              await supabase
                .from("subscriptions")
                .update({
                  status,
                  current_period_end: currentPeriodEnd,
                  updated_at: new Date().toISOString(),
                })
                .eq("stripe_subscription_id", subscription.id);
              break;
            }

            case "customer.subscription.deleted": {
              const subscription = event.data.object as Stripe.Subscription;
              await supabase
                .from("subscriptions")
                .update({
                  plan: "free",
                  status: "canceled",
                  updated_at: new Date().toISOString(),
                })
                .eq("stripe_subscription_id", subscription.id);
              break;
            }

            default:
              break;
          }

          return new Response(JSON.stringify({ received: true }), {
            headers: { "Content-Type": "application/json" },
          });
        } catch (e) {
          console.error("Error processing Stripe webhook:", e);
          return new Response(JSON.stringify({ error: "Internal processing error" }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          });
        }
      },
    },
  },
});
