// Server-only helpers for the Semrush connector gateway with intelligent caching.
// .server.ts suffix blocks this file from client bundles.
import { createClient } from "@supabase/supabase-js";

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
    throw new SemrushError("Semrush konektor nie je pripojený. Pripoj ho v nastaveniach.", 503);
  }
  return { LOVABLE_API_KEY, SEMRUSH_API_KEY };
}

async function semrushGet(path: string, params: Record<string, string | number>) {
  const { LOVABLE_API_KEY, SEMRUSH_API_KEY } = requireKeys();
  const qs = new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)])).toString();
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
    const msg = json?.error || `Semrush API zlyhalo (${res.status}): ${text.slice(0, 200)}`;
    if (typeof msg === "string" && (msg.includes("ERROR 134") || res.status === 429)) {
      throw new SemrushError("Vyčerpaný Semrush limit. Skús to neskôr alebo upgraduj plán.", 429);
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
  cached?: boolean;
  cachedAt?: string;
  stale?: boolean;
  warning?: string;
};

// -----------------------------------------------------------------------------
// L1 In-Memory Cache (Edge isolate speedup) & L2 Supabase persistent store
// -----------------------------------------------------------------------------

type CacheEntry = {
  snapshot: DomainSnapshot;
  updatedAt: string;
  expiresAt: number; // timestamp in ms
};

const memoryCache = new Map<string, CacheEntry>();

export function clearSemrushMemoryCache(): void {
  memoryCache.clear();
}

function getSupabaseServerClient() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, {
    auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
  });
}

async function readFromSupabaseCache(
  domain: string,
  database: string,
): Promise<{ snapshot: DomainSnapshot; updatedAt: string; expiresAt: string } | null> {
  const supabase = getSupabaseServerClient();
  if (!supabase) return null;
  try {
    const { data, error } = await supabase
      .from("semrush_domain_cache")
      .select("snapshot_data, updated_at, expires_at")
      .eq("domain", domain)
      .eq("database", database)
      .maybeSingle();

    if (error || !data) return null;
    return {
      snapshot: data.snapshot_data as unknown as DomainSnapshot,
      updatedAt: data.updated_at,
      expiresAt: data.expires_at,
    };
  } catch {
    return null;
  }
}

async function saveToSupabaseCache(
  domain: string,
  database: string,
  snapshot: DomainSnapshot,
  now: Date,
  expiresAt: Date,
): Promise<void> {
  const supabase = getSupabaseServerClient();
  if (!supabase) return;
  try {
    await supabase.from("semrush_domain_cache").upsert(
      {
        domain,
        database,
        snapshot_data: snapshot as unknown as import("@/integrations/supabase/types").Json,
        updated_at: now.toISOString(),
        expires_at: expiresAt.toISOString(),
      },
      { onConflict: "domain,database" },
    );
  } catch (e) {
    console.error("semrush_domain_cache save error:", e);
  }
}

/**
 * Raw live API call to Semrush.
 */
