// Server-only Decay Radar logic: scoring + dataset assembly.
// Demo mode reads from decay-demo.ts. Live GSC mode is a Phase-2 extension;
// until GSC is connected we always return demo data (clearly flagged).
import {
  DEMO_PERIOD_NOW,
  DEMO_PERIOD_PREV,
  DEMO_SCENARIOS,
} from "./decay-demo";
import {
  SCENARIO_LABEL,
  type DecayDataset,
  type DecayRow,
  type DecayScenario,
  type DecayStatus,
  type ScoredDecayRow,
} from "./decay-schema";

function scoreRow(row: DecayRow): ScoredDecayRow {
  const clicksDeltaPct =
    row.clicksPrev > 0
      ? Math.round(((row.clicksNow - row.clicksPrev) / row.clicksPrev) * 100)
      : 0;
  // Positive positionDelta = worse (higher number = lower rank).
  const positionDelta = Number((row.positionNow - row.positionPrev).toFixed(1));

  // Decay score: 0 (healthy) .. 100 (severe decay). Driven by click loss,
  // amplified by ranking loss. Growth clamps toward 0.
  const clickLoss = Math.max(0, -clicksDeltaPct); // % of clicks lost
  const rankPenalty = Math.max(0, positionDelta) * 4; // each lost position ~4 pts
  const decayScore = Math.max(0, Math.min(100, Math.round(clickLoss * 0.7 + rankPenalty)));

  let status: DecayStatus;
  if (clicksDeltaPct >= 5) status = "growing";
  else if (clicksDeltaPct > -10) status = "stable";
  else if (decayScore >= 55) status = "critical";
  else status = "declining";

  return { ...row, clicksDeltaPct, positionDelta, decayScore, status };
}

const STATUS_ORDER: Record<DecayStatus, number> = {
  critical: 0,
  declining: 1,
  stable: 2,
  growing: 3,
};

export function buildDemoDataset(scenario: DecayScenario): DecayDataset {
  const demo = DEMO_SCENARIOS[scenario];
  const rows = demo.rows
    .map(scoreRow)
    .sort((a, b) => {
      const s = STATUS_ORDER[a.status] - STATUS_ORDER[b.status];
      if (s !== 0) return s;
      return b.decayScore - a.decayScore;
    });

  return {
    demo: true,
    scenario,
    siteUrl: demo.siteUrl,
    scenarioLabel: SCENARIO_LABEL[scenario],
    periodPrev: DEMO_PERIOD_PREV,
    periodNow: DEMO_PERIOD_NOW,
    rows,
    note: "Táto analýza je založená na demo dátach. Pripoj Google Search Console pre reálnu analýzu.",
  };
}

/**
 * Live mode: real Google Search Console data for one verified property.
 * Demo and live data are never mixed — a live dataset always has demo: false.
 */
export async function buildLiveDataset(siteUrl: string): Promise<DecayDataset> {
  const verified = await assertVerifiedProperty(siteUrl);
  const rows = (await fetchLiveDecayRows(verified))
    .map(scoreRow)
    .sort((a, b) => {
      const s = STATUS_ORDER[a.status] - STATUS_ORDER[b.status];
      if (s !== 0) return s;
      return b.decayScore - a.decayScore;
    });

  return {
    demo: false,
    scenario: "blog",
    siteUrl: verified,
    scenarioLabel: verified,
    periodPrev: LIVE_PERIOD_PREV,
    periodNow: LIVE_PERIOD_NOW,
    rows,
    note:
      rows.length === 0
        ? "Google Search Console zatiaľ nevrátilo dosť dát pre porovnanie období."
        : "Reálne dáta z Google Search Console.",
  };
}

export async function runDecayAnalysis(
  scenario: DecayScenario,
): Promise<DecayDataset> {
  return buildDemoDataset(scenario);
}
