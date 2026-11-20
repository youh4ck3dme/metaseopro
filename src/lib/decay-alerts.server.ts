/**
 * Decay Alerting & Notification Engine
 * Inspects snapshots for severe traffic drops (>25% click loss)
 * and dispatches responsive HTML alerts to users via Resend / SMTP.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { formatDomainDisplayName } from "./agency";
import { maskEmail, redactEmails, safeErrorForLog } from "./log-redact";

export interface DroppedUrlAlert {
  url: string;
  clicksPrev: number;
  clicksNow: number;
  lossPct: number;
  deltaClicks: number;
}

export interface SiteAlertEvaluation {
  userId: string;
  /** Masked (j***@e***) - the raw address is never put into evaluations, logs or HTTP responses. */
  userEmailMasked: string;
  siteUrl: string;
  domain: string;
  droppedPages: DroppedUrlAlert[];
  alertSent: boolean;
  reason?: string;
}

/**
 * Evaluates snapshot raw data for critical page drops exceeding 25% click loss.
 */
export function detectDroppedPages(rawData: unknown, thresholdPct = 25): DroppedUrlAlert[] {
  if (!rawData || typeof rawData !== "object") return [];
  const dataset = rawData as {
    rows?: Array<{ url: string; clicksNow: number; clicksPrev: number }>;
  };
  if (!Array.isArray(dataset.rows)) return [];

  const dropped: DroppedUrlAlert[] = [];

  for (const row of dataset.rows) {
    if (!row.url || typeof row.clicksPrev !== "number" || typeof row.clicksNow !== "number")
      continue;
    // Require a minimum baseline of 5 clicks previously to avoid alerting on noise
    if (row.clicksPrev >= 5 && row.clicksNow < row.clicksPrev) {
      const dropPct = Math.round(((row.clicksPrev - row.clicksNow) / row.clicksPrev) * 100);
      if (dropPct >= thresholdPct) {
        dropped.push({
          url: row.url,
          clicksPrev: row.clicksPrev,
          clicksNow: row.clicksNow,
          lossPct: dropPct,
          deltaClicks: row.clicksNow - row.clicksPrev,
        });
      }
    }
  }

  // Sort by highest absolute click drop first
  return dropped.sort((a, b) => a.deltaClicks - b.deltaClicks);
}

