/**
 * Decay Alerting & Notification Engine
 * Inspects snapshots for severe traffic drops (>25% click loss)
 * and dispatches responsive HTML alerts to users via Resend / SMTP.
 */
import type { Database } from "@/integrations/supabase/types";
import { formatDomainDisplayName } from "./agency";

export interface DroppedUrlAlert {
  url: string;
  clicksPrev: number;
  clicksNow: number;
  lossPct: number;
  deltaClicks: number;
}

export interface SiteAlertEvaluation {
  userId: string;
  userEmail: string;
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

/**
 * Builds a responsive, professional HTML email for traffic decay alerts.
 */
export function buildDecayAlertEmailHtml(params: {
  domain: string;
  siteUrl: string;
  droppedPages: DroppedUrlAlert[];
  dashboardUrl: string;
}): string {
  const { domain, droppedPages, dashboardUrl } = params;

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
            <td class="url">${p.url.replace(/^https?:\/\/[^/]+/i, "")}</td>
            <td style="text-align: right;">${p.clicksPrev}</td>
            <td style="text-align: right;">${p.clicksNow}</td>
            <td class="loss">-${p.lossPct}% (${p.deltaClicks})</td>
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
      `[Decay Alert Mock] RESEND_API_KEY missing. Simulating alert email to ${toEmail} for ${domain}`,
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
      console.error("[Decay Alert Resend Error]:", res.status, errText);
      return { ok: false, simulated: false };
    }

    const data = (await res.json()) as { id?: string };
    return { ok: true, messageId: data.id, simulated: false };
  } catch (err) {
    console.error("[Decay Alert Send Exception]:", err);
    return { ok: false, simulated: false };
  }
}
