// Server-only Google Search Console client via the Lovable connector gateway.
// Read-only access only. Never expose tokens to the client.

const GATEWAY = "https://connector-gateway.lovable.dev/google_search_console";

export type GscStatus =
  | "connected"
  | "not_connected"
  | "reconnect"
  | "no_properties"
  | "permission_error";

export type GscSite = { siteUrl: string; permissionLevel: string };

function keys() {
  return {
    lovable: process.env.LOVABLE_API_KEY,
    conn: process.env.GOOGLE_SEARCH_CONSOLE_API_KEY,
  };
}

function headers(lovable: string, conn: string): Record<string, string> {
  return {
    Authorization: `Bearer ${lovable}`,
    "X-Connection-Api-Key": conn,
    "Content-Type": "application/json",
  };
}

function mapErrorStatus(httpStatus: number): GscStatus {
  if (httpStatus === 401) return "reconnect";
  if (httpStatus === 403) return "permission_error";
  return "reconnect";
}

export async function listSites(): Promise<{
  status: GscStatus;
  sites: GscSite[];
}> {
  const { lovable, conn } = keys();
  if (!lovable || !conn) return { status: "not_connected", sites: [] };

  let res: Response;
  try {
    res = await fetch(`${GATEWAY}/webmasters/v3/sites`, {
      method: "GET",
      headers: headers(lovable, conn),
    });
  } catch (e) {
    console.error("GSC listSites fetch failed:", e);
    return { status: "reconnect", sites: [] };
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    console.error("GSC listSites error:", res.status, body.slice(0, 500));
    return { status: mapErrorStatus(res.status), sites: [] };
  }

  const json = (await res.json().catch(() => ({}))) as {
    siteEntry?: { siteUrl?: string; permissionLevel?: string }[];
  };
  const sites: GscSite[] = (json.siteEntry ?? [])
    .filter((s) => s.siteUrl && s.permissionLevel !== "siteUnverifiedUser")
    .map((s) => ({
      siteUrl: String(s.siteUrl),
      permissionLevel: String(s.permissionLevel ?? "unknown"),
    }));

  if (sites.length === 0) return { status: "no_properties", sites: [] };
  return { status: "connected", sites };
}

export type SearchAnalyticsRow = {
  keys: string[];
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
};

export async function searchAnalytics(params: {
  siteUrl: string;
  startDate: string;
  endDate: string;
  dimensions: ("page" | "query" | "date")[];
  rowLimit?: number;
  dimensionFilterGroups?: unknown[];
  aggregationType?: string;
}): Promise<
  | { ok: true; rows: SearchAnalyticsRow[] }
  | { ok: false; status: GscStatus; message: string }
> {
  const { lovable, conn } = keys();
  if (!lovable || !conn)
    return { ok: false, status: "not_connected", message: "GSC nie je pripojené." };

  const encoded = encodeURIComponent(params.siteUrl);
  let res: Response;
  try {
    res = await fetch(
      `${GATEWAY}/webmasters/v3/sites/${encoded}/searchAnalytics/query`,
      {
        method: "POST",
        headers: headers(lovable, conn),
        body: JSON.stringify({
          startDate: params.startDate,
          endDate: params.endDate,
          dimensions: params.dimensions,
          rowLimit: params.rowLimit ?? 25000,
          type: "web",
          aggregationType: params.aggregationType,
          dimensionFilterGroups: params.dimensionFilterGroups,
        }),
      },
    );
  } catch (e) {
    console.error("GSC searchAnalytics fetch failed:", e);
    return { ok: false, status: "reconnect", message: "Spojenie s GSC zlyhalo." };
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    console.error("GSC searchAnalytics error:", res.status, body.slice(0, 500));
    return {
      ok: false,
      status: mapErrorStatus(res.status),
      message: "GSC API vrátilo chybu.",
    };
  }

  const json = (await res.json().catch(() => ({}))) as {
    rows?: SearchAnalyticsRow[];
  };
  return { ok: true, rows: json.rows ?? [] };
}
