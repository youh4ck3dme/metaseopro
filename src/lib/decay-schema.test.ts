import { describe, expect, it } from "vitest";
import {
  AnalyzeDecaySchema,
  GeneratePlanSchema,
  DECAY_SCENARIOS,
  DECAY_LANGUAGES,
} from "./decay-schema";

describe("Decay Schema Validation", () => {
  it("validates correct AnalyzeDecayInput", () => {
    const valid = AnalyzeDecaySchema.safeParse({
      mode: "demo",
      scenario: "blog",
    });
    expect(valid.success).toBe(true);
    if (valid.success) {
      expect(valid.data.scenario).toBe("blog");
      expect(valid.data.mode).toBe("demo");
    }
  });

  it("applies default mode: demo when omitted", () => {
    const result = AnalyzeDecaySchema.safeParse({
      scenario: "ecommerce",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.mode).toBe("demo");
    }
  });

  it("rejects invalid scenario values", () => {
    const invalid = AnalyzeDecaySchema.safeParse({
      scenario: "non-existent-scenario",
    });
    expect(invalid.success).toBe(false);
  });

  it("validates all supported scenarios and languages", () => {
    expect(DECAY_SCENARIOS).toEqual(["blog", "ecommerce", "local", "saas"]);
    expect(DECAY_LANGUAGES).toEqual(["sk", "cs", "en"]);
  });

  it("validates GeneratePlanSchema with complete scored row", () => {
    const validPlanInput = {
      demo: true,
      scenario: "blog" as const,
      language: "sk" as const,
      siteUrl: "https://demo-blog.sk",
      row: {
        url: "https://demo-blog.sk/behanie",
        title: "Ako začať behať",
        clicksPrev: 1000,
        clicksNow: 400,
        impressionsPrev: 20000,
        impressionsNow: 15000,
        positionPrev: 4.5,
        positionNow: 9.2,
        topQueries: [
          {
            query: "behanie pre začiatočníkov",
            clicksPrev: 500,
            clicksNow: 150,
            positionPrev: 3.2,
            positionNow: 8.5,
          },
        ],
        clicksDeltaPct: -60,
        positionDelta: 4.7,
        decayScore: 61,
        status: "critical" as const,
      },
    };

    const result = GeneratePlanSchema.safeParse(validPlanInput);
    expect(result.success).toBe(true);
  });

  it("rejects GeneratePlanSchema when required fields are missing", () => {
    const invalidInput = {
      demo: true,
      scenario: "blog",
      // missing language, siteUrl, row
    };

    const result = GeneratePlanSchema.safeParse(invalidInput);
    expect(result.success).toBe(false);
  });
});