/** Escapes snapshot-derived text before it is placed into alert e-mail HTML. */
export function escapeHtml(value: unknown): string {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

type AuthAdminLookup = {
  auth: {
    admin: {
      getUserById(id: string): Promise<{
        data: { user: { email?: string | null; email_confirmed_at?: string | null } | null };
        error: unknown;
      }>;
    };
  };
};

/**
 * Alert recipients come only from the verified auth account e-mail
 * (auth.users.email with email_confirmed_at), never from public.profiles.email,
 * which every user can rewrite through RLS. A failed or unverified lookup means
 * "no recipient" (fail closed), so content is never sent to a user-chosen address.
 */
export async function resolveVerifiedAlertRecipients(
  admin: AuthAdminLookup,
  userIds: string[],
): Promise<Map<string, string>> {
  const recipients = new Map<string, string>();
  for (const userId of userIds) {
    try {
      const { data, error } = await admin.auth.admin.getUserById(userId);
      const email = data?.user?.email?.trim();
      if (!error && email && data.user?.email_confirmed_at) recipients.set(userId, email);
    } catch {
      // Skip this user; never fall back to an unverified address.
    }
  }
  return recipients;
}

/**
 * Builds a responsive, professional HTML email for traffic decay alerts.
 */
export function buildDecayAlertEmailHtml(params: {
  domain: string;
  siteUrl: string;
  droppedPages: DroppedUrlAlert[];
  dashboardUrl: string;
}): string {
  const domain = escapeHtml(params.domain);
  const dashboardUrl = escapeHtml(params.dashboardUrl);
  const { droppedPages } = params;

  return `<!DOCTYPE html>
<html lang="sk">
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background: #f8fafc; margin: 0; padding: 24px; color: #0f172a; }
    .container { max-width: 600px; margin: 0 auto; background: #ffffff; border-radius: 8px; border: 1px solid #e2e8f0; overflow: hidden; }
    .header { background: #dc2626; padding: 20px 24px; color: #ffffff; }
    .header h1 { margin: 0; font-size: 18px; font-weight: 700; }
    .content { padding: 24px; }
    .intro { font-size: 14px; line-height: 1.5; color: #334155; margin-bottom: 20px; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 24px; font-size: 13px; }
    th { text-align: left; background: #f1f5f9; padding: 8px 10px; color: #475569; font-size: 11px; text-transform: uppercase; }
    td { padding: 10px; border-bottom: 1px solid #e2e8f0; }
    .url { font-family: monospace; color: #0284c7; word-break: break-all; max-width: 280px; }
    .loss { color: #dc2626; font-weight: 700; text-align: right; }
    .btn { display: inline-block; background: #0284c7; color: #ffffff; text-decoration: none; padding: 12px 20px; border-radius: 6px; font-weight: 600; font-size: 14px; text-align: center; }
    .footer { padding: 16px 24px; background: #f8fafc; border-top: 1px solid #e2e8f0; font-size: 11px; color: #94a3b8; text-align: center; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>⚠️ SEO4WEB: Detegovaný prepad návštevnosti</h1>
    </div>
    <div class="content">
      <p class="intro">
        Pri nočnej kontrole Search Console snapshotov sme na doméne <strong>${domain}</strong>
        zistili pokles organickej návštevnosti o viac ako <strong>25 %</strong> na nasledujúcich kľúčových URL adresách:
      </p>

      <table>
        <thead>
          <tr>
            <th>Podstránka</th>
            <th style="text-align: right;">Predtým</th>
            <th style="text-align: right;">Teraz</th>
            <th style="text-align: right;">Pokles</th>
          </tr>
        </thead>
        <tbody>
          ${droppedPages
            .slice(0, 10)
            .map(
              (p) => `<tr>
            <td class="url">${escapeHtml(p.url.replace(/^https?:\/\/[^/]+/i, ""))}</td>
            <td style="text-align: right;">${escapeHtml(p.clicksPrev)}</td>
            <td style="text-align: right;">${escapeHtml(p.clicksNow)}</td>
            <td class="loss">-${escapeHtml(p.lossPct)}% (${escapeHtml(p.deltaClicks)})</td>
          </tr>`,
            )
            .join("")}
        </tbody>
      </table>

      <div style="text-align: center; margin: 28px 0 16px;">
        <a href="${dashboardUrl}" class="btn">Otvoriť Decay Radar a vygenerovať plán obnovy</a>
      </div>
    </div>
    <div class="footer">
      Automatické nočné monitorovanie SEO4WEB &bull; Tento e-mail bol odoslaný na základe prepojenia vášho účtu.
    </div>
  </div>
</body>
</html>`;
}

/**
 * Sends decay alert email via Resend API or logs simulation when API key is missing.
 */
export async function sendDecayAlertEmail(params: {
  toEmail: string;
  domain: string;
  siteUrl: string;
  droppedPages: DroppedUrlAlert[];
  fetchFn?: typeof fetch;
}): Promise<{ ok: boolean; messageId?: string; simulated?: boolean }> {
  const { toEmail, domain, siteUrl, droppedPages, fetchFn = fetch } = params;
  const resendApiKey = process.env.RESEND_API_KEY;
  const fromEmail = process.env.ALERTS_FROM_EMAIL || "SEO4WEB Alerts <alerts@seo.vorkei.com>";

  const dashboardUrl = `https://seo.vorkei.com/dashboard?client=${encodeURIComponent(domain)}`;
  const html = buildDecayAlertEmailHtml({ domain, siteUrl, droppedPages, dashboardUrl });
  const subject = `⚠️ SEO4WEB Alert: Prepad návštevnosti na ${domain} (-${droppedPages[0]?.lossPct || 25}%)`;

  if (!resendApiKey) {
    console.warn(
      `[Decay Alert Mock] RESEND_API_KEY missing. Simulating alert email to ${maskEmail(toEmail)} for ${domain}`,
    );
    return { ok: true, simulated: true };
  }

  try {
    const res = await fetchFn("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: fromEmail,
        to: [toEmail],
        subject,
        html,
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error("[Decay Alert Resend Error]:", res.status, redactEmails(errText));
      return { ok: false, simulated: false };
    }

    const data = (await res.json()) as { id?: string };
    return { ok: true, messageId: data.id, simulated: false };
  } catch (err) {
    console.error("[Decay Alert Send Exception]:", safeErrorForLog(err));
    return { ok: false, simulated: false };
  }
}

export interface DecayAlertSweepResult {
  status: number;
  body: Record<string, unknown>;
}

/**
 * Evaluates the latest snapshot per user+site and sends decay alerts for all users.
 * Only callable from the CRON_SECRET-protected cron route.
 * E-mail addresses are looked up for sending only; they are never logged or returned.
 */
export async function runDecayAlertSweep(opts: {
  supabase: SupabaseClient<Database>;
  sendEmail?: typeof sendDecayAlertEmail;
}): Promise<DecayAlertSweepResult> {
  const { supabase, sendEmail = sendDecayAlertEmail } = opts;

  const { data: snapshots, error: snapErr } = await supabase
    .from("seo_snapshots")
    .select("id, user_id, site_url, metrics_summary, raw_data, created_at")
    .order("created_at", { ascending: false })
    .limit(100);

  if (snapErr) {
    console.error("Error fetching snapshots:", snapErr.code ?? "unknown");
    return { status: 500, body: { error: "Internal processing error" } };
  }
  if (!snapshots || snapshots.length === 0) {
    return {
      status: 200,
      body: { evaluated: 0, alertsSent: 0, message: "No snapshots to evaluate." },
    };
  }

  // Keep only the latest snapshot per user_id + site_url
  const seen = new Set<string>();
  const latestPerSite = snapshots.filter((s) => {
    const key = `${s.user_id}:${s.site_url.toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const userIds = Array.from(new Set(latestPerSite.map((s) => s.user_id)));
  // Recipients: verified auth e-mail only. public.profiles.email is user-editable
  // through RLS and must never decide where the server sends content.
  const emailMap = await resolveVerifiedAlertRecipients(supabase, userIds);

  const evaluations: SiteAlertEvaluation[] = [];
  for (const snap of latestPerSite) {
    const userEmail = emailMap.get(snap.user_id);
    const domain = formatDomainDisplayName(snap.site_url);
    const base = {
      userId: snap.user_id,
      userEmailMasked: userEmail ? maskEmail(userEmail) : "",
      siteUrl: snap.site_url,
      domain,
    };

    if (!userEmail) {
      evaluations.push({
        ...base,
        droppedPages: [],
        alertSent: false,
        reason: "Verified account email not found",
      });
      continue;
    }

    const dropped = detectDroppedPages(snap.raw_data, 25);
    if (dropped.length === 0) {
      evaluations.push({
        ...base,
        droppedPages: [],
        alertSent: false,
        reason: "No pages exceeded 25% drop threshold",
      });
      continue;
    }

    const outcome = await sendEmail({
      toEmail: userEmail,
      domain,
      siteUrl: snap.site_url,
      droppedPages: dropped,
    });
    evaluations.push({
      ...base,
      droppedPages: dropped,
      alertSent: outcome.ok,
      reason: outcome.simulated ? "Simulated (RESEND_API_KEY missing)" : "Sent",
    });
  }

  return {
    status: 200,
    body: {
      ok: true,
      evaluated: latestPerSite.length,
      alertsSent: evaluations.filter((e) => e.alertSent).length,
      evaluations,
    },
  };
}
