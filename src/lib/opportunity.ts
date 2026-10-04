// Client-safe SEO Opportunity Engine: pure functions over Search Console data.
// No I/O here — everything is deterministic and unit-tested.

export type OppQuery = {
  query: string;
  clicks: number;
  impressions: number;
  position: number;
  clicksPrev: number;
  impressionsPrev: number;
  positionPrev: number;
};

export type OppPage = {
  url: string;
  clicks: number;
  impressions: number;
  position: number;
  clicksPrev: number;
  impressionsPrev: number;
  positionPrev: number;
  queries: OppQuery[];
};

export type Intent =
  | "TRANSACTIONAL"
  | "COMMERCIAL"
  | "LOCAL"
  | "INFORMATIONAL"
  | "NAVIGATIONAL"
  | "MIXED";

export type PageType =
  | "pricing_landing"
  | "service_landing"
  | "informational_article"
  | "contact_page"
  | "homepage"
  | "legal_or_utility";

export type Category =
  | "QUICK_WIN"
  | "STRIKING_DISTANCE"
  | "HIGH_IMPRESSIONS_ZERO_CLICKS"
  | "DECAYING"
  | "GROWING"
  | "CTR_PROBLEM"
  | "CONTENT_GAP"
  | "CANNIBALIZATION_RISK"
  | "TECHNICAL_ISSUE"
  | "PROTECT_WINNER"
  | "LONG_TERM";

export type UiState = "Critical" | "Opportunity" | "Good" | "Protected" | "Needs data";

export const CATEGORY_LABEL: Record<Category, string> = {
  QUICK_WIN: "Quick win",
  STRIKING_DISTANCE: "Striking distance",
  HIGH_IMPRESSIONS_ZERO_CLICKS: "Impresie bez klikov",
  DECAYING: "Klesá",
  GROWING: "Rastie",
  CTR_PROBLEM: "CTR problém",
  CONTENT_GAP: "Content gap",
  CANNIBALIZATION_RISK: "Riziko kanibalizácie",
  TECHNICAL_ISSUE: "Technický problém",
  PROTECT_WINNER: "Chrániť víťaza",
  LONG_TERM: "Dlhodobá príležitosť",
};

export const PAGE_TYPE_LABEL: Record<PageType, string> = {
  pricing_landing: "Cenníková landing page",
  service_landing: "Servisná landing page",
  informational_article: "Informačný článok",
  contact_page: "Kontaktná stránka",
  homepage: "Domovská stránka",
  legal_or_utility: "Právna / pomocná stránka",
};

// ---------- Eligibility ----------

/** A page is an opportunity candidate with ≥20 impressions OR ≥1 click. */
export function isEligible(p: { clicks: number; impressions: number }): boolean {
  return p.impressions >= 20 || p.clicks >= 1;
}

// ---------- Helpers ----------

export const ctr = (clicks: number, impressions: number) =>
  impressions > 0 ? (clicks / impressions) * 100 : 0;

/** Rough organic CTR curve by position (%). Used only as a relative benchmark. */
export function expectedCtr(pos: number): number {
  if (pos <= 0) return 0;
  if (pos <= 1.5) return 28;
  if (pos <= 2.5) return 15;
  if (pos <= 3.5) return 11;
  if (pos <= 5) return 7;
  if (pos <= 7) return 4.5;
  if (pos <= 10) return 2.5;
  if (pos <= 20) return 1;
  return 0.3;
}

export function pathOf(url: string): string {
  try {
    return new URL(url).pathname || "/";
  } catch {
    return url;
  }
}

