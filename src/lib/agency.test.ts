import { describe, expect, it } from "vitest";
import {
  calculateHealthIndex,
  formatDomainDisplayName,
  buildExecutiveReportData,
  DEFAULT_AGENCY_PROFILE,
} from "./agency";
import type { DecayDataset, ScoredDecayRow } from "./decay-schema";

describe("Whitelabel Agency Engine", () => {
  it("calculates SEO health index accurately", () => {
    // 0 pages => 100
    expect(calculateHealthIndex(0, 0, 0)).toBe(100);
    // 10 pages, 0 critical, 0 declining => 100
    expect(calculateHealthIndex(10, 0, 0)).toBe(100);
    // 10 pages, 2 critical (weight 1.0 = 2), 2 declining (weight 0.5 = 1) => total bad 3 => 70%
    expect(calculateHealthIndex(10, 2, 2)).toBe(70);
    // all critical => 0%
    expect(calculateHealthIndex(5, 5, 0)).toBe(0);
  });

  it("formats domain display names cleanly", () => {
    expect(formatDomainDisplayName("sc-domain:example.com")).toBe("example.com");
    expect(formatDomainDisplayName("https://www.myshop.sk/")).toBe("myshop.sk");
    expect(formatDomainDisplayName("http://sub.domain.cz/path")).toBe("sub.domain.cz");
    expect(formatDomainDisplayName("fyzioafit.sk")).toBe("fyzioafit.sk");
  });

  it("builds executive report data with agency branding and fallback defaults", () => {
    const mockDataset: DecayDataset = {
      demo: false,
      scenario: "ecommerce",
      siteUrl: "sc-domain:mojobchod.sk",
      scenarioLabel: "Ecommerce",
      periodPrev: "01. 01. 2026 – 31. 03. 2026",
      periodNow: "01. 04. 2026 – 30. 06. 2026",
      note: "Test note",
      rows: [
        {
          url: "https://mojobchod.sk/tenisky",
          title: "Pánske tenisky",
          clicksPrev: 100,
          clicksNow: 250,
          impressionsPrev: 2000,
          impressionsNow: 4000,
          positionPrev: 8.5,
          positionNow: 4.2,
          clicksDeltaPct: 150,
          positionDelta: -4.3,
          decayScore: 0,
          status: "growing",
          topQueries: [
            {
              query: "panske bezecke tenisky",
              clicksPrev: 50,
              clicksNow: 160,
              positionPrev: 6.0,
              positionNow: 3.2,
            },
          ],
        },
        {
          url: "https://mojobchod.sk/mikiny",
          title: "Športové mikiny",
          clicksPrev: 300,
          clicksNow: 150,
          impressionsPrev: 5000,
          impressionsNow: 3500,
          positionPrev: 4.0,
          positionNow: 7.8,
          clicksDeltaPct: -50,
          positionDelta: 3.8,
          decayScore: 65,
          status: "declining",
          topQueries: [
            {
              query: "bavlnene mikiny",
              clicksPrev: 120,
              clicksNow: 40,
              positionPrev: 3.5,
              positionNow: 8.1,
            },
          ],
        },
      ],
    };

    const customAgency = {
      agency_name: "Apex Marketing Digital",
      logo_url: "https://apex.sk/logo.png",
      primary_color: "#2563eb",
      contact_email: "hello@apex.sk",
      report_footer_text: "Dôverný report vypracovaný agentúrou Apex Marketing pre klienta.",
    };

    const report = buildExecutiveReportData({
      dataset: mockDataset,
      siteUrl: "sc-domain:mojobchod.sk",
      agencyProfile: customAgency,
    });

    // Verify agency branding
    expect(report.agency.name).toBe("Apex Marketing Digital");
    expect(report.agency.logoUrl).toBe("https://apex.sk/logo.png");
    expect(report.agency.primaryColor).toBe("#2563eb");
    expect(report.agency.contactEmail).toBe("hello@apex.sk");

    // Verify client & period
    expect(report.client.domain).toBe("mojobchod.sk");
    expect(report.client.periodPrev).toBe("01. 01. 2026 – 31. 03. 2026");
    expect(report.client.periodNow).toBe("01. 04. 2026 – 30. 06. 2026");

    // Verify metrics
    // clicksNow: 250 + 150 = 400, clicksPrev: 100 + 300 = 400 => clicksDelta: 0
    expect(report.executiveSummary.clicksNow).toBe(400);
    expect(report.executiveSummary.clicksPrev).toBe(400);
    expect(report.executiveSummary.clicksDelta).toBe(0);

    // Top winners
    expect(report.topWinners.length).toBeGreaterThan(0);
    expect(report.topWinners[0].query).toBe("panske bezecke tenisky");
    expect(report.topWinners[0].clicksDelta).toBe(110);

    // Striking distance opportunities (position between 4 and 15)
    expect(report.opportunities.length).toBeGreaterThan(0);
    expect(report.opportunities.some((o) => o.url.includes("tenisky"))).toBe(true);

    // Recommendations exist
    expect(report.recommendations.length).toBeGreaterThan(0);
    expect(report.recommendations[0].priority).toBe("Vysoká");
  });
});
