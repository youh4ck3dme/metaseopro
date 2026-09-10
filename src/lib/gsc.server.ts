// Server-only Google Search Console access via the Lovable connector gateway.
// Never call the Google API directly and never construct siteUrl from user input:
// only exact values returned by GET /webmasters/v3/sites are ever used.
import type { DecayRow, QueryRow } from "./decay-schema";

const GATEWAY = "https://connector-gateway.lovable.dev/google_search_console";

export type GscStatus = "ok" | "not_connected" | "error";

function creds(): { lovableKey: string; connectionKey: string } | null {
  const lovableKey = process.env.LOVABLE_API_KEY;
  const connectionKey = process.env.GOOGLE_SEARCH_CONSOLE_API_KEY;
  if (!lovableKey || !connectionKey) return null;
  return { lovableKey, connectionKey };
}

export function isGscConfigured(): boolean {
  return creds() !== null;
}

async function gscFetch(path: string, init?: RequestInit): Promise<Response> {
  const c = creds();
  if (!c) throw new Error("GSC_NOT_CONNECTED");
  return fetch(`${GATEWAY}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${c.lovableKey}`,
      "X-Connection-Api-Key": c.connectionKey,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
}

export type VerifiedProperty = { siteUrl: string; permissionLevel: string };

/** Lists only verified properties the connected Google account owns. */
export async function listVerifiedProperties(): Promise<VerifiedProperty[]> {
  const res = await gscFetch("/webmasters/v3/sites");
  if (!res.ok) {
    const body = await res.text();
    console.error(`GSC /sites failed [${res.status}]: ${body}`);
    throw new Error(`GSC_LIST_FAILED_${res.status}`);
  }
  const json = (await res.json()) as {
    siteEntry?: { siteUrl: string; permissionLevel?: string }[];
  };
  return (json.siteEntry ?? [])
    .filter((e) => e.permissionLevel !== "siteUnverifiedUser")
    .map((e) => ({
      siteUrl: e.siteUrl,
      permissionLevel: e.permissionLevel ?? "siteOwner",
    }));
}

/** Re-validates a chosen siteUrl against the live verified list. */
export async function assertVerifiedProperty(siteUrl: string): Promise<string> {
  const props = await listVerifiedProperties();
  const match = props.find((p) => p.siteUrl === siteUrl);
  if (!match) throw new Error("GSC_PROPERTY_NOT_VERIFIED");
  return match.siteUrl;
}

function isoDay(offsetDays: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - offsetDays);
  return d.toISOString().slice(0, 10);
}

// Google's data lag is ~3 days; compare two full 90-day windows.
export const LIVE_PERIOD_NOW = `${isoDay(93)} – ${isoDay(3)}`;
export const LIVE_PERIOD_PREV = `${isoDay(183)} – ${isoDay(94)}`;

type SaRow = { keys: string[]; clicks: number; impressions: number; position: number };

async function query(
  siteUrl: string,
  body: Record<string, unknown>,
): Promise<SaRow[]> {
  const res = await gscFetch(
    `/webmasters/v3/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`,
    { method: "POST", body: JSON.stringify(body) },
  );
  if (!res.ok) {
    const text = await res.text();
    console.error(`GSC searchAnalytics failed [${res.status}]: ${text}`);
    if (res.status === 403) throw new Error("GSC_FORBIDDEN");
    throw new Error(`GSC_QUERY_FAILED_${res.status}`);
  }
  const json = (await res.json()) as { rows?: SaRow[] };
  return json.rows ?? [];
}

function windowBody(
  startDate: string,
  endDate: string,
  dimensions: string[],
  extra: Record<string, unknown> = {},
) {
  return { startDate, endDate, dimensions, rowLimit: 250, ...extra };
}

function splitPeriod(period: string): [string, string] {
  const [a, b] = period.split(" – ");
  return [a!, b!];
}

/**
 * Builds decay rows from live GSC data: page-level comparison of two 90-day
 * windows, enriched with per-URL top queries for the most-declining pages.
 */
export async function fetchLiveDecayRows(
  siteUrl: string,
  maxUrls = 12,
): Promise<DecayRow[]> {
  const [nowStart, nowEnd] = splitPeriod(LIVE_PERIOD_NOW);
  const [prevStart, prevEnd] = splitPeriod(LIVE_PERIOD_PREV);

  const [nowRows, prevRows] = await Promise.all([
    query(siteUrl, windowBody(nowStart, nowEnd, ["page"])),
    query(siteUrl, windowBody(prevStart, prevEnd, ["page"])),
  ]);

  const prevMap = new Map(prevRows.map((r) => [r.keys[0]!, r]));
  const merged = nowRows
    .map((r) => {
      const url = r.keys[0]!;
      const prev = prevMap.get(url);
      return {
        url,
        clicksNow: Math.round(r.clicks),
        clicksPrev: Math.round(prev?.clicks ?? 0),
        impressionsNow: Math.round(r.impressions),
        impressionsPrev: Math.round(prev?.impressions ?? 0),
        positionNow: Number((r.position ?? 0).toFixed(1)),
        positionPrev: Number((prev?.position ?? r.position ?? 0).toFixed(1)),
      };
    })
    // Only pages with meaningful prior traffic can meaningfully decay.
    .filter((r) => r.clicksPrev >= 10)
    .sort((a, b) => a.clicksNow - a.clicksPrev - (b.clicksNow - b.clicksPrev))
    .slice(0, maxUrls);

  const rows: DecayRow[] = [];
  for (const r of merged) {
    let topQueries: QueryRow[] = [];
    try {
      const filters = {
        dimensionFilterGroups: [
          {
            filters: [
              { dimension: "page", operator: "equals", expression: r.url },
            ],
          },
        ],
        rowLimit: 10,
      };
      const [qNow, qPrev] = await Promise.all([
        query(siteUrl, windowBody(nowStart, nowEnd, ["query"], filters)),
        query(siteUrl, windowBody(prevStart, prevEnd, ["query"], filters)),
      ]);
      const prevQ = new Map(qPrev.map((q) => [q.keys[0]!, q]));
      topQueries = qNow.slice(0, 5).map((q) => {
        const p = prevQ.get(q.keys[0]!);
        return {
          query: q.keys[0]!.slice(0, 300),
          clicksNow: Math.round(q.clicks),
          clicksPrev: Math.round(p?.clicks ?? 0),
          positionNow: Number((q.position ?? 0).toFixed(1)),
          positionPrev: Number((p?.position ?? q.position ?? 0).toFixed(1)),
        };
      });
    } catch (e) {
      console.error("GSC per-URL query failed:", e);
    }

    let title: string;
    try {
      const path = new URL(r.url).pathname.replace(/\/$/, "");
      title = path === "" ? "Domovská stránka" : path.split("/").pop()!.replace(/[-_]/g, " ");
    } catch {
      title = r.url;
    }

    rows.push({
      url: r.url.slice(0, 2048),
      title: title.slice(0, 500),
      clicksPrev: r.clicksPrev,
      clicksNow: r.clicksNow,
      impressionsPrev: r.impressionsPrev,
      impressionsNow: r.impressionsNow,
      positionPrev: r.positionPrev,
      positionNow: r.positionNow,
      topQueries,
    });
  }
  return rows;
}
