import { describe, expect, it } from "vitest";
import { buildDemoDataset } from "./decay-analyze.server";
import { SCENARIO_LABEL, type DecayScenario } from "./decay-schema";

describe("Decay Radar Analysis (Unit & Regression)", () => {
  const scenarios: DecayScenario[] = ["blog", "ecommerce", "local", "saas"];

  scenarios.forEach((scenario) => {
    it(`builds a valid demo dataset for scenario: ${scenario}`, () => {
      const dataset = buildDemoDataset(scenario);

      expect(dataset.demo).toBe(true);
      expect(dataset.scenario).toBe(scenario);
      expect(dataset.scenarioLabel).toBe(SCENARIO_LABEL[scenario]);
      expect(dataset.siteUrl).toBeTruthy();
      expect(typeof dataset.periodPrev).toBe("string");
      expect(dataset.periodPrev.length).toBeGreaterThan(0);
      expect(typeof dataset.periodNow).toBe("string");
      expect(dataset.periodNow.length).toBeGreaterThan(0);
      expect(Array.isArray(dataset.rows)).toBe(true);
      expect(dataset.rows.length).toBeGreaterThan(0);
      expect(dataset.note).toContain("demo dátach");
    });
  });

  it("calculates accurate decay scores and status thresholds", () => {
    const dataset = buildDemoDataset("blog");
    const rows = dataset.rows;

    for (const row of rows) {
      // Decay score must be clamped between 0 and 100
      expect(row.decayScore).toBeGreaterThanOrEqual(0);
      expect(row.decayScore).toBeLessThanOrEqual(100);

      // clicksDeltaPct calculation verification
      if (row.clicksPrev > 0) {
        const expectedDelta = Math.round(
          ((row.clicksNow - row.clicksPrev) / row.clicksPrev) * 100,
        );
        expect(row.clicksDeltaPct).toBe(expectedDelta);
      }

      // positionDelta check: positive delta means rank dropped (worse)
      if (row.positionNow > 0 && row.positionPrev > 0) {
        const expectedPosDelta = Number((row.positionNow - row.positionPrev).toFixed(1));
        expect(row.positionDelta).toBe(expectedPosDelta);
      }

      // Status classification check
      if (row.clicksDeltaPct >= 5) {
        expect(row.status).toBe("growing");
      } else if (row.clicksDeltaPct > -10) {
        expect(row.status).toBe("stable");
      } else if (row.decayScore >= 55) {
        expect(row.status).toBe("critical");
      } else {
        expect(row.status).toBe("declining");
      }
    }
  });

  it("sorts rows with critical decay first, followed by declining, stable, and growing", () => {
    const dataset = buildDemoDataset("ecommerce");
    const statusOrder: Record<string, number> = {
      critical: 0,
      declining: 1,
      stable: 2,
      growing: 3,
    };

    for (let i = 0; i < dataset.rows.length - 1; i++) {
      const current = dataset.rows[i];
      const next = dataset.rows[i + 1];

      const currentOrder = statusOrder[current.status];
      const nextOrder = statusOrder[next.status];

      expect(currentOrder).toBeLessThanOrEqual(nextOrder);

      // Within the same status, rows must be ordered by descending decayScore
      if (current.status === next.status) {
        expect(current.decayScore).toBeGreaterThanOrEqual(next.decayScore);
      }
    }
  });
});
