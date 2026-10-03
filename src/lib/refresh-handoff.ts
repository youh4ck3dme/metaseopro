// Client-safe helper: hands a decaying/low-performing page from Decay Radar or
// Dashboard over to the Blog Writer as a pre-filled refresh brief.
import type { ScoredDecayRow } from "./decay-schema";

export const REFRESH_KEY = "pismo:refresh-context";

export function buildRefreshBrief(siteUrl: string, row: ScoredDecayRow): string {
  const queries = [...row.topQueries].sort((a, b) => b.clicksPrev - a.clicksPrev);
  const primary = queries[0]?.query ?? row.title;
  const lines = queries
    .map(
      (q) =>
        `- "${q.query}": kliky ${q.clicksPrev} → ${q.clicksNow}, pozícia ${q.positionPrev.toFixed(1)} → ${q.positionNow.toFixed(1)}`,
    )
    .join("\n");
  return [
    `Napíš kompletne AKTUALIZOVANÝ SEO článok v slovenčine, ktorý nahradí existujúcu stránku a vráti jej organickú návštevnosť.`,
    ``,
    `Web: ${siteUrl}`,
    `Existujúca URL: ${row.url}`,
    row.title ? `Aktuálny názov: ${row.title}` : "",
    `Primárny dopyt: ${primary}`,
    `Výkon (posledných 90 dní vs. predošlých 90): kliky ${row.clicksPrev} → ${row.clicksNow} (${row.clicksDeltaPct}%), impresie ${row.impressionsPrev} → ${row.impressionsNow}, pozícia ${row.positionPrev.toFixed(1)} → ${row.positionNow.toFixed(1)}.`,
    ``,
    `Dopyty z Google Search Console:`,
    lines || "- (žiadne)",
    ``,
    `Požiadavky: zachovaj tému a URL, aktualizuj na aktuálny rok, pokry rastúce long-tail dopyty ako samostatné H2 sekcie, pridaj FAQ, interné odkazy na služby/cenník a jasné CTA. Navrhni nový title (max 60 znakov) a meta popis (max 155 znakov).`,
  ]
    .filter((l) => l !== "")
    .join("\n");
}

export function handoffToWriter(siteUrl: string, row: ScoredDecayRow) {
  sessionStorage.setItem(
    REFRESH_KEY,
    JSON.stringify({
      brief: buildRefreshBrief(siteUrl, row),
      keyword: [...row.topQueries].sort((a, b) => b.clicksPrev - a.clicksPrev)[0]?.query ?? "",
      label: row.url.replace(/^https?:\/\/[^/]+/, "") || "/",
    }),
  );
}
