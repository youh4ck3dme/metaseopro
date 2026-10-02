import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { ArrowDownRight, ArrowUpRight, Minus, Trash2 } from "lucide-react";
import { AppHeader } from "@/components/AppHeader";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import type { DecayDataset, ScoredDecayRow } from "@/lib/decay-schema";

export const Route = createFileRoute("/dashboard")({
  head: () => ({
    meta: [
      { title: "SEO Dashboard — Písmo" },
      { name: "description", content: "SEO veliace centrum: KPI, história snapshotov a porovnanie zmien URL a kľúčových slov." },
      { property: "og:title", content: "SEO Dashboard — Písmo" },
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
  if (!value) return <span className="inline-flex items-center gap-0.5 text-neutral-400"><Minus className="size-3" />0{suffix}</span>;
  const good = invert ? value < 0 : value > 0;
  const Icon = value > 0 ? ArrowUpRight : ArrowDownRight;
  return (
    <span className={"inline-flex items-center gap-0.5 font-medium " + (good ? "text-emerald-600" : "text-red-600")}>
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
    <div className="min-h-screen bg-neutral-50 text-neutral-900">
      <AppHeader />
      <main className="mx-auto max-w-screen-xl px-6 pb-20">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-widest text-neutral-500">SEO veliace centrum</p>
            <h1 className="mt-1 text-3xl font-semibold tracking-tight md:text-4xl">Dashboard</h1>
          </div>
          {sites.length > 0 && (
            <select value={site} onChange={(e) => setSite(e.target.value)} className="rounded-[8px] border border-neutral-200 bg-white px-3 py-2 text-sm">
              {sites.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          )}
        </div>

        {busy ? (
          <p className="mt-10 text-sm text-neutral-500">Načítavam…</p>
        ) : !latest ? (
          <div className="mt-10 rounded-[12px] bg-white p-8 text-center ring-1 ring-black/5">
            <p className="text-neutral-600">Zatiaľ nemáš žiadne uložené snapshoty.</p>
            <Link to="/decay" className="mt-4 inline-block rounded-[8px] bg-neutral-900 px-4 py-2 text-sm font-medium text-neutral-50">
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
              <Kpi label="Health index" value={`${healthIndex(m)}/100`} delta={<span className="text-neutral-500">{m.critical ?? 0} kritických · {m.declining ?? 0} klesá</span>} />
            </section>
            <p className="mt-2 text-xs text-neutral-500">Posledný snapshot: {fmtDate(latest.created_at)} · porovnanie s predošlým 90-dňovým obdobím</p>

            {/* Snapshots */}
            <section className="mt-10">
              <h2 className="text-lg font-semibold">Uložené snapshoty</h2>
              <ul className="mt-3 divide-y divide-neutral-100 rounded-[12px] bg-white ring-1 ring-black/5">
                {siteSnaps.map((s) => (
                  <li key={s.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm">
                    <div>
                      <p className="font-medium">{fmtDate(s.created_at)}</p>
                      <p className="text-xs text-neutral-500">{s.type} · {s.metrics_summary.pages ?? 0} URL</p>
                    </div>
                    <div className="flex items-center gap-4">
                      <span>{fmt(s.metrics_summary.clicksNow ?? 0)} klikov</span>
                      <span className="text-neutral-500">poz. {(s.metrics_summary.avgPositionNow ?? 0).toFixed(1)}</span>
                      <span className="text-neutral-500">health {healthIndex(s.metrics_summary)}</span>
                      <button onClick={() => remove(s.id)} aria-label="Zmazať" className="text-neutral-400 hover:text-red-600"><Trash2 className="size-4" /></button>
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
                <span className="text-neutral-400">→</span>
                <SnapSelect label="Novší (B)" value={bId} onChange={setBId} snaps={siteSnaps} />
              </div>
              {siteSnaps.length < 2 && (
                <p className="mt-3 text-sm text-neutral-500">Na porovnanie potrebuješ aspoň 2 snapshoty. Spusti ďalšiu live analýzu neskôr.</p>
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
    <div className="rounded-[12px] bg-white p-4 ring-1 ring-black/5">
      <p className="text-xs text-neutral-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold tracking-tight">{value}</p>
      <p className="mt-1 text-xs">{delta}</p>
    </div>
  );
}

function SnapSelect({ label, value, onChange, snaps }: { label: string; value: string; onChange: (v: string) => void; snaps: Snapshot[] }) {
  return (
    <label className="flex items-center gap-2">
      <span className="text-neutral-500">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} className="rounded-[8px] border border-neutral-200 bg-white px-2 py-1.5">
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
    <div className="overflow-hidden rounded-[12px] bg-white ring-1 ring-black/5">
      <div className="border-b border-neutral-100 px-4 py-2 text-sm font-medium">{title}</div>
      <div className="max-h-[480px] overflow-auto">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-neutral-50 text-neutral-500">
            <tr><th className="px-3 py-2 text-left">{title}</th><th className="px-2 text-right">Kliky A→B</th><th className="px-2 text-right">Δ</th><th className="px-3 text-right">Pozícia</th></tr>
          </thead>
          <tbody>
            {lines.length === 0 && <tr><td colSpan={4} className="px-3 py-4 text-neutral-500">Žiadne dáta.</td></tr>}
            {lines.map((l) => {
              const d = l.bClicks - l.aClicks;
              const pd = l.aPos != null && l.bPos != null ? Number((l.bPos - l.aPos).toFixed(1)) : 0;
              const bg = d > 0 ? "bg-emerald-50/60" : d < 0 ? "bg-red-50/60" : "";
              return (
                <tr key={l.key} className={"border-t border-neutral-100 " + bg}>
                  <td className="max-w-[220px] truncate px-3 py-2" title={l.key}>{l.key.replace(/^https?:\/\/[^/]+/, "") || "/"}</td>
                  <td className="px-2 text-right text-neutral-600">{fmt(l.aClicks)} → {fmt(l.bClicks)}</td>
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
