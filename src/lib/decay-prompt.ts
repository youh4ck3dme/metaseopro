// System + user prompts for the AI refresh plan in the Decay Radar.
import type { DecayLanguage, ScoredDecayRow } from "./decay-schema";
import { LANGUAGE_LABEL } from "./decay-schema";

export const DECAY_SYSTEM_PROMPT = `Si expert na SEO a content decay (úpadok obsahu). Tvojou úlohou je vytvoriť konkrétny, akčný "refresh plán" pre jednu URL, ktorej organický výkon v Google Search Console klesol.

Pravidlá:
- Píš v markdowne s jasnými nadpismi (##) a odrážkami.
- Buď konkrétny a praktický, nie všeobecný. Odkazuj sa na reálne query a čísla zo vstupu.
- Štruktúra výstupu:
  ## Diagnóza poklesu
  ## Prioritné opravy (zoradené podľa dopadu)
  ## Aktualizácia obsahu (čo pridať / prepísať / odstrániť)
  ## On-page SEO (title, meta description, nadpisy, interné odkazy)
  ## Recovery plán pre kľúčové query
  ## Kontrolný zoznam pred publikovaním
- Neklam si čísla. Používaj len dáta zo vstupu.`;

export function buildDecayUserPrompt(opts: {
  demo: boolean;
  language: DecayLanguage;
  siteUrl: string;
  row: ScoredDecayRow;
}): string {
  const { demo, language, siteUrl, row } = opts;
  const queries = row.topQueries
    .map(
      (q) =>
        `- "${q.query}": kliknutia ${q.clicksPrev} → ${q.clicksNow}, pozícia ${q.positionPrev.toFixed(
          1,
        )} → ${q.positionNow.toFixed(1)}`,
    )
    .join("\n");

  const demoNote = demo
    ? `\n\nDÔLEŽITÉ: Táto analýza je založená na DEMO dátach (nie na reálnych dátach z Google Search Console). V úvode výstupu to jednou vetou jasne uveď.`
    : "";

  return `Jazyk výstupu: ${LANGUAGE_LABEL[language]}.
Web: ${siteUrl}

Analyzovaná URL: ${row.url}
Titulok: ${row.title}
Kliknutia: ${row.clicksPrev} → ${row.clicksNow} (${row.clicksDeltaPct}%)
Zobrazenia: ${row.impressionsPrev} → ${row.impressionsNow}
Priemerná pozícia: ${row.positionPrev.toFixed(1)} → ${row.positionNow.toFixed(1)} (zmena ${row.positionDelta > 0 ? "+" : ""}${row.positionDelta.toFixed(1)})
Decay skóre: ${row.decayScore}/100

Top query pre túto URL:
${queries}

Vytvor kompletný refresh plán, ktorý pomôže obnoviť organický výkon tejto stránky.${demoNote}`;
}
