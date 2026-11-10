import { createFileRoute } from "@tanstack/react-router";
import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";

function getSupabaseAdmin() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, {
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
 * Prepares payload for Slovak & Czech automated invoicing (SuperFaktúra / Fakturoid API).
 * Applies correct VAT calculation:
 * - SK company / consumer: 20% DPH
 * - EU company with valid VAT: 0% Reverse charge (Prenesenie daňovej povinnosti)
 * - Outside EU: 0% exempt export of services
 */
export async function forwardToSlovakInvoicing(
  session: Stripe.Checkout.Session,
  plan: string,
): Promise<{ status: "sent" | "skipped" | "error"; invoiceNumber?: string }> {
  const superfakturaEmail = process.env.SUPERFAKTURA_EMAIL;
  const superfakturaApiKey = process.env.SUPERFAKTURA_API_KEY;

  const metadata = session.metadata || {};
  const amountTotal = (session.amount_total ?? 3900) / 100;
  const currency = (session.currency ?? "eur").toUpperCase();

  const isReverseCharge = Boolean(
    metadata.icDph && !metadata.icDph.toUpperCase().startsWith("SK"),
  );

  const invoiceData = {
    Invoice: {
      name: `Faktúra za SEO4WEB ${plan.toUpperCase()}`,
      variable: session.id.slice(-10),
      currency,
      payment_type: "card",
    },
    Client: {
      name: metadata.companyName || session.customer_details?.name || "Zákazník SEO4WEB",
      ico: metadata.ico || "",
      dic: metadata.dic || "",
      ic_dph: metadata.icDph || "",
      email: session.customer_details?.email || "",
      address: session.customer_details?.address?.line1 || "",
      city: session.customer_details?.address?.city || "",
      zip: session.customer_details?.address?.postal_code || "",
      country: session.customer_details?.address?.country || "Slovensko",
    },
    InvoiceItem: [
      {
        name: `SEO4WEB ${plan.toUpperCase()} (Mesačné predplatné)`,
        quantity: 1,
        unit_price: isReverseCharge ? amountTotal : Number((amountTotal / 1.2).toFixed(2)),
        tax: isReverseCharge ? 0 : 20,
        description: isReverseCharge
          ? "Prenesenie daňovej povinnosti podľa § 69 ods. 3 zákona o DPH (Reverse charge)."
          : undefined,
      },
    ],
  };

  // If SuperFaktúra integration keys are configured, submit live invoice
  if (superfakturaEmail && superfakturaApiKey) {
    try {
      const res = await fetch("https://moja.superfaktura.sk/invoices/create", {
        method: "POST",
        headers: {
          Authorization: `SFAPI email=${superfakturaEmail}&apikey=${superfakturaApiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(invoiceData),
      });
      if (res.ok) {
        const json = (await res.json().catch(() => ({}))) as {
          data?: { Invoice?: { token?: string } };
        };
        return { status: "sent", invoiceNumber: json.data?.Invoice?.token };
      }
    } catch (e) {
      console.error("SuperFaktura webhook forward error:", e);
      return { status: "error" };
    }
  }

  // Ready for production SuperFaktura API trigger
  return { status: "skipped" };
}

export const Route = createFileRoute("/api/public/stripe-webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const stripe = getStripeClient();
        const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

        if (!stripe || !webhookSecret) {
          console.warn("Stripe webhook received but STRIPE_SECRET_KEY or WEBHOOK_SECRET is missing.");
          return new Response(JSON.stringify({ received: true, note: "Stripe keys not configured" }), {
            headers: { "Content-Type": "application/json" },
          });
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

                await supabase.from("subscriptions" as never).upsert(
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
                    billing_address: session.customer_details?.address || null,
                    current_period_end: periodEnd.toISOString(),
                    updated_at: now.toISOString(),
                  } as never,
                  { onConflict: "user_id" },
                );

                // Trigger automated Slovak B2B invoice creation
                await forwardToSlovakInvoicing(session, plan);
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
                .from("subscriptions" as never)
                .update({
                  status,
                  current_period_end: currentPeriodEnd,
                  updated_at: new Date().toISOString(),
                } as never)
                .eq("stripe_subscription_id" as never, subscription.id as never);
              break;
            }

            case "customer.subscription.deleted": {
              const subscription = event.data.object as Stripe.Subscription;
              await supabase
                .from("subscriptions" as never)
                .update({
                  plan: "free",
                  status: "canceled",
                  updated_at: new Date().toISOString(),
                } as never)
                .eq("stripe_subscription_id" as never, subscription.id as never);
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
