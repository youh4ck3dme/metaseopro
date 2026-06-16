// Prompt builder for the Content Decay Radar AI refresh plan.
import {
  ACTION_LABEL,
  DECAY_TYPE_LABEL,
  LANGUAGE_LABEL,
  type DecayLanguage,
  type DecayRow,
  type DecayMode,
} from "@/lib/decay-schema";

export const DECAY_SYSTEM_PROMPT = `Si senior SEO konzultant a content stratég špecializovaný na obnovu (refresh) upadajúceho obsahu. Pracuješ s reálnymi dátami z Google Search Console (kliky, impresie, CTR, priemerná pozícia) a navrhuješ praktický, konkrétny plán obnovy jednej konkrétnej URL.

PRAVIDLÁ (dodržuj striktne):
- Nesľubuj návrat rankingu ani konkrétne pozície. Hovor o pravdepodobnostiach.
- Nevymýšľaj search volume, čísla návštevnosti ani zdroje.
- Pri akomkoľvek odhade jasne napíš slovo "odhad" a uveď neistotu.
- Nefabrikuj presné čísla obnovy trafficu.
- Vychádzaj len z dodaných GSC metrík a queries. Ak dáta chýbajú, povedz to.
- Píš v jazyku, ktorý ti zadám. Tón: konkrétny, praktický, profesionálny, mierne sebavedomý.
- Výstup vždy ako čistý Markdown s nadpismi (##).

Štruktúra výstupu (presne tieto sekcie ako ## nadpisy):
## Diagnóza
## Hlavná príčina poklesu
## Posun v search intente
## Nový meta title
## Nový meta description
## Nový H1
## Aktualizovaná osnova
## Chýbajúce H2/H3 sekcie
## FAQ / AEO otázky
## Návrhy interných odkazov
## Inštrukcie na prepis obsahu
## Rizikové tvrdenia na overenie
## Navrhované CTA
## Publikačný checklist
## Očakávaný dopad (odhad)`;

export function buildDecayUserPrompt(opts: {
  row: DecayRow;
  language: DecayLanguage;
  mode: DecayMode;
  property: string;
  window: "28" | "90";
}): string {
  const { row, language, mode, property, window } = opts;
  const pct = (n: number) => `${n >= 0 ? "+" : ""}${n.toFixed(1)}%`;
  const ctr = (n: number) => `${(n * 100).toFixed(2)} %`;

  const lostQ = row.top_lost_queries
    .map(
      (q) =>
        `- "${q.query}": kliky ${q.previous_clicks} → ${q.current_clicks} (${q.clicks_delta}), impresie ${q.current_impressions}, pozícia ${q.current_position.toFixed(1)}`,
    )
    .join("\n");
  const oppQ = row.top_opportunity_queries
    .map(
      (q) =>
        `- "${q.query}": impresie ${q.current_impressions}, pozícia ${q.current_position.toFixed(1)}, kliky ${q.current_clicks}`,
    )
    .join("\n");

  const demoNote =
    mode === "demo"
      ? `\nDÔLEŽITÉ: Toto sú DEMO (simulované) dáta, nie reálne GSC dáta. V sekcii Diagnóza to jasne uveď vetou: "Táto analýza je založená na demo dátach (nie reálne Google Search Console dáta)."\n`
      : "";

  return `Jazyk výstupu: ${LANGUAGE_LABEL[language]}
Property: ${property}
Porovnávacie okno: ${window} vs ${window} dní
${demoNote}
URL na obnovu: ${row.url}

GSC METRIKY (aktuálne obdobie vs predchádzajúce):
- Kliky: ${row.previous_clicks} → ${row.current_clicks} (${pct(row.clicks_delta_percent)})
- Impresie: ${row.previous_impressions} → ${row.current_impressions} (${pct(row.impressions_delta_percent)})
- CTR: ${ctr(row.previous_ctr)} → ${ctr(row.current_ctr)}
- Priemerná pozícia: ${row.previous_position.toFixed(1)} → ${row.current_position.toFixed(1)} (zmena ${row.position_delta.toFixed(1)})
- Typ poklesu: ${DECAY_TYPE_LABEL[row.decay_type]}
- Odporúčaná akcia (heuristika): ${ACTION_LABEL[row.recommended_action]}

NAJVIAC STRATENÉ QUERIES:
${lostQ || "- (žiadne výrazné straty na úrovni queries)"}

PRÍLEŽITOSTNÉ QUERIES (pozícia 4–20):
${oppQ || "- (žiadne)"}

Na základe týchto dát vytvor kompletný refresh plán pre túto jednu URL podľa zadanej štruktúry. Buď konkrétny – navrhni reálne formulácie title/meta/H1, konkrétne H2/H3 a interné odkazy relevantné k téme URL a queries.`;
}
