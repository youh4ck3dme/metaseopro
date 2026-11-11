import { Button } from "@/components/ui/button";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Rocket } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { handoffToWriter } from "@/lib/refresh-handoff";
import type { DecayDataset, ScoredDecayRow } from "@/lib/decay-schema";
import {
  CATEGORY_LABEL,
  PAGE_TYPE_LABEL,
  detectCannibalization,
  experimentVerdict,
  rankOpportunities,
  suggestInternalLinks,
  type OppPage,
} from "@/lib/opportunity";

type Snap = { id: string; site_url: string; created_at: string; raw_data: DecayDataset };
type Experiment = {
  id: string;
  page_url: string;
  implemented_at: string;
  baseline: { clicks: number; impressions: number; position: number };
  target_queries: string[];
  status: string;
};

function toOpp(r: ScoredDecayRow): OppPage {
  return {
    url: r.url,
    clicks: r.clicksNow,
    impressions: r.impressionsNow,
    position: r.positionNow,
    clicksPrev: r.clicksPrev,
    impressionsPrev: r.impressionsPrev,
    positionPrev: r.positionPrev,
    queries: r.topQueries.map((q) => ({
      query: q.query,
      clicks: q.clicksNow,
      impressions: 0,
      position: q.positionNow,
      clicksPrev: q.clicksPrev,
      impressionsPrev: 0,
      positionPrev: q.positionPrev,
    })),
  };
}

