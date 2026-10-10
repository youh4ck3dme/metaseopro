import { describe, expect, it } from "vitest";
import { classifyIntent, experimentVerdict, isEligible, rankOpportunities } from "./opportunity";

describe("opportunity engine", () => {
  it("keeps zero-click pages with impressions", () => {
    expect(isEligible({ clicks: 0, impressions: 654 })).toBe(true);
    expect(isEligible({ clicks: 0, impressions: 5 })).toBe(false);
  });
  it("treats pricing queries as commercial", () => {
    expect(["COMMERCIAL", "TRANSACTIONAL"]).toContain(classifyIntent("cennik stahovania bratislava"));
  });
  it("ranks the pricing page high", () => {
    const r = rankOpportunities([
      { url: "https://viandmo.com/cennik-stahovania-bratislava/", clicks: 0, impressions: 654, position: 38.2, clicksPrev: 0, impressionsPrev: 400, positionPrev: 40, queries: [] },
      { url: "https://viandmo.com/kontakty/", clicks: 14, impressions: 265, position: 4.9, clicksPrev: 12, impressionsPrev: 250, positionPrev: 5, queries: [] },
    ]);
    expect(r[0]!.url).toContain("cennik");
  });
  it("needs data before verdict", () => {
    expect(experimentVerdict({ clicks: 0, impressions: 600, position: 38 }, { clicks: 5, impressions: 600, position: 20 }, 2)).toBe("INSUFFICIENT DATA");
  });
});
