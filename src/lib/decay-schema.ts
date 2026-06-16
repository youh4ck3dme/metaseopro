// Shared Zod schemas + types for Content Decay Radar. Client + server safe.
import { z } from "zod";

export const DECAY_LANGUAGES = ["sk", "cs", "en"] as const;
export type DecayLanguage = (typeof DECAY_LANGUAGES)[number];

export const DECAY_WINDOWS = ["28", "90"] as const;
export type DecayWindow = (typeof DECAY_WINDOWS)[number];

export const DECAY_MODES = ["live", "demo"] as const;
export type DecayMode = (typeof DECAY_MODES)[number];

export const DEMO_SCENARIOS = ["blog", "ecommerce", "local", "saas"] as const;
export type DemoScenario = (typeof DEMO_SCENARIOS)[number];

export const DECAY_TYPES = [
  "Traffic Drop",
  "CTR Drop",
  "Ranking Drop",
  "Impression Drop",
  "Hidden Opportunity",
] as const;
export type DecayType = (typeof DECAY_TYPES)[number];

export const PRIORITIES = ["high", "medium", "low"] as const;
export type Priority = (typeof PRIORITIES)[number];

export const RECOMMENDED_ACTIONS = [
  "refresh",
  "expand",
  "merge",
  "redirect",
  "improve_meta",
  "internal_links",
  "leave_alone",
] as const;
export type RecommendedAction = (typeof RECOMMENDED_ACTIONS)[number];

export type QueryStat = {
  query: string;
  current_clicks: number;
  previous_clicks: number;
  clicks_delta: number;
  current_impressions: number;
  current_position: number;
};

export type DecayRow = {
  url: string;
  current_clicks: number;
  previous_clicks: number;
  clicks_delta: number;
  clicks_delta_percent: number;
  current_impressions: number;
  previous_impressions: number;
  impressions_delta: number;
  impressions_delta_percent: number;
  current_ctr: number;
  previous_ctr: number;
  ctr_delta: number;
  current_position: number;
  previous_position: number;
  position_delta: number;
  top_lost_queries: QueryStat[];
  top_opportunity_queries: QueryStat[];
  decay_type: DecayType;
  priority: Priority;
  priority_score: number;
  recommended_action: RecommendedAction;
};

export type DecaySummary = {
  pages_analyzed: number;
  pages_with_decay: number;
  estimated_lost_clicks: number;
  highest_opportunity_url: string | null;
  critical_decay_count: number;
};

export type DecayAnalysisResult = {
  mode: DecayMode;
  property: string;
  window: DecayWindow;
  current_period: { start: string; end: string };
  previous_period: { start: string; end: string };
  summary: DecaySummary;
  rows: DecayRow[];
  demo_scenario?: DemoScenario;
};

// ---- Request schemas ----

export const PropertiesBodySchema = z
  .object({})
  .passthrough()
  .optional()
  .default({});

export const AnalyzeBodySchema = z.object({
  mode: z.enum(DECAY_MODES).default("demo"),
  property: z.string().trim().max(2048).default(""),
  window: z.enum(DECAY_WINDOWS).default("28"),
  minImpressions: z.number().int().min(0).max(1_000_000).default(50),
  urlContains: z.string().trim().max(300).optional().default(""),
  includeQueryLevel: z.boolean().default(true),
  language: z.enum(DECAY_LANGUAGES).default("sk"),
  demoScenario: z.enum(DEMO_SCENARIOS).default("blog"),
});
export type AnalyzeBody = z.infer<typeof AnalyzeBodySchema>;

// One decay row sent back up for the AI plan. Keep it bounded.
const QueryStatSchema = z.object({
  query: z.string().max(300),
  current_clicks: z.number(),
  previous_clicks: z.number(),
  clicks_delta: z.number(),
  current_impressions: z.number(),
  current_position: z.number(),
});

const DecayRowSchema = z.object({
  url: z.string().max(2048),
  current_clicks: z.number(),
  previous_clicks: z.number(),
  clicks_delta: z.number(),
  clicks_delta_percent: z.number(),
  current_impressions: z.number(),
  previous_impressions: z.number(),
  impressions_delta: z.number(),
  impressions_delta_percent: z.number(),
  current_ctr: z.number(),
  previous_ctr: z.number(),
  ctr_delta: z.number(),
  current_position: z.number(),
  previous_position: z.number(),
  position_delta: z.number(),
  top_lost_queries: z.array(QueryStatSchema).max(30),
  top_opportunity_queries: z.array(QueryStatSchema).max(30),
  decay_type: z.enum(DECAY_TYPES),
  priority: z.enum(PRIORITIES),
  priority_score: z.number(),
  recommended_action: z.enum(RECOMMENDED_ACTIONS),
});

export const GeneratePlanBodySchema = z.object({
  mode: z.enum(DECAY_MODES).default("demo"),
  property: z.string().trim().max(2048).default(""),
  window: z.enum(DECAY_WINDOWS).default("28"),
  language: z.enum(DECAY_LANGUAGES).default("sk"),
  row: DecayRowSchema,
});
export type GeneratePlanBody = z.infer<typeof GeneratePlanBodySchema>;

// ---- UI labels ----

export const LANGUAGE_LABEL: Record<DecayLanguage, string> = {
  sk: "Slovenčina",
  cs: "Čeština",
  en: "English",
};

export const DECAY_TYPE_LABEL: Record<DecayType, string> = {
  "Traffic Drop": "Pokles trafficu",
  "CTR Drop": "Pokles CTR",
  "Ranking Drop": "Pokles pozície",
  "Impression Drop": "Pokles impresií",
  "Hidden Opportunity": "Skrytá príležitosť",
};

export const PRIORITY_LABEL: Record<Priority, string> = {
  high: "Vysoká",
  medium: "Stredná",
  low: "Nízka",
};

export const ACTION_LABEL: Record<RecommendedAction, string> = {
  refresh: "Refreshnúť obsah",
  expand: "Rozšíriť obsah",
  merge: "Zlúčiť s inou stránkou",
  redirect: "Presmerovať (301)",
  improve_meta: "Vylepšiť title/meta",
  internal_links: "Pridať interné odkazy",
  leave_alone: "Nechať tak",
};

export const SCENARIO_LABEL: Record<DemoScenario, string> = {
  blog: "Blog / Magazín",
  ecommerce: "E-commerce",
  local: "Lokálny biznis",
  saas: "SaaS",
};

export function normalizePropertyToUrl(property: string): string {
  // GSC properties can be "sc-domain:example.com" or "https://example.com/".
  if (property.startsWith("sc-domain:")) {
    return `https://${property.slice("sc-domain:".length)}`;
  }
  return property;
}