export function OpportunityRadar({
  snap,
  userId,
  onDeploy,
}: {
  snap: Snap;
  userId: string;
  onDeploy?: (url: string, markdown?: string, title?: string) => void;
}) {
  const rows = snap.raw_data?.rows ?? [];
  const pages = useMemo(() => rows.map(toOpp), [rows]);
  const brand = useMemo(() => {
    try {
      return [
        new URL(snap.site_url.replace("sc-domain:", "https://")).hostname
          .replace(/^www\./, "")
          .split(".")[0]!,
      ];
    } catch {
      return [];
    }
  }, [snap.site_url]);
  const ranked = useMemo(() => rankOpportunities(pages, brand), [pages, brand]);
  const cannibal = useMemo(() => detectCannibalization(pages), [pages]);
  const links = useMemo(() => suggestInternalLinks(ranked).slice(0, 6), [ranked]);
  const [exps, setExps] = useState<Experiment[]>([]);

  const loadExps = async () => {
    const { data } = await supabase
      .from("seo_experiments")
      .select("id,page_url,implemented_at,baseline,target_queries,status")
      .eq("site_url", snap.site_url)
      .order("created_at", { ascending: false })
      .limit(30);
    setExps((data ?? []) as unknown as Experiment[]);
  };
  useEffect(() => {
    void loadExps();
  }, [snap.site_url]);

  const optimize = (url: string) => {
    const r = rows.find((x) => x.url === url);
    if (!r) return;
    handoffToWriter(snap.site_url, r);
    window.location.href = "/?fromRefresh=1";
  };

  const track = async (url: string) => {
    const p = ranked.find((x) => x.url === url);
    if (!p) return;
    const { error } = await supabase.from("seo_experiments").insert({
      user_id: userId,
      site_url: snap.site_url,
      page_url: url,
      baseline: { clicks: p.clicks, impressions: p.impressions, position: p.position },
      target_queries: p.queries.slice(0, 5).map((q) => q.query),
      changes: p.action.slice(0, 5000),
      status: "approved",
    });
    if (error) return toast.error("Experiment sa nepodarilo uložiť");
    toast.success("Zmena sa sleduje — porovnáme ju s ďalšími skenmi");
    void loadExps();
  };

  const removeExp = async (id: string) => {
    if (!userId) return;
    await supabase.from("seo_experiments").delete().eq("id", id).eq("user_id", userId);
    void loadExps();
  };

  const stateColor: Record<string, string> = {
    Critical: "bg-rose-500/10 border border-rose-500/20 text-rose-400 font-bold",
    Opportunity: "bg-amber-500/10 border border-amber-500/20 text-amber-400 font-bold",
    Good: "bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 font-bold",
    Protected: "bg-sky-500/10 border border-sky-500/20 text-sky-400 font-bold",
    "Needs data": "bg-zinc-800 border border-zinc-700 text-zinc-400 font-medium",
  };

  return (
    <section className="mt-12">
      <h2 className="text-lg font-bold text-white font-display">SEO Opportunity Radar</h2>
      <p className="text-xs text-zinc-400">
        Stránky zoradené podľa potenciálu rastu (počítajú sa aj stránky s impresiami bez klikov) ·{" "}
        <span className="font-mono text-zinc-300">{snap.site_url}</span>
      </p>
      {ranked.length === 0 ? (
        <p className="mt-4 rounded-xl bg-[#1f1f1f] border border-[#2c2c2c] p-5 text-sm text-zinc-400 shadow-xl shadow-black/40">
          Žiadne stránky s dostatkom dát. Spusti nový live sken v Decay Radar.
        </p>
      ) : (
        <div className="mt-4 overflow-x-auto rounded-xl bg-[#1f1f1f] border border-[#2c2c2c] shadow-xl shadow-black/40">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wider font-semibold text-zinc-400 bg-[#181818] border-b border-[#282828]">
              <tr>
                <th className="p-3.5">URL</th>
                <th className="p-3.5">Skóre</th>
                <th className="p-3.5">Impr.</th>
                <th className="p-3.5">Kliky</th>
                <th className="p-3.5">Poz.</th>
                <th className="p-3.5">Zámer / typ</th>
                <th className="p-3.5">Kategórie</th>
                <th className="p-3.5"></th>
              </tr>
            </thead>
            <tbody>
              {ranked.slice(0, 20).map((p, pIdx) => (
                <tr
                  key={`${p.url}-${pIdx}`}
                  className="border-t border-[#262626] hover:bg-[#252525] transition-colors align-top"
                >
                  <td className="p-3.5 max-w-[260px]">
                    <div className="truncate font-semibold text-white">{p.path}</div>
                    <div className="text-xs text-zinc-400 mt-0.5">{p.action}</div>
                  </td>
                  <td className="p-3.5">
                    <span
                      className={`inline-block rounded px-2 py-0.5 text-xs ${stateColor[p.state] ?? ""}`}
                    >
                      {p.score}
                    </span>
                  </td>
                  <td className="p-3.5 tabular-nums text-zinc-200">{p.impressions}</td>
                  <td className="p-3.5 tabular-nums text-zinc-200">{p.clicks}</td>
                  <td className="p-3.5 tabular-nums text-zinc-200">{p.position.toFixed(1)}</td>
                  <td className="p-3.5 text-xs text-zinc-300">
                    <span className="font-medium text-white">{p.intent}</span>
                    <br />
                    <span className="text-zinc-400">{PAGE_TYPE_LABEL[p.pageType]}</span>
                  </td>
                  <td className="p-3.5">
                    <div className="flex flex-wrap gap-1">
                      {p.categories.map((c, cIdx) => (
                        <span
                          key={`${c}-${cIdx}`}
                          className="rounded bg-zinc-800 border border-zinc-700/60 px-1.5 py-0.5 text-[11px] text-zinc-300"
                        >
                          {CATEGORY_LABEL[c]}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="p-3.5 whitespace-nowrap">
                    <Button
                      variant="studio"
                      size="studio"
                      onClick={() => optimize(p.url)}
                      className="rounded-md bg-emerald-600 hover:bg-emerald-500 px-3 py-1.5 text-xs font-medium text-white transition-colors shadow-sm"
                    >
                      Optimalizovať
                    </Button>
                    <Button
                      variant="studio"
                      size="studio"
                      onClick={() => track(p.url)}
                      className="ml-2 rounded-md border border-[#383838] bg-[#222222] hover:bg-[#2a2a2a] text-zinc-200 px-3 py-1.5 text-xs transition-colors"
                    >
                      Sledovať zmenu
                    </Button>
                    {onDeploy && (
                      <Button
                        variant="studio"
                        size="studio"
                        onClick={() => onDeploy(p.url, "", p.path)}
                        className="ml-2 rounded-md bg-emerald-600 hover:bg-emerald-500 px-2.5 py-1.5 text-xs font-medium text-white transition-colors shadow-sm"
                        title="1-Click nasadenie do WordPressu"
                      >
                        <Rocket className="size-3.5" />
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="mt-6 grid gap-4 md:grid-cols-2">
        <div className="rounded-xl bg-[#212121] border border-[#2c2c2c] p-5 shadow-xl shadow-black/40">
          <h3 className="font-bold text-sm text-white font-display">Riziko kanibalizácie</h3>
          {cannibal.length === 0 ? (
            <p className="mt-2 text-xs text-zinc-400">
              Nenašli sa stránky súperiace o rovnaký dopyt.
            </p>
          ) : (
            <ul className="mt-2 space-y-2 text-xs text-zinc-300">
              {cannibal.slice(0, 8).map((c, cIdx) => (
                <li key={`${c.query}-${cIdx}`}>
                  <b className="text-emerald-400">„{c.query}“</b> →{" "}
                  {c.urls
                    .map((u) => {
                      try {
                        return new URL(u).pathname;
                      } catch {
                        return u;
                      }
                    })
                    .join(" · ")}
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="rounded-xl bg-[#212121] border border-[#2c2c2c] p-5 shadow-xl shadow-black/40">
          <h3 className="font-bold text-sm text-white font-display">Návrhy interných odkazov</h3>
          {links.length === 0 ? (
            <p className="mt-2 text-xs text-zinc-400">Zatiaľ žiadne návrhy.</p>
          ) : (
            <ul className="mt-2 space-y-2 text-xs text-zinc-300">
              {links.map((l, i) => (
                <li key={`link-${l.source}-${l.target}-${i}`}>
                  <b className="text-white">[{l.anchor}]</b>: {l.source} → {l.target}{" "}
                  <span className="text-zinc-400">
                    ({l.priority}) {l.reason}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="mt-6 rounded-xl bg-[#212121] border border-[#2c2c2c] p-5 shadow-xl shadow-black/40">
        <h3 className="font-bold text-sm text-white font-display">Sledované zmeny (pred / po)</h3>
        {exps.length === 0 ? (
          <p className="mt-2 text-xs text-zinc-400">
            Klikni na „Sledovať zmenu" po úprave stránky — porovnáme výsledok s ďalšími skenmi.
          </p>
        ) : (
          <table className="mt-3 w-full text-xs">
            <thead className="text-left text-zinc-400 border-b border-[#282828] pb-2 font-semibold text-[11px] uppercase tracking-wider">
              <tr>
                <th className="py-2">Stránka</th>
                <th>Od</th>
                <th>Pred</th>
                <th>Teraz</th>
                <th>Výsledok</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {exps.map((e, eIdx) => {
                const now = ranked.find((p) => p.url === e.page_url);
                const days = Math.floor(
                  (Date.now() - new Date(e.implemented_at).getTime()) / 86400000,
                );
                const verdict = now
                  ? experimentVerdict(
                      e.baseline,
                      { clicks: now.clicks, impressions: now.impressions, position: now.position },
                      days,
                    )
                  : "INSUFFICIENT DATA";
                return (
                  <tr
                    key={`${e.id}-${eIdx}`}
                    className="border-t border-[#282828] hover:bg-[#252525] transition-colors"
                  >
                    <td className="py-2.5 font-medium text-white">
                      {(() => {
                        try {
                          return new URL(e.page_url).pathname;
                        } catch {
                          return e.page_url;
                        }
                      })()}
                    </td>
                    <td className="text-zinc-400">{e.implemented_at}</td>
                    <td className="text-zinc-300">
                      {e.baseline.clicks} kl · {e.baseline.position?.toFixed?.(1)}
                    </td>
                    <td className="text-zinc-300">
                      {now ? `${now.clicks} kl · ${now.position.toFixed(1)}` : "—"}
                    </td>
                    <td
                      className={
                        verdict.startsWith("IMPROVED")
                          ? "text-emerald-400 font-semibold"
                          : verdict.startsWith("DECLINED")
                            ? "text-rose-400 font-semibold"
                            : "text-zinc-400"
                      }
                    >
                      {verdict}
                    </td>
                    <td className="text-right">
                      <Button
                        variant="studio"
                        size="studio"
                        onClick={() => removeExp(e.id)}
                        className="text-zinc-400 hover:text-rose-400 hover:bg-rose-500/10 rounded p-1 transition-colors"
                      >
                        ×
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}
