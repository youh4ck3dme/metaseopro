// Server-only helpers for the Semrush connector gateway.
// .server.ts suffix blocks this file from client bundles.

const GATEWAY_URL = "https://connector-gateway.lovable.dev/semrush";

export class SemrushError extends Error {
  status: number;
  constructor(message: string, status = 500) {
    super(message);
    this.status = status;
  }
}

function requireKeys() {
  const LOVABLE_API_KEY = process.env.LOVABLE_API_KEY;
  if (!LOVABLE_API_KEY) {
    throw new SemrushError("LOVABLE_API_KEY nie je nakonfigurovaný.", 500);
  }
  const SEMRUSH_API_KEY = process.env.SEMRUSH_API_KEY;
  if (!SEMRUSH_API_KEY) {
    throw new SemrushError(
      "Semrush konektor nie je pripojený. Pripoj ho v nastaveniach.",
      503,
    );
  }
  return { LOVABLE_API_KEY, SEMRUSH_API_KEY };
}

async function semrushGet(
  path: string,
  params: Record<string, string | number>,
) {
  const { LOVABLE_API_KEY, SEMRUSH_API_KEY } = requireKeys();
  const qs = new URLSearchParams(
    Object.entries(params).map(([k, v]) => [k, String(v)]),
  ).toString();
  const url = `${GATEWAY_URL}${path}?${qs}`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${LOVABLE_API_KEY}`,
      "X-Connection-Api-Key": SEMRUSH_API_KEY,
    },
  });
  const text = await res.text();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {
    // not JSON
  }
  if (!res.ok) {
    const msg =
      json?.error || `Semrush API zlyhalo (${res.status}): ${text.slice(0, 200)}`;
    if (typeof msg === "string" && msg.includes("ERROR 134")) {
      throw new SemrushError(
        "Vyčerpaný Semrush limit. Skús to neskôr alebo upgraduj plán.",
        429,
      );
    }
    throw new SemrushError(msg, res.status);
  }
  return json;
}

// Convert Semrush "columnNames + rows" payload to array of objects.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rowsToObjects(data: any): Array<Record<string, string>> {
  const cols: string[] | undefined = data?.data?.columnNames;
  const rows: string[][] | undefined = data?.data?.rows;
  if (!cols || !rows) return [];
  return rows.map((r) => {
    const o: Record<string, string> = {};
    cols.forEach((c, i) => {
      o[c] = r[i];
    });
    return o;
  });
}

export function pickDatabase(domain: string): string {
  const d = domain.toLowerCase();
  if (d.endsWith(".sk")) return "sk";
  if (d.endsWith(".cz")) return "cz";
  if (d.endsWith(".de") || d.endsWith(".at")) return "de";
  if (d.endsWith(".pl")) return "pl";
  if (d.endsWith(".hu")) return "hu";
  if (d.endsWith(".fr")) return "fr";
  if (d.endsWith(".es")) return "es";
  if (d.endsWith(".it")) return "it";
  if (d.endsWith(".co.uk") || d.endsWith(".uk")) return "uk";
  return "us";
}

export type DomainSnapshot = {
  domain: string;
  database: string;
  overview: Record<string, string> | null;
  topKeywords: Array<Record<string, string>>;
  backlinks: Record<string, string> | null;
  anchors: Array<Record<string, string>>;
  topRefDomains: Array<Record<string, string>>;
  errors: string[];
};

export async function getDomainSnapshot(
  domain: string,
  databaseOverride?: string,
): Promise<DomainSnapshot> {
  const database = databaseOverride && databaseOverride.length > 0
    ? databaseOverride
    : pickDatabase(domain);
  const errors: string[] = [];

  const [overviewRes, keywordsRes, backlinksRes, anchorsRes, refDomainsRes] =
    await Promise.allSettled([
      semrushGet("/domains/domain_ranks", {
        domain,
        database,
        export_columns: "Db,Dn,Rk,Or,Ot,Oc,Ad,At,Ac,Sh,Sv",
      }),
      semrushGet("/domains/domain_organic", {
        domain,
        database,
        display_limit: 20,
        export_columns: "Ph,Po,Nq,Cp,Tr,Co,Nr,Td,Kd",
      }),
      semrushGet("/backlinks/backlinks_overview", {
        target: domain,
        target_type: "root_domain",
      }),
      semrushGet("/backlinks/backlinks_anchors", {
        target: domain,
        target_type: "root_domain",
        display_limit: 10,
      }),
      semrushGet("/backlinks/backlinks_refdomains", {
        target: domain,
        target_type: "root_domain",
        display_limit: 10,
      }),
    ]);

  const overviewRows =
    overviewRes.status === "fulfilled" ? rowsToObjects(overviewRes.value) : [];
  if (overviewRes.status === "rejected") {
    errors.push(
      `domain_ranks: ${(overviewRes.reason as Error).message ?? "fail"}`,
    );
  }

  const topKeywords =
    keywordsRes.status === "fulfilled" ? rowsToObjects(keywordsRes.value) : [];
  if (keywordsRes.status === "rejected") {
    errors.push(
      `domain_organic: ${(keywordsRes.reason as Error).message ?? "fail"}`,
    );
  }

  const backlinksRows =
    backlinksRes.status === "fulfilled"
      ? rowsToObjects(backlinksRes.value)
      : [];
  if (backlinksRes.status === "rejected") {
    errors.push(
      `backlinks_overview: ${(backlinksRes.reason as Error).message ?? "fail"}`,
    );
  }

  const anchors =
    anchorsRes.status === "fulfilled" ? rowsToObjects(anchorsRes.value) : [];
  const topRefDomains =
    refDomainsRes.status === "fulfilled"
      ? rowsToObjects(refDomainsRes.value)
      : [];

  return {
    domain,
    database,
    overview: overviewRows[0] ?? null,
    topKeywords,
    backlinks: backlinksRows[0] ?? null,
    anchors,
    topRefDomains,
    errors,
  };
}
