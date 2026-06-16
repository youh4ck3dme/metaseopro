// Demo datasets for Content Decay Radar. Clearly simulated, never mixed with
// live data. Produces the exact same shape as the live analyzer so the UI and
// AI plan behave identically.
import type {
  DecayAnalysisResult,
  DecayRow,
  DemoScenario,
  QueryStat,
} from "@/lib/decay-schema";
import { classifyAndScore } from "@/lib/decay-analyze.server";

type RawPage = {
  url: string;
  cur: { clicks: number; impressions: number; position: number };
  prev: { clicks: number; impressions: number; position: number };
  lost: QueryStat[];
  opp: QueryStat[];
};

function q(
  query: string,
  current_clicks: number,
  previous_clicks: number,
  current_impressions: number,
  current_position: number,
): QueryStat {
  return {
    query,
    current_clicks,
    previous_clicks,
    clicks_delta: current_clicks - previous_clicks,
    current_impressions,
    current_position,
  };
}

const SCENARIOS: Record<DemoScenario, RawPage[]> = {
  blog: [
    {
      url: "https://demo-blog.sk/ako-zacat-s-behom",
      cur: { clicks: 140, impressions: 5200, position: 6.8 },
      prev: { clicks: 420, impressions: 6100, position: 3.4 },
      lost: [
        q("ako začať behať", 60, 210, 2400, 7.1),
        q("beh pre začiatočníkov", 40, 120, 1500, 6.2),
        q("tréningový plán beh", 20, 60, 800, 8.0),
      ],
      opp: [q("beh chudnutie", 8, 6, 1200, 12.4)],
    },
    {
      url: "https://demo-blog.sk/recepty-zdrave-ranajky",
      cur: { clicks: 90, impressions: 8800, position: 9.2 },
      prev: { clicks: 110, impressions: 8600, position: 8.8 },
      lost: [q("zdravé raňajky", 30, 45, 3200, 9.5)],
      opp: [
        q("raňajky bez cukru", 5, 4, 2100, 11.0),
        q("proteínové raňajky recept", 6, 5, 1800, 13.2),
      ],
    },
    {
      url: "https://demo-blog.sk/najlepsie-knihy-2023",
      cur: { clicks: 25, impressions: 1900, position: 14.0 },
      prev: { clicks: 180, impressions: 4200, position: 5.1 },
      lost: [
        q("najlepšie knihy", 12, 90, 900, 14.8),
        q("knižné tipy", 6, 50, 600, 16.0),
      ],
      opp: [],
    },
    {
      url: "https://demo-blog.sk/domace-cvicenie",
      cur: { clicks: 60, impressions: 7400, position: 7.6 },
      prev: { clicks: 75, impressions: 5200, position: 8.9 },
      lost: [],
      opp: [
        q("cvičenie doma bez náradia", 20, 18, 2600, 7.2),
        q("ranná rozcvička", 8, 7, 1900, 9.1),
      ],
    },
  ],
  ecommerce: [
    {
      url: "https://demo-shop.sk/produkt/behecke-topanky-pro",
      cur: { clicks: 210, impressions: 9800, position: 5.2 },
      prev: { clicks: 520, impressions: 11200, position: 2.8 },
      lost: [
        q("bežecké topánky", 80, 240, 4200, 5.5),
        q("najlepšie bežecké tenisky", 50, 140, 2600, 4.9),
      ],
      opp: [q("bežecké topánky dámske", 14, 12, 3100, 8.4)],
    },
    {
      url: "https://demo-shop.sk/kategoria/zimne-bundy",
      cur: { clicks: 130, impressions: 14200, position: 8.9 },
      prev: { clicks: 150, impressions: 13800, position: 8.5 },
      lost: [q("zimné bundy", 40, 55, 5200, 9.1)],
      opp: [
        q("dámske zimné bundy výpredaj", 9, 8, 3400, 11.6),
        q("nepremokavá zimná bunda", 7, 6, 2800, 12.0),
      ],
    },
    {
      url: "https://demo-shop.sk/produkt/stary-model-x100",
      cur: { clicks: 10, impressions: 600, position: 18.0 },
      prev: { clicks: 140, impressions: 3800, position: 6.0 },
      lost: [q("model x100", 4, 70, 300, 18.5)],
      opp: [],
    },
  ],
  local: [
    {
      url: "https://demo-firma.sk/sluzby/cistenie-kobercov-bratislava",
      cur: { clicks: 80, impressions: 3200, position: 6.0 },
      prev: { clicks: 230, impressions: 3600, position: 3.1 },
      lost: [
        q("čistenie kobercov bratislava", 40, 130, 1600, 6.2),
        q("tepovanie kobercov ba", 20, 60, 800, 7.0),
      ],
      opp: [q("čistenie sedačiek bratislava", 6, 5, 900, 9.8)],
    },
    {
      url: "https://demo-firma.sk/cennik",
      cur: { clicks: 35, impressions: 2400, position: 9.5 },
      prev: { clicks: 40, impressions: 2300, position: 9.2 },
      lost: [],
      opp: [q("cena tepovania koberca", 8, 7, 1400, 10.4)],
    },
    {
      url: "https://demo-firma.sk/blog/ako-vycistit-koberec",
      cur: { clicks: 18, impressions: 1500, position: 13.0 },
      prev: { clicks: 95, impressions: 2900, position: 5.4 },
      lost: [q("ako vyčistiť koberec", 9, 48, 700, 13.4)],
      opp: [],
    },
  ],
  saas: [
    {
      url: "https://demo-saas.sk/blog/co-je-crm",
      cur: { clicks: 160, impressions: 6400, position: 6.4 },
      prev: { clicks: 480, impressions: 7200, position: 2.9 },
      lost: [
        q("čo je crm", 70, 220, 3000, 6.6),
        q("crm systém vysvetlenie", 40, 120, 1700, 7.2),
      ],
      opp: [q("crm pre malé firmy", 12, 10, 2400, 9.0)],
    },
    {
      url: "https://demo-saas.sk/funkcie/fakturacia",
      cur: { clicks: 95, impressions: 5200, position: 8.1 },
      prev: { clicks: 110, impressions: 5000, position: 7.8 },
      lost: [q("fakturačný softvér", 30, 42, 2200, 8.4)],
      opp: [
        q("online fakturácia zadarmo", 10, 9, 3100, 10.2),
        q("fakturácia pre živnostníkov", 8, 7, 2600, 11.4),
      ],
    },
    {
      url: "https://demo-saas.sk/blog/trendy-2022",
      cur: { clicks: 12, impressions: 800, position: 17.0 },
      prev: { clicks: 130, impressions: 3400, position: 5.8 },
      lost: [q("saas trendy 2022", 5, 65, 400, 17.5)],
      opp: [],
    },
  ],
};

