// Server-only helpers: fetch + parse a web page, compare own vs competitor.
// .server.ts suffix blocks this from client bundles.
import type {
  PageAnalysis,
  ComparisonResult,
  RaketaAnalysis,
} from "@/lib/raketa-schema";
import { normalizeUrl } from "@/lib/raketa-schema";

const FETCH_TIMEOUT_MS = 12_000;
const MAX_BYTES = 1_500_000; // ~1.5MB cap on downloaded HTML

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}

function stripTags(html: string): string {
  return decodeEntities(
    html
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim(),
  );
}

function matchAll(html: string, re: RegExp): string[] {
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const text = stripTags(m[1] ?? "");
    if (text) out.push(text);
  }
  return out;
}

function extractMeta(html: string, name: string): string {
  const re = new RegExp(
    `<meta[^>]+(?:name|property)=["']${name}["'][^>]*content=["']([^"']*)["']`,
    "i",
  );
  const m = re.exec(html);
  if (m) return decodeEntities(m[1].trim());
  // try reversed attribute order
  const re2 = new RegExp(
    `<meta[^>]+content=["']([^"']*)["'][^>]*(?:name|property)=["']${name}["']`,
    "i",
  );
  const m2 = re2.exec(html);
  return m2 ? decodeEntities(m2[1].trim()) : "";
}

const CTA_KEYWORDS = [
  "kontakt",
  "objednať",
  "objednaj",
  "kúpiť",
  "kúp",
  "cenník",
  "cena",
  "demo",
  "zadarmo",
  "vyskúšať",
  "vyskúšaj",
  "registrácia",
  "registrovať",
  "prihlásiť",
  "zistiť viac",
  "viac info",
  "začať",
  "získať",
  "stiahnuť",
  "contact",
  "buy",
  "get started",
  "sign up",
  "try",
  "free",
  "subscribe",
  "book",
  "demo",
  "learn more",
  "download",
];

function extractCtas(html: string): string[] {
  const candidates = [
    ...matchAll(html, /<a\b[^>]*>([\s\S]*?)<\/a>/gi),
    ...matchAll(html, /<button\b[^>]*>([\s\S]*?)<\/button>/gi),
  ];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const c of candidates) {
    const text = c.slice(0, 60);
    const low = text.toLowerCase();
    if (text.length < 2 || text.length > 60) continue;
    if (!CTA_KEYWORDS.some((k) => low.includes(k))) continue;
    if (seen.has(low)) continue;
    seen.add(low);
    out.push(text);
    if (out.length >= 8) break;
  }
  return out;
}

function bodyText(html: string): string {
  const noScript = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ");
  const bodyMatch = /<body\b[^>]*>([\s\S]*?)<\/body>/i.exec(noScript);
  return stripTags(bodyMatch ? bodyMatch[1] : noScript);
}

function mockAnalysis(url: string, note: string): PageAnalysis {
  return {
    url,
    ok: false,
    estimated: true,
    title: "",
    metaDescription: "",
    h1: [],
    h2: [],
    h3: [],
    ctas: [],
    wordCount: 0,
    textSummary: "",
    note,
  };
}

export async function analyzePage(rawUrl: string): Promise<PageAnalysis> {
  const url = normalizeUrl(rawUrl);
  if (!url) return mockAnalysis(rawUrl, "Neplatná URL.");

  let html = "";
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; SEO4WEBBot/1.0)",
        Accept: "text/html,application/xhtml+xml",
      },
    });
    clearTimeout(timer);
    if (!res.ok) {
      return mockAnalysis(url, `Stránka vrátila stav ${res.status}.`);
    }
    const ct = res.headers.get("content-type") ?? "";
    if (ct && !ct.includes("html")) {
      return mockAnalysis(url, "Obsah nie je HTML stránka.");
    }
    const reader = res.body?.getReader();
    if (!reader) {
      html = await res.text();
    } else {
      const decoder = new TextDecoder();
      let received = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        received += value.byteLength;
        html += decoder.decode(value, { stream: true });
        if (received > MAX_BYTES) {
          reader.cancel();
          break;
        }
      }
    }
  } catch {
    return mockAnalysis(url, "Web sa nepodarilo načítať (timeout alebo blokovanie).");
  }

  const titleMatch = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  const title = titleMatch ? decodeEntities(stripTags(titleMatch[1])) : "";
  const metaDescription =
    extractMeta(html, "description") || extractMeta(html, "og:description");
  const h1 = matchAll(html, /<h1\b[^>]*>([\s\S]*?)<\/h1>/gi).slice(0, 5);
  const h2 = matchAll(html, /<h2\b[^>]*>([\s\S]*?)<\/h2>/gi).slice(0, 15);
  const h3 = matchAll(html, /<h3\b[^>]*>([\s\S]*?)<\/h3>/gi).slice(0, 20);
  const ctas = extractCtas(html);
  const text = bodyText(html);
  const wordCount = text ? text.split(/\s+/).length : 0;
  const textSummary = text.slice(0, 1800);

  // Thin / JS-heavy page → mark as estimated but keep whatever we got.
  const thin = wordCount < 60 && h1.length === 0 && h2.length === 0;

  return {
    url,
    ok: !thin,
    estimated: thin,
    title,
    metaDescription,
    h1,
    h2,
    h3,
    ctas,
    wordCount,
    textSummary,
    note: thin
      ? "Stránka vrátila málo obsahu (pravdepodobne JS-heavy web). Výsledky sú odhad."
      : undefined,
  };
}