export async function getDomainSnapshot(
  domain: string,
  databaseOverride?: string,
): Promise<DomainSnapshot> {
  const database =
    databaseOverride && databaseOverride.length > 0 ? databaseOverride : pickDatabase(domain);
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

  const reasons = [overviewRes, keywordsRes, backlinksRes, anchorsRes, refDomainsRes]
    .filter((r): r is PromiseRejectedResult => r.status === "rejected")
    .map((r) => r.reason);

  const rateLimitReason = reasons.find(
    (reason) =>
      (reason instanceof SemrushError && reason.status === 429) ||
      (reason instanceof Error &&
        (reason.message.includes("429") ||
          reason.message.includes("ERROR 134") ||
          reason.message.includes("Vyčerpaný Semrush limit"))),
  );

  if (rateLimitReason) {
    if (rateLimitReason instanceof SemrushError) {
      throw rateLimitReason;
    }
    throw new SemrushError((rateLimitReason as Error).message || "Semrush limit prekročený", 429);
  }

  const overviewRows = overviewRes.status === "fulfilled" ? rowsToObjects(overviewRes.value) : [];
  if (overviewRes.status === "rejected") {
    errors.push(`domain_ranks: ${(overviewRes.reason as Error).message ?? "fail"}`);
  }

  const topKeywords = keywordsRes.status === "fulfilled" ? rowsToObjects(keywordsRes.value) : [];
  if (keywordsRes.status === "rejected") {
    errors.push(`domain_organic: ${(keywordsRes.reason as Error).message ?? "fail"}`);
  }

  const backlinksRows =
    backlinksRes.status === "fulfilled" ? rowsToObjects(backlinksRes.value) : [];
  if (backlinksRes.status === "rejected") {
    errors.push(`backlinks_overview: ${(backlinksRes.reason as Error).message ?? "fail"}`);
  }

  const anchors = anchorsRes.status === "fulfilled" ? rowsToObjects(anchorsRes.value) : [];
  const topRefDomains =
    refDomainsRes.status === "fulfilled" ? rowsToObjects(refDomainsRes.value) : [];

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

/**
 * Intelligent Semrush cache with 7-day TTL and circuit breaker for 429 quota exhaustion.
 * - If valid cached data exists: returns immediately without calling Semrush.
 * - If cache expired or absent: fetches live data and saves to DB.
 * - If Semrush returns 429 / ERROR 134: returns stale cached data with warning rather than crashing.
 */
export async function getCachedDomainSnapshot(
  domain: string,
  databaseOverride?: string,
): Promise<DomainSnapshot> {
  const normDomain = domain.trim().toLowerCase();
  const normDb = (
    databaseOverride && databaseOverride.length > 0 ? databaseOverride : pickDatabase(normDomain)
  ).toLowerCase();
  const cacheKey = `${normDomain}:${normDb}`;
  const now = Date.now();

  let staleCandidate: { snapshot: DomainSnapshot; updatedAt: string } | null = null;

  // 1. Check L1 Memory Cache
  const l1 = memoryCache.get(cacheKey);
  if (l1) {
    if (l1.expiresAt > now) {
      return {
        ...l1.snapshot,
        cached: true,
        cachedAt: l1.updatedAt,
      };
    }
    staleCandidate = { snapshot: l1.snapshot, updatedAt: l1.updatedAt };
  }

  // 2. Check L2 Supabase Persistent Cache
  const l2 = await readFromSupabaseCache(normDomain, normDb);
  if (l2) {
    const expiresAtMs = new Date(l2.expiresAt).getTime();
    memoryCache.set(cacheKey, {
      snapshot: l2.snapshot,
      updatedAt: l2.updatedAt,
      expiresAt: expiresAtMs,
    });
    if (expiresAtMs > now) {
      return {
        ...l2.snapshot,
        cached: true,
        cachedAt: l2.updatedAt,
      };
    }
    staleCandidate = { snapshot: l2.snapshot, updatedAt: l2.updatedAt };
  }

  // 3. Fallback on Live API with Circuit Breaker
  try {
    const live = await getDomainSnapshot(normDomain, normDb);
    const nowDate = new Date();
    const expiresAtDate = new Date(nowDate.getTime() + 7 * 24 * 60 * 60 * 1000); // 7 days

    memoryCache.set(cacheKey, {
      snapshot: live,
      updatedAt: nowDate.toISOString(),
      expiresAt: expiresAtDate.getTime(),
    });

    await saveToSupabaseCache(normDomain, normDb, live, nowDate, expiresAtDate);

    return {
      ...live,
      cached: false,
      cachedAt: nowDate.toISOString(),
    };
  } catch (err) {
    const isRateLimit =
      (err instanceof SemrushError && err.status === 429) ||
      (err instanceof Error &&
        (err.message.includes("429") ||
          err.message.includes("ERROR 134") ||
          err.message.includes("Vyčerpaný Semrush limit")));

    if (isRateLimit && staleCandidate) {
      return {
        ...staleCandidate.snapshot,
        cached: true,
        cachedAt: staleCandidate.updatedAt,
        stale: true,
        warning: "Zobrazené archivované dáta kvôli vyťaženiu API",
      };
    }
    throw err;
  }
}
