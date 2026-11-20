// Shared, client-safe Zod schemas + types for the Content Decay / Decay Radar workflow.
import { z } from "zod";

export const DECAY_SCENARIOS = ["blog", "ecommerce", "local", "saas"] as const;
export type DecayScenario = (typeof DECAY_SCENARIOS)[number];

export const SCENARIO_LABEL: Record<DecayScenario, string> = {
  blog: "Blog",
  ecommerce: "Ecommerce",
  local: "Lokálny biznis",
  saas: "SaaS",
};

export const DECAY_LANGUAGES = ["sk", "cs", "en"] as const;
export type DecayLanguage = (typeof DECAY_LANGUAGES)[number];

export const LANGUAGE_LABEL: Record<DecayLanguage, string> = {
  sk: "Slovenčina",
  cs: "Čeština",
  en: "English",
};

// "declining" (poklesy) sú jadrom Decay Radaru; ostatné pre kontext.
export type DecayStatus = "critical" | "declining" | "stable" | "growing";

export const STATUS_LABEL: Record<DecayStatus, string> = {
  critical: "Kritický pokles",
  declining: "Klesá",
  stable: "Stabilné",
  growing: "Rastie",
};

export type QueryRow = {
  query: string;
  clicksPrev: number;
  clicksNow: number;
  positionPrev: number;
  positionNow: number;
};

export type DecayRow = {
  url: string;
  title: string;
  clicksPrev: number;
  clicksNow: number;
  impressionsPrev: number;
  impressionsNow: number;
  positionPrev: number;
  positionNow: number;
  topQueries: QueryRow[];
};

// Row enriched by the server with computed metrics.
export type ScoredDecayRow = DecayRow & {
  clicksDeltaPct: number;
  positionDelta: number;
  decayScore: number;
  status: DecayStatus;
};

export type DecayDataset = {
  demo: boolean;
  scenario: DecayScenario;
  siteUrl: string;
  scenarioLabel: string;
  periodPrev: string;
  periodNow: string;
  rows: ScoredDecayRow[];
  note: string;
};

// ---- API request schemas ----

export const AnalyzeDecaySchema = z.object({
  mode: z.enum(["demo", "live"]).default("demo"),
  scenario: z.enum(DECAY_SCENARIOS),
  // Live mode only: must match a verified GSC property exactly.
  siteUrl: z.string().max(2048).optional(),
});
export type AnalyzeDecayInput = z.infer<typeof AnalyzeDecaySchema>;

const QueryRowSchema = z.object({
  query: z.string().max(300),
  clicksPrev: z.number().int().min(0).max(10_000_000),
  clicksNow: z.number().int().min(0).max(10_000_000),
  positionPrev: z.number().min(0).max(200),
  positionNow: z.number().min(0).max(200),
});

const ScoredRowSchema = z.object({
  url: z.string().max(2048),
  title: z.string().max(500),
  clicksPrev: z.number().int().min(0).max(10_000_000),
  clicksNow: z.number().int().min(0).max(10_000_000),
  impressionsPrev: z.number().int().min(0).max(1_000_000_000),
  impressionsNow: z.number().int().min(0).max(1_000_000_000),
  positionPrev: z.number().min(0).max(200),
  positionNow: z.number().min(0).max(200),
  topQueries: z.array(QueryRowSchema).max(20),
  clicksDeltaPct: z.number().min(-100).max(100000),
  positionDelta: z.number().min(-200).max(200),
  decayScore: z.number().min(0).max(100),
  status: z.enum(["critical", "declining", "stable", "growing"]),
});

export const GeneratePlanSchema = z.object({
  demo: z.boolean(),
  scenario: z.enum(DECAY_SCENARIOS),
  language: z.enum(DECAY_LANGUAGES),
  siteUrl: z.string().max(2048),
  row: ScoredRowSchema,
});
export type GeneratePlanInput = z.infer<typeof GeneratePlanSchema>;
