/**
 * Whitelabel Client PDF Report Engine
 * Generates an executive, print-optimized A4 PDF report with custom agency branding,
 * KPI summary cards, top decay drops, and CTR opportunities.
 */
import type { ExecutiveReportData } from "./agency";
import type { ScoredDecayRow } from "./decay-schema";

export interface PdfExportOptions {
  criticalDrops?: ScoredDecayRow[];
  autoPrint?: boolean;
}

/**
 * Generates a self-contained, high-fidelity HTML document ready for A4 PDF printing.
 */
export function generateReportHtml(
  data: ExecutiveReportData,
  criticalDrops: ScoredDecayRow[] = [],
): string {
  const { agency, client, executiveSummary, opportunities, recommendations } = data;
  const primaryColor = agency.primaryColor || "#10b981";

  // Top 5 decay drops
  const topDrops = criticalDrops
    .filter((r) => r.status === "critical" || r.status === "declining")
    .sort((a, b) => a.clicksNow - a.clicksPrev - (b.clicksNow - b.clicksPrev))
    .slice(0, 5);

  const topOpportunities = (opportunities || []).slice(0, 5);

  return `<!DOCTYPE html>
<html lang="sk">
<head>
  <meta charset="utf-8">
  <title>Mesačný SEO Report — ${escapeHtml(client.domain)}</title>
  <style>
    @page {
      size: A4 portrait;
      margin: 12mm 14mm;
    }
    *, *::before, *::after {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      color: #0f172a;
      background: #ffffff;
      line-height: 1.45;
      font-size: 11pt;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .report-container {
      max-width: 800px;
      margin: 0 auto;
    }
    /* Header */
    .header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding-bottom: 16px;
      border-bottom: 3px solid ${primaryColor};
      margin-bottom: 24px;
    }
    .agency-brand {
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .agency-logo {
      max-height: 44px;
      max-width: 140px;
      object-fit: contain;
    }
    .agency-name {
      font-size: 16pt;
      font-weight: 700;
      color: ${primaryColor};
      letter-spacing: -0.02em;
    }
    .client-meta {
      text-align: right;
    }
    .client-domain {
      font-size: 14pt;
      font-weight: 700;
      color: #0f172a;
    }
    .report-date {
      font-size: 9pt;
      color: #64748b;
      margin-top: 2px;
    }
    /* Section Titles */
    h2 {
      font-size: 13pt;
      font-weight: 700;
      color: #1e293b;
      margin-top: 22px;
      margin-bottom: 10px;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .badge {
      display: inline-block;
      padding: 2px 8px;
      border-radius: 9999px;
      font-size: 8pt;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }
    .badge-success { background: #dcfce7; color: #15803d; }
    .badge-danger { background: #fee2e2; color: #b91c1c; }
    .badge-warning { background: #fef3c7; color: #b45309; }

    /* KPI Grid */
    .kpi-grid {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 12px;
      margin-bottom: 20px;
    }
    .kpi-card {
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      padding: 12px 14px;
      background: #f8fafc;
      page-break-inside: avoid;
    }
    .kpi-label {
      font-size: 8pt;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: #64748b;
      font-weight: 600;
      margin-bottom: 4px;
    }
    .kpi-value {
      font-size: 16pt;
      font-weight: 800;
      color: #0f172a;
      line-height: 1.2;
    }
    .kpi-delta {
      font-size: 8pt;
      font-weight: 600;
      margin-top: 4px;
    }
    .delta-pos { color: #16a34a; }
    .delta-neg { color: #dc2626; }

    /* Executive Note */
    .exec-note {
      background: #f1f5f9;
      border-left: 4px solid ${primaryColor};
      padding: 10px 14px;
      border-radius: 0 6px 6px 0;
      font-size: 9.5pt;
      color: #334155;
      margin-bottom: 20px;
      page-break-inside: avoid;
    }

    /* Tables */
    table {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 18px;
      font-size: 9pt;
      page-break-inside: avoid;
    }
    th {
      text-align: left;
      background: #f1f5f9;
      color: #475569;
      font-weight: 700;
      padding: 8px 10px;
      border-bottom: 1px solid #cbd5e1;
      font-size: 8pt;
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }
    td {
      padding: 8px 10px;
      border-bottom: 1px solid #e2e8f0;
      color: #1e293b;
      vertical-align: top;
    }
    tr:nth-child(even) td {
      background: #fafafa;
    }
    .url-cell {
      max-width: 260px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-family: monospace;
      font-size: 8pt;
      color: #0369a1;
    }

    /* Recommendations */
    .rec-list {
      display: flex;
      flex-direction: column;
      gap: 8px;
      margin-bottom: 20px;
      page-break-inside: avoid;
    }
    .rec-item {
      border: 1px solid #e2e8f0;
      border-radius: 6px;
      padding: 10px 12px;
      background: #ffffff;
    }
    .rec-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 4px;
    }
    .rec-title {
      font-weight: 700;
      font-size: 9.5pt;
      color: #0f172a;
    }
    .rec-desc {
      font-size: 8.5pt;
      color: #475569;
      line-height: 1.4;
    }

    /* Footer */
    .footer {
      margin-top: 30px;
      padding-top: 14px;
      border-top: 1px solid #e2e8f0;
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-size: 8pt;
      color: #94a3b8;
      page-break-inside: avoid;
    }

    @media print {
      body {
        margin: 0;
        background: transparent;
      }
      .no-print {
        display: none !important;
      }
    }
  </style>
</head>
<body>
  <div class="report-container">
    <!-- Header -->
    <div class="header">
      <div class="agency-brand">
        ${agency.logoUrl ? `<img class="agency-logo" src="${escapeHtml(agency.logoUrl)}" alt="${escapeHtml(agency.name)}">` : ""}
        <div class="agency-name">${escapeHtml(agency.name)}</div>
      </div>
      <div class="client-meta">
        <div class="client-domain">${escapeHtml(client.domain)}</div>
        <div class="report-date">Mesačný audit &bull; ${escapeHtml(client.generatedAt)}</div>
      </div>
    </div>

    <!-- Executive Note -->
    <div class="exec-note">
      <strong>Executive zhrnutie:</strong> ${escapeHtml(executiveSummary.executiveNote)}
    </div>

    <!-- Summary KPI Cards -->
    <h2>Kľúčové Výkonnostné Ukazovatele (KPIs)</h2>
    <div class="kpi-grid">
      <div class="kpi-card">
        <div class="kpi-label">SEO Health Index</div>
        <div class="kpi-value" style="color: ${executiveSummary.healthColor}">${executiveSummary.healthIndex}%</div>
        <div class="kpi-delta">${escapeHtml(executiveSummary.healthStatus)} stav</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Organické kliky</div>
        <div class="kpi-value">${formatNumber(executiveSummary.clicksNow)}</div>
        <div class="kpi-delta ${executiveSummary.clicksDelta >= 0 ? "delta-pos" : "delta-neg"}">
          ${executiveSummary.clicksDelta >= 0 ? "+" : ""}${formatNumber(executiveSummary.clicksDelta)} (${executiveSummary.clicksDeltaPct >= 0 ? "+" : ""}${executiveSummary.clicksDeltaPct}%)
        </div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Impresie (Zobrazenia)</div>
        <div class="kpi-value">${formatNumber(executiveSummary.impressionsNow)}</div>
        <div class="kpi-delta ${executiveSummary.impressionsDelta >= 0 ? "delta-pos" : "delta-neg"}">
          ${executiveSummary.impressionsDelta >= 0 ? "+" : ""}${formatNumber(executiveSummary.impressionsDelta)} (${executiveSummary.impressionsDeltaPct >= 0 ? "+" : ""}${executiveSummary.impressionsDeltaPct}%)
        </div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Priemerná pozícia</div>
        <div class="kpi-value">${executiveSummary.avgPositionNow}</div>
        <div class="kpi-delta ${executiveSummary.avgPositionDelta <= 0 ? "delta-pos" : "delta-neg"}">
          ${executiveSummary.avgPositionDelta <= 0 ? "Zlepšenie o " : "Pokles o "}${Math.abs(executiveSummary.avgPositionDelta).toFixed(1)}
        </div>
      </div>
    </div>

    <!-- Top Decay Drops -->
    <h2>Zistené prepady návštevnosti (Decay Radar)</h2>
    ${
      topDrops.length > 0
        ? `<table>
      <thead>
        <tr>
          <th>URL adresa</th>
          <th style="text-align: right;">Predtým</th>
          <th style="text-align: right;">Teraz</th>
          <th style="text-align: right;">Zmena</th>
          <th>Stav / Odporúčanie</th>
        </tr>
      </thead>
      <tbody>
        ${topDrops
          .map((r) => {
            const delta = r.clicksNow - r.clicksPrev;
            return `<tr>
              <td class="url-cell" title="${escapeHtml(r.url)}">${escapeHtml(r.url.replace(/^https?:\/\/[^/]+/i, ""))}</td>
              <td style="text-align: right;">${formatNumber(r.clicksPrev)}</td>
              <td style="text-align: right; font-weight: 700;">${formatNumber(r.clicksNow)}</td>
              <td style="text-align: right;" class="delta-neg"><strong>${delta}</strong></td>
              <td><span class="badge ${r.status === "critical" ? "badge-danger" : "badge-warning"}">${r.status === "critical" ? "Kritický pokles" : "Pokles"}</span> Revitalizovať obsah</td>
            </tr>`;
          })
          .join("")}
      </tbody>
    </table>`
        : `<p style="font-size: 9pt; color: #64748b; margin-bottom: 18px;">V tomto období neboli detegované žiadne kritické prepady návštevnosti.</p>`
    }

    <!-- Top CTR Booster Opportunities -->
    <h2>Top Príležitosti v Striking Distance (Pozície 4–15)</h2>
    ${
      topOpportunities.length > 0
        ? `<table>
      <thead>
        <tr>
          <th>Kľúčové slovo</th>
          <th style="text-align: right;">Pozícia</th>
          <th style="text-align: right;">Impresie</th>
          <th style="text-align: right;">Kliky</th>
          <th>Odporúčaná akcia</th>
        </tr>
      </thead>
      <tbody>
        ${topOpportunities
          .map(
            (o) => `<tr>
          <td><strong>${escapeHtml(o.query)}</strong></td>
          <td style="text-align: right;">${o.position.toFixed(1)}</td>
          <td style="text-align: right;">${formatNumber(o.impressions)}</td>
          <td style="text-align: right;">${formatNumber(o.clicks)}</td>
          <td style="color: #0284c7; font-weight: 500;">${escapeHtml(o.recommendedAction || "Optimalizovať Title & Meta Description")}</td>
        </tr>`,
          )
          .join("")}
      </tbody>
    </table>`
        : `<p style="font-size: 9pt; color: #64748b; margin-bottom: 18px;">Žiadne dáta o Striking distance príležitostiach.</p>`
    }

    <!-- Recommendations for next month -->
    <h2>Akčný plán na ďalší mesiac</h2>
    <div class="rec-list">
      ${recommendations
        .map(
          (rec) => `<div class="rec-item">
        <div class="rec-header">
          <span class="rec-title">${escapeHtml(rec.title)}</span>
          <span class="badge ${rec.priority === "Vysoká" ? "badge-danger" : "badge-warning"}">${escapeHtml(rec.priority)} priorita</span>
        </div>
        <div class="rec-desc">${escapeHtml(rec.description)} &bull; <strong>Dopad:</strong> ${escapeHtml(rec.impact)}</div>
      </div>`,
        )
        .join("")}
    </div>

    <!-- Footer -->
    <div class="footer">
      <div>${escapeHtml(agency.footerText || "Dôverný mesačný SEO report.")}</div>
      <div>${agency.contactEmail ? `Kontakt: ${escapeHtml(agency.contactEmail)}` : ""}</div>
    </div>
  </div>
</body>
</html>`;
}

/**
 * Triggers the browser print dialog with the rendered executive report.
 */
export function exportClientReportPdf(
  data: ExecutiveReportData,
  options: PdfExportOptions = {},
): void {
  const html = generateReportHtml(data, options.criticalDrops || []);
  const printWindow = window.open("", "_blank");
  if (!printWindow) {
    alert("Povolenie vyskakovacích okien je potrebné na stiahnutie PDF.");
    return;
  }
  printWindow.document.open();
  printWindow.document.write(html);
  printWindow.document.close();

  if (options.autoPrint !== false) {
    printWindow.onload = () => {
      printWindow.focus();
      printWindow.print();
    };
  }
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function formatNumber(n: number): string {
  return new Intl.NumberFormat("sk-SK").format(n);
}
