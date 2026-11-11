import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { checkRateLimit } from "@/lib/rate-limit.server";
import { formatDomainDisplayName } from "@/lib/agency";
import {
  detectDroppedPages,
  sendDecayAlertEmail,
  type SiteAlertEvaluation,
} from "@/lib/decay-alerts.server";

function getSupabaseAdmin() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_PUBLISHABLE_KEY;
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

  // Security: Verify CRON_SECRET token
  const expectedSecret = process.env.CRON_SECRET;
  const authHeader = request.headers.get("authorization");
  const xCronSecret = request.headers.get("x-cron-secret");
  const url = new URL(request.url);
  const querySecret = url.searchParams.get("secret");

  const providedSecret =
    authHeader?.replace(/^Bearer\s+/i, "").trim() || xCronSecret?.trim() || querySecret?.trim();

  // If CRON_SECRET is configured in environment, strictly require it
  if (expectedSecret && providedSecret !== expectedSecret) {
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
    // 1. Fetch latest distinct snapshots per user & site
    const { data: snapshots, error: snapErr } = await supabase
      .from("seo_snapshots")
      .select("id, user_id, site_url, metrics_summary, raw_data, created_at")
      .order("created_at", { ascending: false })
      .limit(100);

    if (snapErr) {
      console.error("Error fetching snapshots:", snapErr);
      return new Response(JSON.stringify({ error: snapErr.message }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (!snapshots || snapshots.length === 0) {
      return new Response(
        JSON.stringify({ evaluated: 0, alertsSent: 0, message: "No snapshots to evaluate." }),
        { headers: { "Content-Type": "application/json" } },
      );
    }

    // Keep only the latest snapshot per user_id + site_url
    const seen = new Set<string>();
    const latestPerSite = snapshots.filter((s) => {
      const key = `${s.user_id}:${s.site_url.toLowerCase()}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    const evaluations: SiteAlertEvaluation[] = [];

    // 2. Fetch user profile emails
    const userIds = Array.from(new Set(latestPerSite.map((s) => s.user_id)));
    const { data: profiles } = await supabase
      .from("profiles")
      .select("user_id, email")
      .in("user_id", userIds);

    const emailMap = new Map<string, string>();
    profiles?.forEach((p) => {
      if (p.email) emailMap.set(p.user_id, p.email);
    });

    for (const snap of latestPerSite) {
      const userEmail = emailMap.get(snap.user_id);
      const domain = formatDomainDisplayName(snap.site_url);

      if (!userEmail) {
        evaluations.push({
          userId: snap.user_id,
          userEmail: "",
          siteUrl: snap.site_url,
          domain,
          droppedPages: [],
          alertSent: false,
          reason: "User email not found in profile",
        });
        continue;
      }

      const dropped = detectDroppedPages(snap.raw_data, 25);

      if (dropped.length === 0) {
        evaluations.push({
          userId: snap.user_id,
          userEmail,
          siteUrl: snap.site_url,
          domain,
          droppedPages: [],
          alertSent: false,
          reason: "No pages exceeded 25% drop threshold",
        });
        continue;
      }

      // Send alert email
      const outcome = await sendDecayAlertEmail({
        toEmail: userEmail,
        domain,
        siteUrl: snap.site_url,
        droppedPages: dropped,
      });

      evaluations.push({
        userId: snap.user_id,
        userEmail,
        siteUrl: snap.site_url,
        domain,
        droppedPages: dropped,
        alertSent: outcome.ok,
        reason: outcome.simulated ? "Simulated (RESEND_API_KEY missing)" : "Sent",
      });
    }

    const alertsCount = evaluations.filter((e) => e.alertSent).length;

    return new Response(
      JSON.stringify({
        ok: true,
        evaluated: latestPerSite.length,
        alertsSent: alertsCount,
        evaluations,
      }),
      { headers: { "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("Cron decay alerts uncaught error:", err);
    return new Response(JSON.stringify({ error: "Internal processing error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}
