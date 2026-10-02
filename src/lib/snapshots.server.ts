// Server-only: persists SEO analysis snapshots as the signed-in user (RLS applies).
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import type { DecayDataset } from "./decay-schema";

export async function saveDecaySnapshot(
  request: Request,
  userId: string,
  dataset: DecayDataset,
): Promise<string | null> {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY;
  const token = request.headers.get("authorization")?.slice(7).trim();
  if (!url || !key || !token) return null;

  const supabase = createClient<Database>(url, key, {
    auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });

  const rows = dataset.rows;
  const sum = (f: (r: (typeof rows)[number]) => number) => rows.reduce((a, r) => a + f(r), 0);
  const avg = (f: (r: (typeof rows)[number]) => number) =>
    rows.length ? Number((sum(f) / rows.length).toFixed(2)) : 0;

  const metrics_summary = {
    pages: rows.length,
    clicksNow: sum((r) => r.clicksNow),
    clicksPrev: sum((r) => r.clicksPrev),
    impressionsNow: sum((r) => r.impressionsNow),
    impressionsPrev: sum((r) => r.impressionsPrev),
    avgPositionNow: avg((r) => r.positionNow),
    avgPositionPrev: avg((r) => r.positionPrev),
    critical: rows.filter((r) => r.status === "critical").length,
    declining: rows.filter((r) => r.status === "declining").length,
    periodNow: dataset.periodNow,
    periodPrev: dataset.periodPrev,
  };

  const { data, error } = await supabase
    .from("seo_snapshots")
    .insert({
      user_id: userId,
      site_url: dataset.siteUrl,
      type: "decay",
      metrics_summary,
      raw_data: dataset as never,
    })
    .select("id")
    .single();
  if (error) {
    console.error("snapshot save failed:", error.message);
    return null;
  }
  return data.id;
}
