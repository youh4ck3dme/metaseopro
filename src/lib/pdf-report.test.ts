import { describe, it, expect } from "vitest";
import { generateReportHtml } from "./pdf-report";
import type { ExecutiveReportData } from "./agency";
import type { ScoredDecayRow } from "./decay-schema";

describe("Whitelabel Client PDF Report Generator", () => {
  const sampleData: ExecutiveReportData = {
    agency: {
      name: "Top SEO Agency s.r.o.",
      logoUrl: "https://agency.sk/logo.png",
      primaryColor: "#059669",
      contactEmail: "info@topagency.sk",
      footerText: "Dôverný report vygenerovaný pre klienta.",
    },
    client: {
      domain: "klient-web.sk",
      displayName: "klient-web.sk",
      periodNow: "Posledných 90 dní",
      periodPrev: "Predchádzajúcich 90 dní",
      generatedAt: "11. novembra 2026",
    },
    executiveSummary: {
      healthIndex: 88,
      healthStatus: "Výborný",
      healthColor: "#10b981",
      clicksNow: 12500,
      clicksPrev: 11000,
      clicksDelta: 1500,
      clicksDeltaPct: 14,
      impressionsNow: 340000,
      impressionsPrev: 300000,
      impressionsDelta: 40000,
      impressionsDeltaPct: 13,
      avgPositionNow: 8.4,
      avgPositionPrev: 9.2,
      avgPositionDelta: -0.8,
      totalPages: 120,
      executiveNote: "Rast organickej návštevnosti o 14% vďaka novým landing pages.",
    },
    topWinners: [],
    opportunities: [
      {
        query: "ako schudnúť do plaviek",
        url: "https://klient-web.sk/blog/chudnutie",
        position: 6.2,
        impressions: 4500,
        clicks: 310,
        potentialGrowth: "+120 klikov",
        recommendedAction: "Optimalizovať Title & Meta Description",
      },
    ],
    realizedOptimizations: [],
    recommendations: [
      {
        title: "CTR Booster pre TOP 10",
        description: "Úprava meta tagov na 5 podstránkach.",
        priority: "Vysoká",
        impact: "+100 klikov",
      },
    ],
  };

  const sampleDrops: ScoredDecayRow[] = [
    {
      url: "https://klient-web.sk/cennik",
      title: "Cenník služieb",
      clicksNow: 50,
      clicksPrev: 200,
      impressionsNow: 1000,
      impressionsPrev: 1500,
      positionNow: 12,
      positionPrev: 4,
      clicksDeltaPct: -75,
      positionDelta: 8,
      decayScore: 95,
      status: "critical",
      topQueries: [],
    },
  ];

  it("renders agency branding, colors, and client domain", () => {
    const html = generateReportHtml(sampleData, sampleDrops);

    expect(html).toContain("Top SEO Agency s.r.o.");
    expect(html).toContain("https://agency.sk/logo.png");
    expect(html).toContain("#059669");
    expect(html).toContain("klient-web.sk");
    expect(html).toContain("info@topagency.sk");
  });

  it("renders KPI summary cards and executive note", () => {
    const html = generateReportHtml(sampleData, sampleDrops);

    expect(html).toContain("88%");
    expect(html).toContain("12&nbsp;500".replace(/&nbsp;/g, "\u00a0") || "12 500");
    expect(html).toContain("340 000".replace(/ /g, "\u00a0") || "340 000");
    expect(html).toContain("8.4");
    expect(html).toContain("Rast organickej návštevnosti o 14%");
  });

  it("includes top decay drops and Striking Distance opportunities", () => {
    const html = generateReportHtml(sampleData, sampleDrops);

    expect(html).toContain("/cennik");
    expect(html).toContain("-150");
    expect(html).toContain("Kritický pokles");
    expect(html).toContain("ako schudnúť do plaviek");
    expect(html).toContain("6.2");
  });

  it("escapes malicious inputs against XSS", () => {
    const maliciousData: ExecutiveReportData = {
      ...sampleData,
      agency: {
        ...sampleData.agency,
        name: `<script>alert('xss')</script>Agentúra`,
      },
      client: {
        ...sampleData.client,
        domain: `<img src=x onerror=alert(1)>`,
      },
    };

    const html = generateReportHtml(maliciousData, []);
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;img src=x");
  });
});