function compare(
  own: PageAnalysis,
  competitor: PageAnalysis | null,
  keyword: string,
): ComparisonResult {
  const metaIssues: string[] = [];
  const ctaIssues: string[] = [];
  const weakHeadings: string[] = [];
  const missingKeywords: string[] = [];
  const contentGaps: string[] = [];

  const kw = keyword.trim().toLowerCase();

  // Meta checks
  if (!own.metaDescription) {
    metaIssues.push("Chýba meta description na tvojom webe.");
  } else {
    const len = own.metaDescription.length;
    if (len < 70) metaIssues.push("Meta description je príliš krátka (<70 znakov).");
    if (len > 160) metaIssues.push("Meta description je príliš dlhá (>160 znakov).");
    if (kw && !own.metaDescription.toLowerCase().includes(kw)) {
      metaIssues.push("Meta description neobsahuje cieľový keyword.");
    }
  }
  if (!own.title) metaIssues.push("Chýba title tag.");
  else if (kw && !own.title.toLowerCase().includes(kw)) {
    metaIssues.push("Title neobsahuje cieľový keyword.");
  }

  // Headings
  if (own.h1.length === 0) weakHeadings.push("Chýba H1 nadpis.");
  else if (own.h1.length > 1) weakHeadings.push("Viac ako jeden H1 nadpis.");
  if (own.h2.length < 3)
    weakHeadings.push("Málo H2 nadpisov — slabá štruktúra obsahu.");
  if (kw && ![...own.h1, ...own.h2].some((h) => h.toLowerCase().includes(kw))) {
    weakHeadings.push("Cieľový keyword sa nenachádza v nadpisoch.");
  }

  // CTA
  if (own.ctas.length === 0)
    ctaIssues.push("Nenašli sa jasné call-to-action prvky.");

  // Keyword in content
  if (kw && own.textSummary && !own.textSummary.toLowerCase().includes(kw)) {
    missingKeywords.push(`Cieľový keyword „${keyword}" nie je výrazný v texte.`);
  }

  // Competitor comparison
  if (competitor && competitor.ok) {
    if (competitor.wordCount > own.wordCount * 1.3) {
      contentGaps.push(
        `Konkurencia má výrazne viac obsahu (~${competitor.wordCount} vs ~${own.wordCount} slov).`,
      );
    }
    const ownH = new Set([...own.h2, ...own.h3].map((h) => h.toLowerCase()));
    const compTopics = [...competitor.h2, ...competitor.h3]
      .filter((h) => !ownH.has(h.toLowerCase()))
      .slice(0, 10);
    for (const t of compTopics) contentGaps.push(`Konkurencia pokrýva: „${t}"`);
    if (competitor.metaDescription && !own.metaDescription) {
      metaIssues.push("Konkurencia má meta description, ty nie.");
    }
    if (competitor.ctas.length > own.ctas.length) {
      ctaIssues.push("Konkurencia má viac CTA prvkov.");
    }
  }

  return { contentGaps, missingKeywords, weakHeadings, metaIssues, ctaIssues };
}

export async function runAnalysis(
  ownUrl: string,
  competitorUrl: string,
  keyword: string,
): Promise<RaketaAnalysis> {
  const [own, competitor] = await Promise.all([
    analyzePage(ownUrl),
    competitorUrl ? analyzePage(competitorUrl) : Promise.resolve(null),
  ]);
  const comparison = compare(own, competitor, keyword);
  return { own, competitor, comparison };
}
