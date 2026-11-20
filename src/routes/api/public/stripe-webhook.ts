import { createFileRoute } from "@tanstack/react-router";
import { getStripeClient } from "@/lib/stripe.server";
import { handleStripeWebhook } from "@/lib/stripe-webhook-http.server";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit.server";

export const Route = createFileRoute("/api/public/stripe-webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const rate = checkRateLimit(`stripe-webhook:${getClientIp(request)}`, {
          limit: 120,
          windowMs: 60_000,
        });
        if (!rate.ok) {
          return new Response(JSON.stringify({ error: "WEBHOOK_RATE_LIMITED" }), {
            status: 429,
            headers: {
              "Content-Type": "application/json",
              "Retry-After": String(rate.retryAfterSec),
            },
          });
        }
        return handleStripeWebhook(request, {
          stripe: getStripeClient(),
          webhookSecret: process.env.STRIPE_WEBHOOK_SECRET,
        });
      },
    },
  },
});
