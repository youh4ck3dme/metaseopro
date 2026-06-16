// Server-only decay computation: fetch current vs previous GSC periods,
// join by page, compute metrics, classify decay type, score priority.
import {
  searchAnalytics,
  type GscStatus,
  type SearchAnalyticsRow,
} from "@/lib/gsc.server";
import type {
  DecayAnalysisResult,
  DecayRow,
  DecayType,
  Priority,
  QueryStat,
  RecommendedAction,
} from "@/lib/decay-schema";

const TOP_QUERY_URLS = 20;

type Metrics = { clicks: number; impressions: number; position: number };

type RowBase = Omit<
  DecayRow,
  "decay_type" | "priority" | "priority_score" | "recommended_action"
>;

// Shared classifier used by both live analysis and demo data.
export function classifyAndScore(r: RowBase): {
  decay_type: DecayType;
  priority: Priority;
  priority_score: number;
  recommended_action: RecommendedAction;
} {
  const clicksDropPct = r.clicks_delta_percent; // negative = drop
  const imprDropPct = r.impressions_delta_percent;
  const ctrDropped = r.ctr_delta < 0;
  const positionWorse = r.position_delta > 0.5; // higher position number = worse
  const lowCtr = r.current_ctr < 0.02;
  const midPosition = r.current_position >= 4 && r.current_position <= 20;

  let decay_type: DecayType;
  if (
    imprDropPct > -10 &&
    r.clicks_delta < 0 &&
    ctrDropped &&
    clicksDropPct <= -15
  ) {
    decay_type = "CTR Drop";
  } else if (imprDropPct <= -25) {
    decay_type = "Impression Drop";
  } else if (positionWorse && clicksDropPct <= -10) {
    decay_type = "Ranking Drop";
  } else if (clicksDropPct <= -25) {
    decay_type = "Traffic Drop";
  } else if (r.current_impressions >= 1000 && lowCtr && midPosition) {
    decay_type = "Hidden Opportunity";
  } else if (clicksDropPct < 0) {
    decay_type = "Traffic Drop";
  } else {
    decay_type = "Hidden Opportunity";
  }

  // Priority
  let priority: Priority = "low";
  if (
    r.previous_clicks >= 20 &&
    clicksDropPct <= -25 &&
    r.current_impressions >= 100
  ) {
    priority = "high";
  } else if (r.current_impressions >= 500 && lowCtr && midPosition) {
    priority = "medium";
  } else if (clicksDropPct <= -15 && r.current_impressions >= 100) {
    priority = "medium";
  }

  // Score: weight lost clicks + demand
  const lostClicks = Math.max(0, -r.clicks_delta);
  const demand = Math.log10(r.current_impressions + 10);
  const priority_score = Math.round(lostClicks * demand * 10) / 10;

  // Recommended action heuristic
  let recommended_action: RecommendedAction;
  if (decay_type === "CTR Drop") recommended_action = "improve_meta";
  else if (decay_type === "Ranking Drop") recommended_action = "refresh";
  else if (decay_type === "Hidden Opportunity") recommended_action = "improve_meta";
  else if (decay_type === "Impression Drop") {
    recommended_action =
      r.current_impressions < 100 ? "merge" : "expand";
  } else if (decay_type === "Traffic Drop") {
    recommended_action =
      r.current_clicks < 5 && r.current_impressions < 100
        ? "redirect"
        : "refresh";
  } else recommended_action = "internal_links";

  if (
    r.current_clicks < 3 &&
    r.current_impressions < 50 &&
    clicksDropPct > -10
  ) {
    recommended_action = "leave_alone";
  }

  return { decay_type, priority, priority_score, recommended_action };
}

function toMap(rows: SearchAnalyticsRow[]): Map<string, Metrics> {
  const m = new Map<string, Metrics>();
  for (const row of rows) {
    const key = row.keys[0];
    if (!key) continue;
    m.set(key, {
      clicks: row.clicks,
      impressions: row.impressions,
      position: row.position,
    });
  }
  return m;
}

function periods(window: "28" | "90") {
  const days = window === "90" ? 90 : 28;
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  const curEnd = new Date();
  curEnd.setDate(curEnd.getDate() - 3); // GSC data lags ~2-3 days
  const curStart = new Date(curEnd);
  curStart.setDate(curStart.getDate() - (days - 1));
  const prevEnd = new Date(curStart);
  prevEnd.setDate(prevEnd.getDate() - 1);
  const prevStart = new Date(prevEnd);
  prevStart.setDate(prevStart.getDate() - (days - 1));
  return {
    current: { start: fmt(curStart), end: fmt(curEnd) },
    previous: { start: fmt(prevStart), end: fmt(prevEnd) },
  };
}

export async function runLiveAnalysis(opts: {
  property: string;
  window: "28" | "90";
  minImpressions: number;
  urlContains: string;
  includeQueryLevel: boolean;
}): Promise<
  | { ok: true; result: DecayAnalysisResult }
  | { ok: false; status: GscStatus; message: string }
