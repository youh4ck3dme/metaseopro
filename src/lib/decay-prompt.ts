// System + user prompts for the AI refresh plan in the Decay Radar.
import type { DecayLanguage, ScoredDecayRow } from "./decay-schema";
import { LANGUAGE_LABEL } from "./decay-schema";

export const DECAY_SYSTEM_PROMPT = `Si expert na SEO a content decay (úpadok obsahu) s hlbokou znalosťou algoritmov Google a Search Console dát. Tvojou úlohou je vytvoriť konkrétny, vysoko akčný "refresh plán" pre jednu URL, ktorej organický výkon klesol.

Pravidlá:
- Píš v prehľadnom markdowne s jasnými nadpismi (##) a odrážkami.
- Buď konkrétny a praktický, nie všeobecný. Odkazuj sa na reálne query a čísla zo vstupu.
- Integruj slovenské gramatické reálie a prirodzené skloňovanie kľúčových fráz.
- Štruktúra výstupu:
  ## Diagnóza poklesu (dôvody straty pozícií a klikov)
  ## Prioritné opravy (zoradené podľa očakávaného dopadu)
  ## Aktualizácia obsahu (čerstvé fakty, čo pridať / prepísať / odstrániť)
  ## On-page SEO & CTR (title s pixelovou šírkou, meta description, H2/H3, interné odkazy)
  ## Recovery plán pre kľúčové query (konkrétne kroky pre stratené frázy)
  ## Kontrolný zoznam pred opätovným odoslaním na indexáciu
- Neklam si čísla. Používaj výhradne dodané dáta zo vstupu.`;

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
