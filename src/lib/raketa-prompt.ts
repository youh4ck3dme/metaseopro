// Prompt builders for the SEO Raketa final output generator.
import {
  LANGUAGE_LABEL,
  OUTPUT_LABEL,
  type RaketaAnalysis,
  type RaketaLanguage,
  type RaketaOutput,
} from "@/lib/raketa-schema";

const LANG_INSTRUCTION: Record<RaketaLanguage, string> = {
  sk: "Píš výhradne v slovenčine.",
  cz: "Piš výhradně v češtině.",
  en: "Write exclusively in English.",
};

export const RAKETA_SYSTEM_PROMPT = `Si senior SEO stratég a copywriter pre stredoeurópsky trh (SK/CZ) a anglický trh.
Pracuješ s reálnymi dátami z analýzy webu (title, meta, nadpisy, text, CTA) a porovnaním s konkurenciou.
Vždy vraciaš čistý, dobre štruktúrovaný Markdown s jasnými ## nadpismi pre každú sekciu.
Buď konkrétny, akčný a opri sa o dodané dáta. Nevymýšľaj si čísla, ktoré nemáš.
Ak sú dáta označené ako odhad (estimated), jasne to spomeň v sekcii a pracuj opatrne.`;

const OUTPUT_INSTRUCTIONS: Record<RaketaOutput, string> = {
  audit: `Vytvor kompletný SEO audit. Povinné sekcie (## nadpisy):
## SEO skóre (0–100 s krátkym zdôvodnením)
## Priority fixes (zoradené podľa dopadu)
## Keyword príležitosti
## Výhody konkurencie
## Odporúčaná štruktúra stránky
## Meta title a meta description (návrh)
## H1/H2/H3 outline
## FAQ
## Návrhy interného prelinkovania
## 30-dňový content plán (tabuľka deň/téma/keyword/typ)`,
  competitor: `Vytvor konkurenčný report (vlastný web vs konkurencia). Povinné sekcie:
## Zhrnutie súboja
## Content gapy (čo má konkurencia a ty nie)
## Keyword príležitosti na predbehnutie
## Silné a slabé stránky oboch
## Akčný plán na predbehnutie konkurencie
## 30-dňový content plán (tabuľka)`,
  article: `Napíš kompletný long-form SEO blog článok (1500+ slov) na cieľový keyword.
Začni navrhnutým meta title a meta description, potom H1 a celý článok so štruktúrou H2/H3,
prirodzene zapracovaným keywordom, FAQ sekciou a CTA na konci.`,
  brief: `Vytvor profesionálny content brief. Povinné sekcie:
## Cieľ a publikum
## Primárny a sekundárne keywordy
## Meta title a meta description
## H1/H2/H3 outline (s odporúčaným počtom slov na sekciu)
## FAQ (otázky na pokrytie)
## Interné prelinkovanie
## Skip-list (čomu sa vyhnúť)`,
  calendar: `Vytvor 30-dňový content kalendár ako Markdown tabuľku s stĺpcami:
Deň | Téma / H1 | Primárny keyword | Typ obsahu | Funnel fáza | Distribučný kanál.
Po tabuľke pridaj sekciu ## Pilier a klastre a ## Týždenné KPI.`,
  landing: `Napíš kompletnú landing page copy zameranú na konverziu. Povinné sekcie:
## Hero (nadpis + podnadpis + CTA)
## Benefity (3–5)
## Ako to funguje
## Sociálny dôkaz (návrhy)
## Námietky a odpovede / FAQ
## Záverečné CTA
## Meta title a meta description`,
};

function pageBlock(label: string, p: NonNullable<RaketaAnalysis["own"]> | null) {
  if (!p) return `${label}: (nezadané)`;
  return [
    `${label} (${p.url})${p.estimated ? " [ODHAD — málo dát]" : ""}:`,
    `- Title: ${p.title || "(chýba)"}`,
    `- Meta description: ${p.metaDescription || "(chýba)"}`,
    `- H1: ${p.h1.join(" | ") || "(žiadne)"}`,
    `- H2: ${p.h2.slice(0, 12).join(" | ") || "(žiadne)"}`,
    `- H3: ${p.h3.slice(0, 12).join(" | ") || "(žiadne)"}`,
    `- CTA: ${p.ctas.join(" | ") || "(žiadne)"}`,
    `- Počet slov: ~${p.wordCount}`,
    `- Súhrn textu: ${p.textSummary.slice(0, 900) || "(prázdne)"}`,
  ].join("\n");
}

export function buildRaketaUserPrompt(args: {
  keyword: string;
  language: RaketaLanguage;
  output: RaketaOutput;
  analysis: RaketaAnalysis;
}): string {
  const { keyword, language, output, analysis } = args;
  const cmp = analysis.comparison;
  return [
    LANG_INSTRUCTION[language],
    `Jazyk výstupu: ${LANGUAGE_LABEL[language]}`,
    `Cieľový keyword / téma: ${keyword}`,
    `Typ výstupu: ${OUTPUT_LABEL[output]}`,
    "",
    pageBlock("VLASTNÝ WEB", analysis.own),
    "",
    pageBlock("KONKURENCIA", analysis.competitor),
    "",
    "AUTOMATICKÁ ANALÝZA (detekované problémy):",
    `- Content gapy: ${cmp.contentGaps.join("; ") || "žiadne"}`,
    `- Chýbajúce keywordy: ${cmp.missingKeywords.join("; ") || "žiadne"}`,
    `- Slabé nadpisy: ${cmp.weakHeadings.join("; ") || "žiadne"}`,
    `- Meta problémy: ${cmp.metaIssues.join("; ") || "žiadne"}`,
    `- CTA problémy: ${cmp.ctaIssues.join("; ") || "žiadne"}`,
    "",
    "ÚLOHA:",
    OUTPUT_INSTRUCTIONS[output],
  ].join("\n");
}