> {
  const { property, window, minImpressions, urlContains, includeQueryLevel } =
    opts;
  const p = periods(window);

  const filter = urlContains
    ? [
        {
          filters: [
            {
              dimension: "page",
              operator: "contains",
              expression: urlContains,
            },
          ],
        },
      ]
    : undefined;

  const [cur, prev] = await Promise.all([
    searchAnalytics({
      siteUrl: property,
      startDate: p.current.start,
      endDate: p.current.end,
      dimensions: ["page"],
      rowLimit: 25000,
      aggregationType: "byPage",
      dimensionFilterGroups: filter,
    }),
    searchAnalytics({
      siteUrl: property,
      startDate: p.previous.start,
      endDate: p.previous.end,
      dimensions: ["page"],
      rowLimit: 25000,
      aggregationType: "byPage",
      dimensionFilterGroups: filter,
    }),
  ]);

  if (!cur.ok) return cur;
  if (!prev.ok) return prev;

  const curMap = toMap(cur.rows);
  const prevMap = toMap(prev.rows);
  const urls = new Set([...curMap.keys(), ...prevMap.keys()]);

  const rowsBase: RowBase[] = [];
  for (const url of urls) {
    const c = curMap.get(url) ?? { clicks: 0, impressions: 0, position: 0 };
    const pr = prevMap.get(url) ?? { clicks: 0, impressions: 0, position: 0 };
    if (Math.max(c.impressions, pr.impressions) < minImpressions) continue;

    const current_ctr = c.impressions ? c.clicks / c.impressions : 0;
    const previous_ctr = pr.impressions ? pr.clicks / pr.impressions : 0;

    rowsBase.push({
      url,
      current_clicks: c.clicks,
      previous_clicks: pr.clicks,
      clicks_delta: c.clicks - pr.clicks,
      clicks_delta_percent: pr.clicks
        ? ((c.clicks - pr.clicks) / pr.clicks) * 100
        : c.clicks > 0
          ? 100
          : 0,
      current_impressions: c.impressions,
      previous_impressions: pr.impressions,
      impressions_delta: c.impressions - pr.impressions,
      impressions_delta_percent: pr.impressions
        ? ((c.impressions - pr.impressions) / pr.impressions) * 100
        : 0,
      current_ctr,
      previous_ctr,
      ctr_delta: current_ctr - previous_ctr,
      current_position: c.position,
      previous_position: pr.position,
      position_delta: c.position - pr.position,
      top_lost_queries: [],
      top_opportunity_queries: [],
    });
  }

  let rows: DecayRow[] = rowsBase.map((b) => ({
    ...b,
    ...classifyAndScore(b),
  }));
  rows.sort((a, b) => b.priority_score - a.priority_score);

  // Query-level enrichment for the top decayed URLs.
  if (includeQueryLevel) {
    const targets = rows
      .filter((r) => r.clicks_delta < 0 || r.decay_type === "Hidden Opportunity")
      .slice(0, TOP_QUERY_URLS);
    await Promise.all(
      targets.map(async (row) => {
        const pageFilter = [
          {
            filters: [
              { dimension: "page", operator: "equals", expression: row.url },
            ],
          },
        ];
        const [qc, qp] = await Promise.all([
          searchAnalytics({
            siteUrl: property,
            startDate: p.current.start,
            endDate: p.current.end,
            dimensions: ["query"],
            rowLimit: 100,
            dimensionFilterGroups: pageFilter,
          }),
          searchAnalytics({
            siteUrl: property,
            startDate: p.previous.start,
            endDate: p.previous.end,
            dimensions: ["query"],
            rowLimit: 100,
            dimensionFilterGroups: pageFilter,
          }),
        ]);
        if (!qc.ok || !qp.ok) return;
        const prevQ = new Map<string, Metrics>();
        for (const r of qp.rows)
          prevQ.set(r.keys[0], {
            clicks: r.clicks,
            impressions: r.impressions,
            position: r.position,
          });
        const stats: QueryStat[] = qc.rows.map((r) => {
          const prevC = prevQ.get(r.keys[0])?.clicks ?? 0;
          return {
            query: r.keys[0],
            current_clicks: r.clicks,
            previous_clicks: prevC,
            clicks_delta: r.clicks - prevC,
            current_impressions: r.impressions,
            current_position: r.position,
          };
        });
        row.top_lost_queries = [...stats]
          .filter((s) => s.clicks_delta < 0)
          .sort((a, b) => a.clicks_delta - b.clicks_delta)
          .slice(0, 8);
        row.top_opportunity_queries = [...stats]
          .filter((s) => s.current_position >= 4 && s.current_position <= 20)
          .sort((a, b) => b.current_impressions - a.current_impressions)
          .slice(0, 5);
      }),
    );
  }

  const decayed = rows.filter(
    (r) => r.clicks_delta < 0 || r.decay_type === "Hidden Opportunity",
  );
  const estimated_lost_clicks = rows.reduce(
    (sum, r) => sum + Math.max(0, -r.clicks_delta),
    0,
  );
  const opp = [...rows].sort(
    (a, b) => b.current_impressions - a.current_impressions,
  )[0];

  return {
    ok: true,
    result: {
      mode: "live",
      property,
      window,
      current_period: p.current,
      previous_period: p.previous,
      summary: {
        pages_analyzed: rows.length,
        pages_with_decay: decayed.length,
        estimated_lost_clicks,
        highest_opportunity_url: opp?.url ?? null,
        critical_decay_count: rows.filter((r) => r.priority === "high").length,
      },
      rows,
    },
  };
}
