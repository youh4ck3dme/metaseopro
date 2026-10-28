import { Button } from "@/components/ui/button";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Fragment, useEffect, useMemo, useState } from "react";
import { ArrowDownRight, ArrowUpRight, ChevronDown, ChevronRight, Copy, FileText, Minus, Sparkles, Trash2 } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { toast } from "sonner";
import { Toaster } from "@/components/ui/sonner";
import { streamSSE } from "@/lib/stream-sse";
import { handoffToWriter } from "@/lib/refresh-handoff";
import { OpportunityRadar } from "@/components/OpportunityRadar";
import { AppHeader } from "@/components/AppHeader";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import type { DecayDataset, ScoredDecayRow } from "@/lib/decay-schema";

export const Route = createFileRoute("/dashboard")({
  head: () => ({
    meta: [
      { title: "SEO Dashboard — SEO4WEB" },
      { name: "description", content: "SEO veliace centrum: KPI, história snapshotov a porovnanie zmien URL a kľúčových slov." },
      { property: "og:title", content: "SEO Dashboard — SEO4WEB" },
      { property: "og:description", content: "Sleduj kliky, impresie a pozície svojej domény a porovnávaj snapshoty v čase." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: DashboardPage,
});

type Summary = {
  pages?: number;
  clicksNow?: number;
  clicksPrev?: number;
  impressionsNow?: number;
  impressionsPrev?: number;
  avgPositionNow?: number;
  avgPositionPrev?: number;
  critical?: number;
  declining?: number;
};

type Snapshot = {
  id: string;
  site_url: string;
  type: string;
  created_at: string;
  metrics_summary: Summary;
  raw_data: DecayDataset;
};

const fmt = (n: number) => new Intl.NumberFormat("sk-SK").format(Math.round(n));
const fmtDate = (s: string) =>
  new Date(s).toLocaleString("sk-SK", { day: "numeric", month: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" });

function healthIndex(s: Summary): number {
  const pages = s.pages ?? 0;
  if (!pages) return 100;
  const bad = (s.critical ?? 0) * 1 + (s.declining ?? 0) * 0.5;
  return Math.max(0, Math.round(100 - (bad / pages) * 100));
}

function Delta({ value, invert = false, suffix = "" }: { value: number; invert?: boolean; suffix?: string }) {
  if (!value) return <span className="inline-flex items-center gap-0.5 text-muted-foreground"><Minus className="size-3" />0{suffix}</span>;
  const good = invert ? value < 0 : value > 0;
  const Icon = value > 0 ? ArrowUpRight : ArrowDownRight;
  return (
    <span className={"inline-flex items-center gap-0.5 font-medium " + (good ? "text-success-foreground" : "text-danger-foreground")}>
      <Icon className="size-3" />
      {value > 0 ? "+" : ""}
      {Number.isInteger(value) ? fmt(value) : value.toFixed(1)}
      {suffix}
    </span>
  );
}

function DashboardPage() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const [snaps, setSnaps] = useState<Snapshot[]>([]);
  const [busy, setBusy] = useState(true);
  const [site, setSite] = useState("");
  const [aId, setAId] = useState("");
  const [bId, setBId] = useState("");

  useEffect(() => {
    if (!loading && !user) navigate({ to: "/login", search: { redirect: "/dashboard" } });
  }, [user, loading, navigate]);

  useEffect(() => {
    if (!user) return;
    (async () => {
      const { data } = await supabase
        .from("seo_snapshots")
        .select("id, site_url, type, created_at, metrics_summary, raw_data")
        .order("created_at", { ascending: false })
        .limit(200);
      const list = (data ?? []) as unknown as Snapshot[];
      setSnaps(list);
      if (list[0]) setSite(list[0].site_url);
      setBusy(false);
    })();
  }, [user]);

  const sites = useMemo(() => Array.from(new Set(snaps.map((s) => s.site_url))), [snaps]);
  const siteSnaps = useMemo(() => snaps.filter((s) => s.site_url === site), [snaps, site]);

  useEffect(() => {
    setBId(siteSnaps[0]?.id ?? "");
    setAId(siteSnaps[1]?.id ?? siteSnaps[0]?.id ?? "");
  }, [siteSnaps]);

  const latest = siteSnaps[0];
  const m = latest?.metrics_summary ?? {};
  const a = siteSnaps.find((s) => s.id === aId);
  const b = siteSnaps.find((s) => s.id === bId);

  const remove = async (id: string) => {
    if (!confirm("Zmazať snapshot?")) return;
    const { error } = await supabase.from("seo_snapshots").delete().eq("id", id);
    if (!error) setSnaps((p) => p.filter((s) => s.id !== id));
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      <AppHeader />
      <Toaster />
      <main className="mx-auto max-w-screen-xl px-6 pb-20">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-normalst text-muted-foreground">SEO veliace centrum</p>
            <h1 className="mt-1 text-3xl font-semibold tracking-normal md:text-4xl">Dashboard</h1>
          </div>
          {sites.length > 0 && (
            <select value={site} onChange={(e) => setSite(e.target.value)} className="rounded-[8px] border border-border bg-card px-3 py-2 text-sm">
              {sites.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          )}
        </div>

        {busy ? (
          <p className="mt-10 text-sm text-muted-foreground">Načítavam…</p>
        ) : !latest ? (
          <div className="mt-10 rounded-lg bg-card p-8 text-center ring-1 ring-border/5">
            <p className="text-secondary-foreground">Zatiaľ nemáš žiadne uložené snapshoty.</p>
            <Link to="/decay" className="mt-4 inline-block rounded-[8px] bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">
              Spustiť live analýzu v Decay Radar
            </Link>
          </div>
        ) : (
          <>
            {/* KPI */}
            <section className="mt-8 grid grid-cols-2 gap-3 md:grid-cols-4">
              <Kpi label="Kliky (90 dní)" value={fmt(m.clicksNow ?? 0)} delta={<Delta value={(m.clicksNow ?? 0) - (m.clicksPrev ?? 0)} />} />
              <Kpi label="Impresie" value={fmt(m.impressionsNow ?? 0)} delta={<Delta value={(m.impressionsNow ?? 0) - (m.impressionsPrev ?? 0)} />} />
              <Kpi label="Priem. pozícia" value={(m.avgPositionNow ?? 0).toFixed(1)} delta={<Delta invert value={Number(((m.avgPositionNow ?? 0) - (m.avgPositionPrev ?? 0)).toFixed(1))} />} />
              <Kpi label="Health index" value={`${healthIndex(m)}/100`} delta={<span className="text-muted-foreground">{m.critical ?? 0} kritických · {m.declining ?? 0} klesá</span>} />
            </section>
            <p className="mt-2 text-xs text-muted-foreground">Posledný snapshot: {fmtDate(latest.created_at)} · porovnanie s predošlým 90-dňovým obdobím</p>

            {user && <OpportunityRadar snap={latest} userId={user.id} />}
            <Explorer snap={latest} />
            <CtrBooster snap={latest} />

            {/* Snapshots */}
            <section className="mt-10">
              <h2 className="text-lg font-semibold">Uložené snapshoty</h2>
              <ul className="mt-3 divide-y divide-border rounded-lg bg-card ring-1 ring-border/5">
                {siteSnaps.map((s) => (
                  <li key={s.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm">
                    <div>
                      <p className="font-medium">{fmtDate(s.created_at)}</p>
                      <p className="text-xs text-muted-foreground">{s.type} · {s.metrics_summary.pages ?? 0} URL</p>
                    </div>
                    <div className="flex items-center gap-4">
                      <span>{fmt(s.metrics_summary.clicksNow ?? 0)} klikov</span>
                      <span className="text-muted-foreground">poz. {(s.metrics_summary.avgPositionNow ?? 0).toFixed(1)}</span>
                      <span className="text-muted-foreground">health {healthIndex(s.metrics_summary)}</span>
                      <Button variant="studio" size="studio" onClick={() => remove(s.id)} aria-label="Zmazať" className="text-muted-foreground hover:text-danger-foreground"><Trash2 className="size-4" /></Button>
                    </div>
                  </li>
                ))}
              </ul>
            </section>

            {/* Diff */}
            <section className="mt-10">
              <h2 className="text-lg font-semibold">Porovnávač snapshotov</h2>
              <div className="mt-3 flex flex-wrap items-center gap-3 text-sm">
                <SnapSelect label="Starší (A)" value={aId} onChange={setAId} snaps={siteSnaps} />
                <span className="text-muted-foreground">→</span>
                <SnapSelect label="Novší (B)" value={bId} onChange={setBId} snaps={siteSnaps} />
              </div>
              {siteSnaps.length < 2 && (
                <p className="mt-3 text-sm text-muted-foreground">Na porovnanie potrebuješ aspoň 2 snapshoty. Spusti ďalšiu live analýzu neskôr.</p>
              )}
              {a && b && a.id !== b.id && <DiffView a={a} b={b} />}
            </section>
          </>
        )}
      </main>
    </div>
  );
}

function Kpi({ label, value, delta }: { label: string; value: string; delta: React.ReactNode }) {
  return (
    <div className="rounded-lg bg-card p-4 ring-1 ring-border/5">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-semibold tracking-normal">{value}</p>
      <p className="mt-1 text-xs">{delta}</p>
    </div>
  );
}

function SnapSelect({ label, value, onChange, snaps }: { label: string; value: string; onChange: (v: string) => void; snaps: Snapshot[] }) {
  return (
    <label className="flex items-center gap-2">
      <span className="text-muted-foreground">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} className="rounded-[8px] border border-border bg-card px-2 py-1.5">
        {snaps.map((s) => <option key={s.id} value={s.id}>{fmtDate(s.created_at)}</option>)}
      </select>
    </label>
  );
}

type Line = { key: string; aClicks: number; bClicks: number; aPos: number | null; bPos: number | null };

function DiffView({ a, b }: { a: Snapshot; b: Snapshot }) {
  const { urls, queries } = useMemo(() => {
    const rowsA = a.raw_data?.rows ?? [];
    const rowsB = b.raw_data?.rows ?? [];
    const build = (getA: () => Map<string, [number, number]>, getB: () => Map<string, [number, number]>) => {
      const ma = getA(), mb = getB();
      const keys = new Set([...ma.keys(), ...mb.keys()]);
      return [...keys]
        .map<Line>((k) => ({ key: k, aClicks: ma.get(k)?.[0] ?? 0, bClicks: mb.get(k)?.[0] ?? 0, aPos: ma.get(k)?.[1] ?? null, bPos: mb.get(k)?.[1] ?? null }))
        .sort((x, y) => Math.abs(y.bClicks - y.aClicks) - Math.abs(x.bClicks - x.aClicks));
    };
    const urlMap = (rows: ScoredDecayRow[]) => new Map(rows.map((r) => [r.url, [r.clicksNow, r.positionNow] as [number, number]]));
    const qMap = (rows: ScoredDecayRow[]) => {
      const m = new Map<string, [number, number]>();
      rows.forEach((r) => r.topQueries.forEach((q) => {
        const cur = m.get(q.query);
        m.set(q.query, [(cur?.[0] ?? 0) + q.clicksNow, cur ? Math.min(cur[1], q.positionNow) : q.positionNow]);
      }));
      return m;
    };
    return { urls: build(() => urlMap(rowsA), () => urlMap(rowsB)), queries: build(() => qMap(rowsA), () => qMap(rowsB)) };
  }, [a, b]);

  return (
    <div className="mt-4 grid gap-4 lg:grid-cols-2">
      <DiffTable title="URL" lines={urls} />
      <DiffTable title="Kľúčové slová" lines={queries} />
    </div>
  );
}

function DiffTable({ title, lines }: { title: string; lines: Line[] }) {
  return (
    <div className="overflow-hidden rounded-lg bg-card ring-1 ring-border/5">
      <div className="border-b border-border px-4 py-2 text-sm font-medium">{title}</div>
      <div className="max-h-[480px] overflow-auto">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-background text-muted-foreground">
            <tr><th className="px-3 py-2 text-left">{title}</th><th className="px-2 text-right">Kliky A→B</th><th className="px-2 text-right">Δ</th><th className="px-3 text-right">Pozícia</th></tr>
          </thead>
          <tbody>
            {lines.length === 0 && <tr><td colSpan={4} className="px-3 py-4 text-muted-foreground">Žiadne dáta.</td></tr>}
            {lines.map((l) => {
              const d = l.bClicks - l.aClicks;
              const pd = l.aPos != null && l.bPos != null ? Number((l.bPos - l.aPos).toFixed(1)) : 0;
              const bg = d > 0 ? "bg-success-subtle/60" : d < 0 ? "bg-danger-subtle/60" : "";
              return (
                <tr key={l.key} className={"border-t border-border " + bg}>
                  <td className="max-w-[220px] truncate px-3 py-2" title={l.key}>{l.key.replace(/^https?:\/\/[^/]+/, "") || "/"}</td>
                  <td className="px-2 text-right text-secondary-foreground">{fmt(l.aClicks)} → {fmt(l.bClicks)}</td>
                  <td className="px-2 text-right"><Delta value={d} /></td>
                  <td className="px-3 text-right">
                    {l.bPos != null ? l.bPos.toFixed(1) : "—"} {pd !== 0 && <Delta invert value={pd} />}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const path = (u: string) => u.replace(/^https?:\/\/[^/]+/, "") || "/";
const ctrOf = (c: number, i: number) => (i > 0 ? (c / i) * 100 : 0);

type SortKey = "decay" | "clicks" | "impressions" | "position" | "ctr";

function Explorer({ snap }: { snap: Snapshot }) {
  const rows = snap.raw_data?.rows ?? [];
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<SortKey>("decay");
  const [open, setOpen] = useState<Record<string, boolean>>({});

  const list = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const f = rows.filter((r) => !needle || r.url.toLowerCase().includes(needle) || r.topQueries.some((x) => x.query.toLowerCase().includes(needle)));
    const key: Record<SortKey, (r: ScoredDecayRow) => number> = {
      decay: (r) => -r.decayScore,
      clicks: (r) => -r.clicksNow,
      impressions: (r) => -r.impressionsNow,
      position: (r) => r.positionNow,
      ctr: (r) => ctrOf(r.clicksNow, r.impressionsNow),
    };
    return [...f].sort((a, b) => key[sort](a) - key[sort](b));
  }, [rows, q, sort]);

  const refresh = (r: ScoredDecayRow) => {
    handoffToWriter(snap.site_url, r);
    window.location.href = "/?fromRefresh=1";
  };

  return (
    <section className="mt-10">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Všetky URL a kľúčové slová</h2>
          <p className="text-xs text-muted-foreground">{rows.length} URL z posledného snapshotu · klikni na riadok pre dopyty</p>
        </div>
        <div className="flex flex-wrap gap-2 text-sm">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Hľadať URL alebo dopyt…" className="rounded-[8px] border border-border bg-card px-3 py-1.5" />
          <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)} className="rounded-[8px] border border-border bg-card px-2 py-1.5">
            <option value="decay">Najväčší prepad</option>
            <option value="clicks">Kliky</option>
            <option value="impressions">Impresie</option>
            <option value="position">Najlepšia pozícia</option>
            <option value="ctr">Najnižší CTR</option>
          </select>
        </div>
      </div>
      <div className="mt-3 overflow-x-auto rounded-lg bg-card ring-1 ring-border/5">
        <table className="w-full min-w-[760px] text-xs">
          <thead className="bg-background text-muted-foreground">
            <tr>
              <th className="px-3 py-2 text-left">URL / dopyt</th>
              <th className="px-2 text-right">Kliky</th>
              <th className="px-2 text-right">Impresie</th>
              <th className="px-2 text-right">CTR</th>
              <th className="px-2 text-right">Pozícia</th>
              <th className="px-2 text-right">Decay</th>
              <th className="px-3" />
            </tr>
          </thead>
          <tbody>
            {list.length === 0 && <tr><td colSpan={7} className="px-3 py-4 text-muted-foreground">Nič sa nenašlo.</td></tr>}
            {list.map((r) => {
              const isOpen = !!open[r.url];
              return (
                <Fragment key={r.url}>
                  <tr className="cursor-pointer border-t border-border hover:bg-background" onClick={() => setOpen((o) => ({ ...o, [r.url]: !isOpen }))}>
                    <td className="max-w-[280px] px-3 py-2">
                      <span className="flex items-center gap-1 truncate font-medium" title={r.url}>
                        {isOpen ? <ChevronDown className="size-3 shrink-0" /> : <ChevronRight className="size-3 shrink-0" />}
                        {path(r.url)}
                      </span>
                    </td>
                    <td className="px-2 text-right">{fmt(r.clicksNow)} <Delta value={r.clicksNow - r.clicksPrev} /></td>
                    <td className="px-2 text-right">{fmt(r.impressionsNow)}</td>
                    <td className="px-2 text-right">{ctrOf(r.clicksNow, r.impressionsNow).toFixed(1)} %</td>
                    <td className="px-2 text-right">{r.positionNow.toFixed(1)} <Delta invert value={Number((r.positionNow - r.positionPrev).toFixed(1))} /></td>
                    <td className="px-2 text-right">{r.decayScore}</td>
                    <td className="px-3 py-2 text-right">
                      <Button variant="studio" size="studio" onClick={(e) => { e.stopPropagation(); refresh(r); }} className="inline-flex items-center gap-1 rounded-[6px] bg-primary px-2 py-1 text-[11px] font-medium text-primary-foreground">
                        <FileText className="size-3" /> Aktualizovať článok
                      </Button>
                    </td>
                  </tr>
                  {isOpen && r.topQueries.map((x) => (
                    <tr key={r.url + x.query} className="bg-background/60 text-secondary-foreground">
                      <td className="py-1.5 pl-9 pr-3">„{x.query}“</td>
                      <td className="px-2 text-right">{fmt(x.clicksNow)} <Delta value={x.clicksNow - x.clicksPrev} /></td>
                      <td className="px-2 text-right">—</td>
                      <td className="px-2 text-right">—</td>
                      <td className="px-2 text-right">{x.positionNow.toFixed(1)} <Delta invert value={Number((x.positionNow - x.positionPrev).toFixed(1))} /></td>
                      <td colSpan={2} />
                    </tr>
                  ))}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

// Expected organic CTR by position (rough industry curve, %).
const expectedCtr = (pos: number) => (pos <= 1 ? 28 : pos <= 2 ? 15 : pos <= 3 ? 11 : pos <= 5 ? 7 : pos <= 10 ? 3 : 1.2);

function CtrBooster({ snap }: { snap: Snapshot }) {
  const candidates = useMemo(
    () =>
      (snap.raw_data?.rows ?? [])
        .filter((r) => r.impressionsNow >= 100 && r.positionNow <= 15)
        .map((r) => ({ r, ctr: ctrOf(r.clicksNow, r.impressionsNow), exp: expectedCtr(r.positionNow) }))
        .filter((x) => x.ctr < x.exp)
        .sort((a, b) => b.r.impressionsNow * (b.exp - b.ctr) - a.r.impressionsNow * (a.exp - a.ctr))
        .slice(0, 8),
    [snap],
  );
  const [active, setActive] = useState<string | null>(null);
  const [out, setOut] = useState("");
  const [busy, setBusy] = useState(false);

  const run = async (r: ScoredDecayRow, ctr: number) => {
    setActive(r.url);
    setOut("");
    setBusy(true);
    let buf = "";
    await streamSSE({
      url: "/api/ctr-boost",
      body: { url: r.url, title: r.title, queries: r.topQueries.map((q) => q.query).slice(0, 10), position: r.positionNow, ctr, impressions: r.impressionsNow },
      onDelta: (c) => { buf += c; setOut(buf); },
      onDone: () => setBusy(false),
      onError: (m) => { setBusy(false); toast.error(m); },
    });
  };

  return (
    <section className="mt-10">
      <h2 className="flex items-center gap-2 text-lg font-semibold"><Sparkles className="size-4" /> CTR Booster</h2>
      <p className="text-xs text-muted-foreground">Stránky, ktoré Google často zobrazuje, ale ľudia na ne klikajú menej, než je pri ich pozícii bežné.</p>
      {candidates.length === 0 ? (
        <p className="mt-3 rounded-lg bg-card p-4 text-sm text-muted-foreground ring-1 ring-border/5">Žiadne stránky s podpriemerným CTR. Výborné!</p>
      ) : (
        <div className="mt-3 grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
          <ul className="divide-y divide-border rounded-lg bg-card ring-1 ring-border/5">
            {candidates.map(({ r, ctr, exp }) => (
              <li key={r.url} className={"flex items-center justify-between gap-3 px-4 py-3 text-sm " + (active === r.url ? "bg-background" : "")}>
                <div className="min-w-0">
                  <p className="truncate font-medium" title={r.url}>{path(r.url)}</p>
                  <p className="text-xs text-muted-foreground">
                    poz. {r.positionNow.toFixed(1)} · {fmt(r.impressionsNow)} impresií · CTR <span className="text-danger-foreground">{ctr.toFixed(1)} %</span> (bežne ~{exp} %)
                  </p>
                </div>
                <Button variant="studio" size="studio" disabled={busy} onClick={() => run(r, ctr)} className="shrink-0 rounded-[6px] bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground disabled:opacity-50">
                  Navrhnúť title + popis
                </Button>
              </li>
            ))}
          </ul>
          <div className="min-h-[200px] rounded-lg bg-card p-4 ring-1 ring-border/5">
            {!active ? (
              <p className="text-sm text-muted-foreground">Vyber stránku vľavo a AI navrhne 3 varianty title a meta popisu.</p>
            ) : (
              <>
                <div className="mb-2 flex items-center justify-between text-xs text-muted-foreground">
                  <span className="truncate">{path(active)}</span>
                  {out && !busy && (
                    <Button variant="studio" size="studio" onClick={() => { navigator.clipboard.writeText(out); toast.success("Skopírované"); }} className="inline-flex items-center gap-1 hover:text-foreground"><Copy className="size-3" /> Kopírovať</Button>
                  )}
                </div>
                {busy && !out && <p className="text-sm text-muted-foreground">Generujem návrhy…</p>}
                <div className="prose prose-sm max-w-none"><ReactMarkdown remarkPlugins={[remarkGfm]}>{out}</ReactMarkdown></div>
              </>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