/** Lowercase + strip Slovak diacritics for robust matching. */
export function norm(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// ---------- Intent ----------

const PRICING = ["cennik", "cena", "ceny", "kolko stoji", "naklady", "price", "lacne", "lacny", "lacna"];
const SERVICE = ["sluzba", "sluzby", "stahovanie", "stahovacia", "vypratavanie", "odvoz", "montaz", "demontaz", "upratovanie", "preprava"];
const INFO = ["ako ", "preco", "co je", "navod", "tipy", "checklist", "kedy", "pripravit"];
const LOCATIONS = ["bratislava", "petrzalka", "ruzinov", "nove mesto", "karlova ves", "dubravka", "stare mesto", "senec", "pezinok", "malacky"];

export function classifyIntent(query: string, brandTerms: string[] = []): Intent {
  const q = norm(query);
  if (!q) return "MIXED";
  if (brandTerms.some((b) => b && q.includes(norm(b)))) return "NAVIGATIONAL";
  const has = (list: string[]) => list.some((k) => q.includes(k));
  const pricing = has(PRICING);
  const info = INFO.some((k) => (q + " ").startsWith(k) || q.includes(" " + k.trim() + " "));
  const service = has(SERVICE);
  const local = has(LOCATIONS);
  if (info && !pricing) return "INFORMATIONAL";
  if (pricing) return "COMMERCIAL";
  if (service && local) return "LOCAL";
  if (service) return "TRANSACTIONAL";
  if (local) return "LOCAL";
  return "MIXED";
}

export function isBranded(query: string, brandTerms: string[]): boolean {
  const q = norm(query);
  return brandTerms.some((b) => b && q.includes(norm(b)));
}

export function dominantIntent(queries: OppQuery[], brandTerms: string[] = []): Intent {
  if (queries.length === 0) return "MIXED";
  const w = new Map<Intent, number>();
  for (const q of queries) {
    const i = classifyIntent(q.query, brandTerms);
    w.set(i, (w.get(i) ?? 0) + Math.max(1, q.impressions));
  }
  const sorted = [...w.entries()].sort((a, b) => b[1] - a[1]);
  const total = sorted.reduce((a, [, v]) => a + v, 0);
  if (sorted.length > 1 && sorted[0]![1] / total < 0.5) return "MIXED";
  return sorted[0]![0];
}

export function recommendPageType(url: string, intent: Intent): PageType {
  const p = norm(pathOf(url).replace(/[/-]/g, " "));
  if (p === "") return "homepage";
  if (/(kontakt|formular)/.test(p)) return "contact_page";
  if (/(ochrana sukromia|cookies|gdpr|obchodne podmienky|category)/.test(p)) return "legal_or_utility";
  if (/(cennik|cena|ceny)/.test(p)) return "pricing_landing";
  if (intent === "COMMERCIAL") return "pricing_landing";
  if (intent === "INFORMATIONAL") return "informational_article";
  return "service_landing";
}

// ---------- Scoring + categories ----------

export type ScoredOpp = OppPage & {
  path: string;
  ctr: number;
  ctrPrev: number;
  expectedCtr: number;
  deltaClicks: number;
  deltaImpressions: number;
  deltaCtr: number;
  deltaPosition: number; // positive = worse
  topQuery: string;
  queryCount: number;
  brandedShare: number; // 0..1 by impressions
  intent: Intent;
  pageType: PageType;
  categories: Category[];
  score: number; // 0..100
  state: UiState;
  action: string;
  cannibalWith: string[];
};

const COMMERCIAL_INTENTS: Intent[] = ["COMMERCIAL", "TRANSACTIONAL", "LOCAL"];

export function scorePage(p: OppPage, brandTerms: string[] = []): ScoredOpp {
  const c = ctr(p.clicks, p.impressions);
  const cPrev = ctr(p.clicksPrev, p.impressionsPrev);
  const exp = expectedCtr(p.position);
  const intent = dominantIntent(p.queries, brandTerms);
  const pageType = recommendPageType(p.url, intent);
  const topQ = [...p.queries].sort((a, b) => b.impressions - a.impressions)[0];
  const qImpr = p.queries.reduce((a, q) => a + q.impressions, 0);
  const brandImpr = p.queries.filter((q) => isBranded(q.query, brandTerms)).reduce((a, q) => a + q.impressions, 0);
  const deltaPosition = p.positionPrev > 0 ? Number((p.position - p.positionPrev).toFixed(1)) : 0;
  const imprGrowth = p.impressionsPrev > 0 ? (p.impressions - p.impressionsPrev) / p.impressionsPrev : p.impressions > 0 ? 1 : 0;

  // ---- score components (0..1) ----
  const sImpr = Math.min(1, Math.log10(1 + p.impressions) / 3); // 1000 impr ≈ 1
  const ctrGap = exp > 0 ? Math.max(0, (exp - c) / exp) : 0;
  const sPos =
    p.position >= 4 && p.position <= 20 ? 1 : p.position > 20 && p.position <= 40 ? 0.5 : p.position > 40 ? 0.25 : 0.3;
  const sGrowth = Math.max(0, Math.min(1, imprGrowth));
  const sIntent = COMMERCIAL_INTENTS.includes(intent) || pageType === "pricing_landing" || pageType === "service_landing" ? 1 : intent === "MIXED" ? 0.5 : 0.3;
  const sEvidence = Math.min(1, p.queries.length / 5);
  let score = 100 * (0.3 * sImpr + 0.2 * ctrGap + 0.2 * sPos + 0.1 * sGrowth + 0.15 * sIntent + 0.05 * sEvidence);
  if (pageType === "legal_or_utility") score *= 0.2;

  // ---- categories ----
  const cats: Category[] = [];
  const winner = p.clicks >= 10 && p.position <= 10;
  if (winner) cats.push("PROTECT_WINNER");
  if (p.impressions >= 100 && p.clicks === 0) cats.push("HIGH_IMPRESSIONS_ZERO_CLICKS");
  if (p.position >= 4 && p.position <= 10 && c < exp) cats.push("QUICK_WIN");
  if (p.position > 10 && p.position <= 20) cats.push("STRIKING_DISTANCE");
  if (p.position > 20 && p.impressions >= 50) cats.push("LONG_TERM");
  if (p.impressions >= 50 && p.position <= 15 && c < exp * 0.5) cats.push("CTR_PROBLEM");
  if (p.clicksPrev >= 5 && p.clicks < p.clicksPrev * 0.7) cats.push("DECAYING");
  else if (p.impressionsPrev > 0 && imprGrowth >= 0.3 && p.impressions >= 30) cats.push("GROWING");
  if (p.position > 20 && p.queries.length >= 3 && COMMERCIAL_INTENTS.includes(intent)) cats.push("CONTENT_GAP");

  // ---- UI state ----
  let state: UiState;
  if (pageType === "legal_or_utility") state = "Good";
  else if (p.impressions < 20 && p.clicks === 0) state = "Needs data";
  else if (winner) state = "Protected";
  else if (cats.includes("HIGH_IMPRESSIONS_ZERO_CLICKS") || cats.includes("DECAYING")) state = "Critical";
  else if (cats.length > 0) state = "Opportunity";
  else state = "Good";

  if (winner) score = Math.min(score, 45); // never top of queue for aggressive rewrite

  return {
    ...p,
    path: pathOf(p.url),
    ctr: Number(c.toFixed(2)),
    ctrPrev: Number(cPrev.toFixed(2)),
    expectedCtr: exp,
    deltaClicks: p.clicks - p.clicksPrev,
    deltaImpressions: p.impressions - p.impressionsPrev,
    deltaCtr: Number((c - cPrev).toFixed(2)),
    deltaPosition,
    topQuery: topQ?.query ?? "",
    queryCount: p.queries.length,
    brandedShare: qImpr > 0 ? brandImpr / qImpr : 0,
    intent,
    pageType,
    categories: cats,
    score: Math.round(Math.max(0, Math.min(100, score))),
    state,
    action: recommendAction(cats, pageType, p),
    cannibalWith: [],
  };
}

export function recommendAction(cats: Category[], pageType: PageType, p: OppPage): string {
  if (pageType === "legal_or_utility") return "Bez akcie — pomocná stránka.";
  if (cats.includes("PROTECT_WINNER"))
    return "Chrániť: upravovať opatrne, zachovať sekcie a dopyty, ktoré nesú kliky. Testovať len title/meta.";
  if (cats.includes("HIGH_IMPRESSIONS_ZERO_CLICKS") && p.position > 20)
    return "Google stránku pozná, ale je ďaleko. Prepracovať obsah podľa zámeru (odpoveď hneď hore), interné odkazy z homepage a /sluzby/.";
  if (cats.includes("HIGH_IMPRESSIONS_ZERO_CLICKS"))
    return "Prepísať title + meta pre zámer dopytu a doplniť chýbajúci obsah nad zlomom.";
  if (cats.includes("CTR_PROBLEM")) return "Testovať nový title a meta popis (SERP Lab).";
  if (cats.includes("QUICK_WIN")) return "Doladiť title/H1 a doplniť sekcie pre sekundárne dopyty.";
  if (cats.includes("STRIKING_DISTANCE")) return "Rozšíriť obsah o chýbajúce entity a pridať 2–3 kontextové interné odkazy.";
  if (cats.includes("DECAYING")) return "Aktualizovať obsah, overiť indexáciu a konkurenciu v SERP.";
  if (cats.includes("CONTENT_GAP")) return "Doplniť chýbajúce sekcie podľa dopytov (služby, lokality, FAQ).";
  if (cats.includes("LONG_TERM")) return "Dlhodobo: budovať relevanciu obsahom a internými odkazmi.";
  return "Monitorovať.";
}

// ---------- Cannibalization ----------

export type CannibalPair = { query: string; urls: string[]; impressions: number };

/** Queries for which ≥2 eligible URLs collect meaningful impressions. */
export function detectCannibalization(pages: OppPage[], minImpr = 5): CannibalPair[] {
  const byQuery = new Map<string, { url: string; impr: number }[]>();
  for (const p of pages) {
    for (const q of p.queries) {
      if (q.impressions < minImpr) continue;
      const k = norm(q.query);
      const list = byQuery.get(k) ?? [];
      list.push({ url: p.url, impr: q.impressions });
      byQuery.set(k, list);
    }
  }
  const out: CannibalPair[] = [];
  for (const [query, list] of byQuery) {
    const urls = [...new Set(list.map((l) => l.url))];
    if (urls.length >= 2)
      out.push({ query, urls, impressions: list.reduce((a, l) => a + l.impr, 0) });
  }
  // Also flag URL-slug overlap (e.g. /cennik/ vs /cennik-stahovania-bratislava/).
  const slugs = pages.map((p) => ({ url: p.url, tokens: new Set(norm(pathOf(p.url).replace(/[/-]/g, " ")).split(" ").filter((t) => t.length > 3)) }));
  for (let i = 0; i < slugs.length; i++)
    for (let j = i + 1; j < slugs.length; j++) {
      const a = slugs[i]!, b = slugs[j]!;
      if (a.tokens.size === 0 || b.tokens.size === 0) continue;
      const inter = [...a.tokens].filter((t) => b.tokens.has(t));
      const smaller = Math.min(a.tokens.size, b.tokens.size);
      if (inter.length > 0 && inter.length / smaller >= 1 && inter.some((t) => ["cennik", "stahovanie", "stahovacia"].includes(t)))
        out.push({ query: `slug: ${inter.join(" ")}`, urls: [a.url, b.url], impressions: 0 });
    }
  return out.sort((a, b) => b.impressions - a.impressions);
}

export function rankOpportunities(pages: OppPage[], brandTerms: string[] = []): ScoredOpp[] {
  const eligible = pages.filter(isEligible);
  const scored = eligible.map((p) => scorePage(p, brandTerms));
  const cannibal = detectCannibalization(eligible);
  for (const s of scored) {
    const others = new Set<string>();
    for (const c of cannibal) if (c.urls.includes(s.url)) c.urls.forEach((u) => u !== s.url && others.add(u));
    s.cannibalWith = [...others];
    if (others.size > 0 && !s.categories.includes("CANNIBALIZATION_RISK")) s.categories.push("CANNIBALIZATION_RISK");
  }
  return scored.sort((a, b) => b.score - a.score);
}

// ---------- Internal links ----------

export type LinkSuggestion = { source: string; target: string; anchor: string; reason: string; priority: "vysoká" | "stredná" | "nízka" };

export function suggestInternalLinks(scored: ScoredOpp[]): LinkSuggestion[] {
  const out: LinkSuggestion[] = [];
  const hubs = scored.filter((s) => s.pageType === "homepage" || /sluzby/.test(s.path));
  const targets = scored.filter((s) => ["pricing_landing", "service_landing"].includes(s.pageType) && !s.categories.includes("PROTECT_WINNER") && s.topQuery);
  const contact = scored.find((s) => s.pageType === "contact_page");
  for (const t of targets.slice(0, 8)) {
    for (const h of hubs) {
      if (h.url === t.url) continue;
      out.push({
        source: h.path,
        target: t.path,
        anchor: t.topQuery,
        reason: `${h.path === "/" ? "Domovská stránka" : h.path} má autoritu; ${t.path} má ${t.impressions} impresií na pozícii ${t.position.toFixed(1)} — odkaz posilní relevanciu pre „${t.topQuery}“.`,
        priority: t.score >= 60 ? "vysoká" : t.score >= 40 ? "stredná" : "nízka",
      });
    }
    if (contact && t.pageType === "pricing_landing")
      out.push({ source: t.path, target: contact.path, anchor: "nezáväzná cenová ponuka", reason: "Konverzná cesta z cenníka na kontakt.", priority: "stredná" });
  }
  // Never link the same anchor to two different targets.
  const seen = new Set<string>();
  return out.filter((l) => {
    const k = l.source + "|" + norm(l.anchor);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

// ---------- Semantic coverage ----------

export type Coverage = "MISSING" | "WEAK" | "GOOD" | "OVER-OPTIMIZED";
export type CoverageGroup =
  | "PRIMARY QUERY"
  | "SECONDARY QUERIES"
  | "SERVICE ENTITIES"
  | "LOCATION ENTITIES"
  | "COMMERCIAL TERMS"
  | "FAQ / QUESTION INTENT"
  | "TRUST ELEMENTS"
  | "CONVERSION ELEMENTS";

export type CoverageItem = { group: CoverageGroup; term: string; status: Coverage; count: number; note?: string };

/** Token-level semantic match: a term counts as present when all its significant stems appear near each other. */
export function termOccurrences(text: string, term: string): number {
  const t = norm(text);
  const stems = norm(term).split(" ").filter((w) => w.length > 2).map((w) => w.slice(0, Math.max(4, w.length - 2)));
  if (stems.length === 0) return 0;
  const sentences = t.split(/(?<=[a-z0-9]) (?=[a-z0-9])/).length ? text.split(/[.!?\n]+/).map(norm) : [t];
  let n = 0;
  for (const s of sentences) if (stems.every((st) => s.includes(st))) n++;
  return n;
}

export function coverageStatus(count: number, words: number, isPrimary: boolean): Coverage {
  if (count === 0) return "MISSING";
  const per1000 = words > 0 ? (count / words) * 1000 : count;
  if (per1000 > (isPrimary ? 12 : 8) && count > 4) return "OVER-OPTIMIZED";
  if (count === 1 && isPrimary) return "WEAK";
  return "GOOD";
}

export function buildCoverage(text: string, groups: Partial<Record<CoverageGroup, string[]>>): CoverageItem[] {
  const words = norm(text).split(" ").filter(Boolean).length;
  const out: CoverageItem[] = [];
  for (const [group, terms] of Object.entries(groups) as [CoverageGroup, string[]][]) {
    for (const term of terms ?? []) {
      const count = termOccurrences(text, term);
      const status = coverageStatus(count, words, group === "PRIMARY QUERY");
      out.push({ group, term, status, count, note: status === "OVER-OPTIMIZED" ? "Neprirodzené opakovanie — riziko keyword stuffingu." : undefined });
    }
  }
  return out;
}

export const VIANDMO_SEED: string[] = [
  "sťahovanie nábytku Bratislava",
  "cenník sťahovania Bratislava",
  "sťahovanie Bratislava cenník",
  "lacné sťahovanie Bratislava",
  "sťahovacia služba Bratislava",
  "sťahovanie bytov Bratislava",
  "vypratávanie a odvoz nábytku Bratislava",
  "demontáž nábytku pri sťahovaní",
  "montáž nábytku pri sťahovaní",
  "sťahovanie ťažkých bremien Bratislava",
  "sťahovanie kancelárií Bratislava",
];

export function defaultCoverageGroups(primary: string, secondary: string[]): Partial<Record<CoverageGroup, string[]>> {
  return {
    "PRIMARY QUERY": [primary],
    "SECONDARY QUERIES": secondary.filter((s) => norm(s) !== norm(primary)).slice(0, 6),
    "SERVICE ENTITIES": ["sťahovanie bytu", "sťahovanie nábytku", "sťahovanie kancelárie", "demontáž a montáž nábytku", "balenie"],
    "LOCATION ENTITIES": ["Bratislava", "okolie Bratislavy"],
    "COMMERCIAL TERMS": ["cena", "cenová ponuka", "od čoho závisí cena"],
    "FAQ / QUESTION INTENT": ["koľko stojí sťahovanie", "ako prebieha sťahovanie"],
    "TRUST ELEMENTS": ["poistenie", "skúsenosti", "kontakt"],
    "CONVERSION ELEMENTS": ["zavolajte", "nezáväzná ponuka", "formulár"],
  };
}

// ---------- SERP truncation ----------

// Approximate Arial 20px (desktop title) glyph widths, px.
const WIDE = /[mwMWOQGDHNU@%]/;
const NARROW = /[ijlftrI!.,:;'|]/;
export function textPixelWidth(s: string, base = 10): number {
  let w = 0;
  for (const ch of s) w += ch === " " ? base * 0.5 : WIDE.test(ch) ? base * 1.45 : NARROW.test(ch) ? base * 0.5 : /[A-ZÁČĎÉÍĽĹŇÓÔŔŠŤÚÝŽ]/.test(ch) ? base * 1.2 : base;
  return w;
}

export const SERP_LIMITS = { desktopTitle: 600, mobileTitle: 520, desktopDesc: 920, mobileDesc: 680 };

export function truncateToWidth(s: string, maxPx: number, base = 10): { text: string; truncated: boolean } {
  if (textPixelWidth(s, base) <= maxPx) return { text: s, truncated: false };
  let out = "";
  for (const ch of s) {
    if (textPixelWidth(out + ch + "…", base) > maxPx) break;
    out += ch;
  }
  return { text: out.trimEnd() + " …", truncated: true };
}

export function titleWarnings(title: string, opts: { primary: string; brand?: string; others?: string[] }): string[] {
  const w: string[] = [];
  const t = norm(title);
  if (textPixelWidth(title, 10) > SERP_LIMITS.desktopTitle) w.push("Title je príliš dlhý — Google ho skráti.");
  if (title.trim().split(/\s+/).length < 3) w.push("Title je príliš generický.");
  if (!/bratislav/.test(t)) w.push("Chýba lokalita (Bratislava).");
  const intentWords = ["cennik", "cena", "stahovanie", "sluzba", "ponuka", "kolko"];
  if (!intentWords.some((k) => t.includes(k))) w.push("Title nevyjadruje zámer dopytu.");
  const stems = norm(opts.primary).split(" ").filter((x) => x.length > 3).map((x) => x.slice(0, 5));
  for (const s of stems) {
    const n = t.split(s).length - 1;
    if (n >= 3) { w.push("Keyword stuffing — slovo sa opakuje príliš často."); break; }
  }
  if (opts.brand && t.startsWith(norm(opts.brand)) && textPixelWidth(title) > 450) w.push("Značka na začiatku zaberá cenné miesto.");
  if (opts.others?.some((o) => norm(o) === t)) w.push("Duplicitný title s inou stránkou.");
  return w;
}

// ---------- Structured data (no fabrication) ----------

export type BusinessFacts = {
  name?: string;
  url?: string;
  phone?: string;
  email?: string;
  street?: string;
  city?: string;
  postalCode?: string;
  areaServed?: string[];
  description?: string;
  sameAs?: string[];
};

/** Builds JSON-LD using ONLY provided facts. Missing fields are listed as NEEDS HUMAN INPUT. */
export function buildLocalBusinessJsonLd(f: BusinessFacts, service?: { name: string; url: string }) {
  const missing: string[] = [];
  const req = (k: keyof BusinessFacts, label: string) => {
    const v = f[k];
    if (v === undefined || v === "" || (Array.isArray(v) && v.length === 0)) missing.push(label);
  };
  req("name", "názov firmy");
  req("url", "web");
  req("phone", "telefón");
  req("areaServed", "obsluhované oblasti");
  req("street", "adresa (ulica)");

  const biz: Record<string, unknown> = { "@type": "MovingCompany", "@id": (f.url ?? "") + "#business" };
  if (f.name) biz.name = f.name;
  if (f.url) biz.url = f.url;
  if (f.phone) biz.telephone = f.phone;
  if (f.email) biz.email = f.email;
  if (f.description) biz.description = f.description;
  if (f.areaServed?.length) biz.areaServed = f.areaServed.map((a) => ({ "@type": "City", name: a }));
  if (f.street && f.city)
    biz.address = { "@type": "PostalAddress", streetAddress: f.street, addressLocality: f.city, ...(f.postalCode ? { postalCode: f.postalCode } : {}), addressCountry: "SK" };
  if (f.sameAs?.length) biz.sameAs = f.sameAs;

  const graph: Record<string, unknown>[] = [biz];
  if (service && f.url) {
    graph.push({ "@type": "Service", name: service.name, url: service.url, provider: { "@id": f.url + "#business" }, ...(f.areaServed?.length ? { areaServed: f.areaServed } : {}) });
    const crumbs = pathOf(service.url).split("/").filter(Boolean);
    graph.push({
      "@type": "BreadcrumbList",
      itemListElement: [{ "@type": "ListItem", position: 1, name: "Domov", item: f.url }, ...crumbs.map((c, i) => ({ "@type": "ListItem", position: i + 2, name: c.replace(/-/g, " "), item: service.url }))],
    });
  }
  return { jsonLd: { "@context": "https://schema.org", "@graph": graph }, missing };
}

export function validateJsonLd(obj: unknown): string[] {
  const errs: string[] = [];
  const forbidden = ["aggregateRating", "review", "priceRange", "openingHours", "openingHoursSpecification"];
  const walk = (o: unknown) => {
    if (Array.isArray(o)) return o.forEach(walk);
    if (o && typeof o === "object") {
      for (const [k, v] of Object.entries(o)) {
        if (forbidden.includes(k)) errs.push(`Pole „${k}“ nesmie byť bez overených údajov.`);
        walk(v);
      }
    }
  };
  walk(obj);
  const g = (obj as { "@graph"?: Record<string, unknown>[] })?.["@graph"];
  if (!g) errs.push("Chýba @graph.");
  else for (const n of g) if (!n["@type"]) errs.push("Uzol bez @type.");
  return errs;
}

// ---------- Experiments ----------

export type Verdict = "IMPROVED AFTER CHANGE" | "DECLINED AFTER CHANGE" | "INSUFFICIENT DATA" | "NO CLEAR CHANGE";

export function experimentVerdict(
  baseline: { clicks: number; impressions: number; position: number },
  after: { clicks: number; impressions: number; position: number },
  daysElapsed: number,
): Verdict {
  if (daysElapsed < 7 || after.impressions < 20) return "INSUFFICIENT DATA";
  const cb = ctr(baseline.clicks, baseline.impressions);
  const ca = ctr(after.clicks, after.impressions);
  const posBetter = baseline.position > 0 && after.position < baseline.position - 1;
  const posWorse = baseline.position > 0 && after.position > baseline.position + 1;
  const clicksUp = after.clicks > baseline.clicks * 1.15 && after.clicks - baseline.clicks >= 2;
  const clicksDown = after.clicks < baseline.clicks * 0.85 && baseline.clicks - after.clicks >= 2;
  if ((clicksUp || posBetter || ca > cb * 1.2) && !clicksDown) return "IMPROVED AFTER CHANGE";
  if (clicksDown || posWorse) return "DECLINED AFTER CHANGE";
  return "NO CLEAR CHANGE";
}
