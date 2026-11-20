import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { checkRateLimit } from "@/lib/rate-limit.server";
import { getServerSupabaseUrl } from "@/lib/supabase-env.server";
import { runDecayAlertSweep } from "@/lib/decay-alerts.server";
import { secretsMatch } from "@/lib/secret-compare.server";
import { safeErrorForLog } from "@/lib/log-redact";

function getSupabaseAdmin() {
  const url = getServerSupabaseUrl();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient<Database>(url, key, {
    auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
  });
}

export const Route = createFileRoute("/api/public/cron-decay-alerts")({
  server: {
    handlers: {
      GET: async ({ request }) => handleCron(request),
      POST: async ({ request }) => handleCron(request),
    },
  },
});

async function handleCron(request: Request): Promise<Response> {
  const clientIp =
    request.headers.get("cf-connecting-ip") ||
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    "unknown";

  // Rate limit: max 10 requests per minute
  const rl = checkRateLimit(`cron-decay-alerts:${clientIp}`, {
    limit: 10,
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

  // Security: the cron runs ONLY with a valid CRON_SECRET; everything else is 401.
  // The secret is accepted ONLY in headers (`Authorization: Bearer <secret>` or `x-cron-secret`).
  // A secret in the URL query string is never read (it would end up in access logs).
  // Either header may authorize: a wrong/foreign Authorization header (e.g. injected by a proxy)
  // does not override a correct x-cron-secret. Each candidate is compared in constant time;
  // an unset or empty CRON_SECRET never authorizes.
  const expectedSecret = process.env.CRON_SECRET;
  const bearerSecret = request.headers
    .get("authorization")
    ?.replace(/^Bearer\s+/i, "")
    .trim();
  const headerSecret = request.headers.get("x-cron-secret")?.trim();

  const authorized = [bearerSecret, headerSecret]
    .map((candidate) => secretsMatch(expectedSecret, candidate))
    .some(Boolean);

  if (!authorized) {
    return new Response(JSON.stringify({ error: "Unauthorized: Invalid or missing CRON_SECRET" }), {
      status: 401,
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
    const result = await runDecayAlertSweep({ supabase });
    return new Response(JSON.stringify(result.body), {
      status: result.status,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("Cron decay alerts uncaught error:", safeErrorForLog(err));
    return new Response(JSON.stringify({ error: "Internal processing error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}