function buildRow(p: RawPage): DecayRow {
  const current_ctr = p.cur.impressions ? p.cur.clicks / p.cur.impressions : 0;
  const previous_ctr = p.prev.impressions ? p.prev.clicks / p.prev.impressions : 0;
  const base = {
    url: p.url,
    current_clicks: p.cur.clicks,
    previous_clicks: p.prev.clicks,
    clicks_delta: p.cur.clicks - p.prev.clicks,
    clicks_delta_percent: p.prev.clicks
      ? ((p.cur.clicks - p.prev.clicks) / p.prev.clicks) * 100
      : 0,
    current_impressions: p.cur.impressions,
    previous_impressions: p.prev.impressions,
    impressions_delta: p.cur.impressions - p.prev.impressions,
    impressions_delta_percent: p.prev.impressions
      ? ((p.cur.impressions - p.prev.impressions) / p.prev.impressions) * 100
      : 0,
    current_ctr,
    previous_ctr,
    ctr_delta: current_ctr - previous_ctr,
    current_position: p.cur.position,
    previous_position: p.prev.position,
    position_delta: p.cur.position - p.prev.position,
    top_lost_queries: p.lost,
    top_opportunity_queries: p.opp,
  };
  const { decay_type, priority, priority_score, recommended_action } =
    classifyAndScore(base);
  return { ...base, decay_type, priority, priority_score, recommended_action };
}

export function buildDemoAnalysis(
  scenario: DemoScenario,
  window: "28" | "90",
  minImpressions: number,
  urlContains: string,
): DecayAnalysisResult {
  let rows = SCENARIOS[scenario].map(buildRow);
  rows = rows.filter((r) => r.previous_impressions >= minImpressions || r.current_impressions >= minImpressions);
  if (urlContains) {
    const needle = urlContains.toLowerCase();
    rows = rows.filter((r) => r.url.toLowerCase().includes(needle));
  }
  rows.sort((a, b) => b.priority_score - a.priority_score);

  const decayed = rows.filter((r) => r.clicks_delta < 0 || r.decay_type === "Hidden Opportunity");
  const estimated_lost_clicks = rows.reduce(
    (sum, r) => sum + Math.max(0, -r.clicks_delta),
    0,
  );
  const opp = [...rows].sort(
    (a, b) => b.current_impressions - a.current_impressions,
  )[0];

  const today = new Date();
  const days = window === "90" ? 90 : 28;
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  const curEnd = new Date(today);
  curEnd.setDate(curEnd.getDate() - 3);
  const curStart = new Date(curEnd);
  curStart.setDate(curStart.getDate() - (days - 1));
  const prevEnd = new Date(curStart);
  prevEnd.setDate(prevEnd.getDate() - 1);
  const prevStart = new Date(prevEnd);
  prevStart.setDate(prevStart.getDate() - (days - 1));

  return {
    mode: "demo",
    property: `demo:${scenario}`,
    window,
    current_period: { start: fmt(curStart), end: fmt(curEnd) },
    previous_period: { start: fmt(prevStart), end: fmt(prevEnd) },
    summary: {
      pages_analyzed: rows.length,
      pages_with_decay: decayed.length,
      estimated_lost_clicks,
      highest_opportunity_url: opp?.url ?? null,
      critical_decay_count: rows.filter((r) => r.priority === "high").length,
    },
    rows,
    demo_scenario: scenario,
  };
}
