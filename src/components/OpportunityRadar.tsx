import { Button } from "@/components/ui/button";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
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

export function OpportunityRadar({ snap, userId }: { snap: Snap; userId: string }) {
  const rows = snap.raw_data?.rows ?? [];
  const pages = useMemo(() => rows.map(toOpp), [rows]);
  const brand = useMemo(() => {
    try { return [new URL(snap.site_url.replace("sc-domain:", "https://")).hostname.replace(/^www\./, "").split(".")[0]!]; } catch { return []; }
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
  useEffect(() => { void loadExps(); }, [snap.site_url]);

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
    await supabase.from("seo_experiments").delete().eq("id", id);
    void loadExps();
  };

  const stateColor: Record<string, string> = {
    Critical: "bg-danger-subtle text-danger-foreground",
    Opportunity: "bg-warning-subtle text-warning-foreground",
    Good: "bg-success-subtle text-success-foreground",
    Protected: "bg-info-subtle text-info-foreground",
    "Needs data": "bg-muted text-secondary-foreground",
  };

  return (
    <section className="mt-10">
      <h2 className="text-lg font-semibold">SEO Opportunity Radar</h2>
      <p className="text-xs text-muted-foreground">
        Stránky zoradené podľa potenciálu rastu (počítajú sa aj stránky s impresiami bez klikov) · {snap.site_url}
      </p>
      {ranked.length === 0 ? (
        <p className="mt-4 text-sm text-muted-foreground">Žiadne stránky s dostatkom dát. Spusti nový live sken v Decay Radar.</p>
      ) : (
        <div className="mt-4 overflow-x-auto rounded-lg bg-card ring-1 ring-border/5">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-normalr text-muted-foreground">
              <tr><th className="p-3">URL</th><th className="p-3">Skóre</th><th className="p-3">Impr.</th><th className="p-3">Kliky</th><th className="p-3">Poz.</th><th className="p-3">Zámer / typ</th><th className="p-3">Kategórie</th><th className="p-3"></th></tr>
            </thead>
            <tbody>
              {ranked.slice(0, 20).map((p) => (
                <tr key={p.url} className="border-t border-border align-top">
                  <td className="p-3 max-w-[260px]">
                    <div className="truncate font-medium">{p.path}</div>
                    <div className="text-xs text-muted-foreground">{p.action}</div>
                  </td>
                  <td className="p-3"><span className={`rounded px-2 py-0.5 text-xs font-semibold ${stateColor[p.state] ?? ""}`}>{p.score}</span></td>
                  <td className="p-3 tabular-nums">{p.impressions}</td>
                  <td className="p-3 tabular-nums">{p.clicks}</td>
                  <td className="p-3 tabular-nums">{p.position.toFixed(1)}</td>
                  <td className="p-3 text-xs">{p.intent}<br /><span className="text-muted-foreground">{PAGE_TYPE_LABEL[p.pageType]}</span></td>
                  <td className="p-3"><div className="flex flex-wrap gap-1">{p.categories.map((c) => <span key={c} className="rounded bg-muted px-1.5 py-0.5 text-[11px]">{CATEGORY_LABEL[c]}</span>)}</div></td>
                  <td className="p-3 whitespace-nowrap">
                    <Button variant="studio" size="studio" onClick={() => optimize(p.url)} className="rounded-[8px] bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground">Optimalizovať</Button>
                    <Button variant="studio" size="studio" onClick={() => track(p.url)} className="ml-2 rounded-[8px] border border-border px-3 py-1.5 text-xs">Sledovať zmenu</Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="mt-6 grid gap-4 md:grid-cols-2">
        <div className="rounded-lg bg-card p-4 ring-1 ring-border/5">
          <h3 className="font-semibold text-sm">Riziko kanibalizácie</h3>
          {cannibal.length === 0 ? <p className="mt-2 text-xs text-muted-foreground">Nenašli sa stránky súperiace o rovnaký dopyt.</p> : (
            <ul className="mt-2 space-y-2 text-xs">{cannibal.slice(0, 8).map((c) => (
              <li key={c.query}><b>{c.query}</b> → {c.urls.map((u) => { try { return new URL(u).pathname; } catch { return u; } }).join(" · ")}</li>
            ))}</ul>
          )}
        </div>
        <div className="rounded-lg bg-card p-4 ring-1 ring-border/5">
          <h3 className="font-semibold text-sm">Návrhy interných odkazov</h3>
          {links.length === 0 ? <p className="mt-2 text-xs text-muted-foreground">Zatiaľ žiadne návrhy.</p> : (
            <ul className="mt-2 space-y-2 text-xs">{links.map((l, i) => (
              <li key={i}><b>{l.anchor}</b>: {l.source} → {l.target} <span className="text-muted-foreground">({l.priority}) {l.reason}</span></li>
            ))}</ul>
          )}
        </div>
      </div>

      <div className="mt-6 rounded-lg bg-card p-4 ring-1 ring-border/5">
        <h3 className="font-semibold text-sm">Sledované zmeny (pred / po)</h3>
        {exps.length === 0 ? <p className="mt-2 text-xs text-muted-foreground">Klikni na „Sledovať zmenu" po úprave stránky — porovnáme výsledok s ďalšími skenmi.</p> : (
          <table className="mt-2 w-full text-xs">
            <thead className="text-left text-muted-foreground"><tr><th className="py-1">Stránka</th><th>Od</th><th>Pred</th><th>Teraz</th><th>Výsledok</th><th></th></tr></thead>
            <tbody>{exps.map((e) => {
              const now = ranked.find((p) => p.url === e.page_url);
              const days = Math.floor((Date.now() - new Date(e.implemented_at).getTime()) / 86400000);
              const verdict = now ? experimentVerdict(e.baseline, { clicks: now.clicks, impressions: now.impressions, position: now.position }, days) : "INSUFFICIENT DATA";
              return (
                <tr key={e.id} className="border-t border-border">
                  <td className="py-1.5">{(() => { try { return new URL(e.page_url).pathname; } catch { return e.page_url; } })()}</td>
                  <td>{e.implemented_at}</td>
                  <td>{e.baseline.clicks} kl · {e.baseline.position?.toFixed?.(1)}</td>
                  <td>{now ? `${now.clicks} kl · ${now.position.toFixed(1)}` : "—"}</td>
                  <td className={verdict.startsWith("IMPROVED") ? "text-success-foreground" : verdict.startsWith("DECLINED") ? "text-danger-foreground" : "text-muted-foreground"}>{verdict}</td>
                  <td><Button variant="studio" size="studio" onClick={() => removeExp(e.id)} className="text-muted-foreground hover:text-danger-foreground">×</Button></td>
                </tr>
              );
            })}</tbody>
          </table>
        )}
      </div>
    </section>
  );
}
