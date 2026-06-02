// Shared, client-safe schemas + helpers for the SEO Raketa workflow.
// No server-only imports here — used by both the route UI and the API routes.
import { z } from "zod";

export const RAKETA_LANGUAGES = ["sk", "cz", "en"] as const;
export type RaketaLanguage = (typeof RAKETA_LANGUAGES)[number];

export const LANGUAGE_LABEL: Record<RaketaLanguage, string> = {
  sk: "Slovenčina",
  cz: "Čeština",
  en: "English",
};

export const RAKETA_OUTPUTS = [
  "audit",
  "competitor",
  "article",
  "brief",
  "calendar",
  "landing",
] as const;
export type RaketaOutput = (typeof RAKETA_OUTPUTS)[number];

export const OUTPUT_LABEL: Record<RaketaOutput, string> = {
  audit: "Full SEO audit",
  competitor: "Konkurenčný report",
  article: "SEO blog článok",
  brief: "Content brief",
  calendar: "30-dňový content kalendár",
  landing: "Landing page copy",
};

/** Returns a normalized https URL string, or null if invalid. */
export function normalizeUrl(raw: string): string | null {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return null;
  let candidate = trimmed;
  if (!/^https?:\/\//i.test(candidate)) candidate = `https://${candidate}`;
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  // host must contain a dot (a real domain) and no spaces
  if (!url.hostname.includes(".") || /\s/.test(url.hostname)) return null;
  return url.toString();
}

export function isValidUrl(raw: string): boolean {
  return normalizeUrl(raw) !== null;
}

// Optional URL field: empty string allowed, otherwise must be valid.
const optionalUrl = z
  .string()
  .trim()
  .max(2048)
  .optional()
  .default("")
  .refine((v) => v === "" || isValidUrl(v), {
    message: "Neplatná URL. Použi formát napr. https://priklad.sk",
  });

// Client-side form schema (own URL required).
export const RaketaFormSchema = z.object({
  ownUrl: z
    .string()
    .trim()
    .min(1, "Zadaj URL svojho webu.")
    .max(2048)
    .refine(isValidUrl, "Neplatná URL. Použi formát napr. https://priklad.sk"),
  competitorUrl: optionalUrl,
  keyword: z
    .string()
    .trim()
    .min(2, "Zadaj cieľový keyword alebo tému.")
    .max(200),
  language: z.enum(RAKETA_LANGUAGES),
  output: z.enum(RAKETA_OUTPUTS),
});
export type RaketaForm = z.infer<typeof RaketaFormSchema>;

// Server-side analyze body.
export const AnalyzeBodySchema = z.object({
  ownUrl: z.string().trim().min(1).max(2048),
  competitorUrl: z.string().trim().max(2048).optional().default(""),
  keyword: z.string().trim().min(1).max(200),
});

// Structured page analysis returned by the server.
export type PageAnalysis = {
  url: string;
  ok: boolean;
  estimated: boolean; // true => mock/fallback data
  title: string;
  metaDescription: string;
  h1: string[];
  h2: string[];
  h3: string[];
  ctas: string[];
  wordCount: number;
  textSummary: string;
  note?: string;
};

export type ComparisonResult = {
  contentGaps: string[];
  missingKeywords: string[];
  weakHeadings: string[];
  metaIssues: string[];
  ctaIssues: string[];
};

export type RaketaAnalysis = {
  own: PageAnalysis;
  competitor: PageAnalysis | null;
  comparison: ComparisonResult;
};
