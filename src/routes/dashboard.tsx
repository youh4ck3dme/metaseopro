import { Button } from "@/components/ui/button";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Fragment, useEffect, useMemo, useState } from "react";
import {
  ArrowDownRight,
  ArrowUpRight,
  ChevronDown,
  ChevronRight,
  Copy,
  FileText,
  Loader2,
  Minus,
  Plus,
  RefreshCw,
  Rocket,
  Sparkles,
  Trash2,
} from "lucide-react";
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
import { PaywallModal } from "@/components/PaywallModal";
import { ClientReportModal } from "@/components/ClientReportModal";
import { BillingInvoiceSection } from "@/components/BillingInvoiceSection";
import { CmsDeployDialog } from "@/components/CmsDeployDialog";

export const Route = createFileRoute("/dashboard")({
  head: () => ({
    meta: [
      { title: "SEO Dashboard — SEO4WEB" },
      {
        name: "description",
        content:
          "SEO veliace centrum: KPI, história snapshotov a porovnanie zmien URL a kľúčových slov.",
      },
      { property: "og:title", content: "SEO Dashboard — SEO4WEB" },
      {
        property: "og:description",
        content: "Sleduj kliky, impresie a pozície svojej domény a porovnávaj snapshoty v čase.",
      },
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
  new Date(s).toLocaleString("sk-SK", {
    day: "numeric",
    month: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

function healthIndex(s: Summary): number {
  const pages = s.pages ?? 0;
  if (!pages) return 100;
  const bad = (s.critical ?? 0) * 1 + (s.declining ?? 0) * 0.5;
  return Math.max(0, Math.round(100 - (bad / pages) * 100));
}

function Delta({
  value,
  invert = false,
  suffix = "",
}: {
  value: number;
  invert?: boolean;
  suffix?: string;
}) {
  if (!value)
    return (
      <span className="inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[11px] font-medium bg-zinc-800 border border-zinc-700 text-zinc-400">
        <Minus className="size-3" />0{suffix}
      </span>
    );
  const good = invert ? value < 0 : value > 0;
  const Icon = value > 0 ? ArrowUpRight : ArrowDownRight;
  return (
    <span
      className={
        "inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[11px] font-semibold " +
        (good
          ? "bg-emerald-500/10 border border-emerald-500/20 text-emerald-400"
          : "bg-rose-500/10 border border-rose-500/20 text-rose-400")
      }
    >
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
  const [scanOpen, setScanOpen] = useState(false);
  const [properties, setProperties] = useState<string[]>([]);
  const [selectedProperty, setSelectedProperty] = useState("");
  const [propertiesBusy, setPropertiesBusy] = useState(false);
  const [propertiesError, setPropertiesError] = useState("");
  const [propertiesRetry, setPropertiesRetry] = useState(0);
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState("");
  const [scanStage, setScanStage] = useState("");
  const [paywallOpen, setPaywallOpen] = useState(false);
  const [reportModalOpen, setReportModalOpen] = useState(false);
  const [cmsDeployOpen, setCmsDeployOpen] = useState(false);
  const [deployTargetUrl, setDeployTargetUrl] = useState("");
  const [deployTitle, setDeployTitle] = useState("");
  const [deployCurrentTitle, setDeployCurrentTitle] = useState("");
  const [deployMetaDesc, setDeployMetaDesc] = useState("");

  const handleOpenDeploy = (targetUrl: string, markdown?: string, currentTitle?: string) => {
    setDeployTargetUrl(targetUrl);
    setDeployCurrentTitle(currentTitle || "");

    if (markdown) {
      const titleMatch = markdown.match(/Title(?:\s*\d*)?:\s*([^\n\r]+)/i);
      const metaMatch = markdown.match(
        /(?:Meta(?:\s*Description)?|Popis)(?:\s*\d*)?:\s*([^\n\r]+)/i,
      );
      const clean = (s?: string) => s?.replace(/^[#*_\s"]+|[#*_\s"]+$/g, "").trim();

      setDeployTitle(clean(titleMatch?.[1]) || currentTitle || "");
      setDeployMetaDesc(clean(metaMatch?.[1]) || "");
    } else {
      setDeployTitle(currentTitle || "");
      setDeployMetaDesc("");
    }
    setCmsDeployOpen(true);
  };

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

  const showPropertyPicker = scanOpen || (!busy && snaps.length === 0);
  useEffect(() => {
    if (!user || !showPropertyPicker) return;
    let cancelled = false;
    setPropertiesBusy(true);
    setPropertiesError("");
    (async () => {
      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();
        if (!session) throw new Error("Prihlás sa znova a skús to ešte raz.");
        const response = await fetch("/api/decay-gsc-properties", {
          headers: { Authorization: `Bearer ${session.access_token}` },
        });
        const result = await response.json();
        if (!response.ok || result.status === "error")
          throw new Error(result.error || "Weby sa nepodarilo načítať.");
        if (result.status === "not_connected")
          throw new Error("Google Search Console nie je pripojený.");
        const list: string[] = (result.properties ?? []).map((p: { siteUrl: string }) => p.siteUrl);
        if (cancelled) return;
        setProperties(list);
        setSelectedProperty((current) => (list.includes(current) ? current : (list[0] ?? "")));
        if (!list.length) setPropertiesError("Pripojený Google účet nemá žiadne overené weby.");
      } catch (error) {
        if (!cancelled) {
          setProperties([]);
          setSelectedProperty("");
          setPropertiesError(
            error instanceof Error ? error.message : "Weby sa nepodarilo načítať.",
          );
        }
      } finally {
        if (!cancelled) setPropertiesBusy(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user, showPropertyPicker, propertiesRetry]);

  const runScan = async () => {
    if (scanning || propertiesBusy || !properties.includes(selectedProperty)) return;
    setScanning(true);
    setScanError("");
    setScanStage("Analyzujem dáta zo Search Console…");
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) throw new Error("Prihlás sa znova a skús to ešte raz.");
      const response = await fetch("/api/decay-analyze", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ mode: "live", scenario: "local", siteUrl: selectedProperty }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Analýza sa nepodarila. Skús to znova.");
      if (!result.snapshotId)
        throw new Error("Analýza prebehla, ale výsledok sa neuložil. Skús sken znova.");
      setScanStage("Načítavam uložené výsledky…");
      const { data, error } = await supabase
        .from("seo_snapshots")
        .select("id, site_url, type, created_at, metrics_summary, raw_data")
        .eq("id", result.snapshotId)
        .single();
      if (error || !data)
        throw new Error("Výsledok je uložený, ale nepodarilo sa ho načítať. Obnov Dashboard.");
      const saved = data as unknown as Snapshot;
      setSnaps((current) => [saved, ...current.filter((s) => s.id !== saved.id)]);
      setSite(saved.site_url);
      setScanOpen(false);
      toast.success("Sken je uložený. Dashboard bol aktualizovaný.");
    } catch (error) {
      setScanError(error instanceof Error ? error.message : "Analýza sa nepodarila.");
    } finally {
      setScanning(false);
    }
  };

  const propertyPicker = (
    <div className="space-y-4">
      {propertiesBusy ? (
        <p role="status" className="flex items-center gap-2 text-sm text-zinc-400">
          <Loader2 className="size-4 animate-spin text-emerald-400 motion-reduce:animate-none" />
          Načítavam overené weby…
        </p>
      ) : propertiesError ? (
        <div className="space-y-3">
          <p role="alert" className="text-sm text-rose-400">
            {propertiesError}
          </p>
          <Button
            variant="outline"
            onClick={() => setPropertiesRetry((n) => n + 1)}
            className="border-[#333333] bg-[#222222] text-zinc-200 hover:bg-[#2a2a2a] hover:border-[#444444]"
          >
            <RefreshCw className="size-3.5 text-emerald-400" />
            Skúsiť znova
          </Button>
        </div>
      ) : (
        <label className="block space-y-2 text-left text-sm">
          <span className="font-medium text-zinc-300">Overený web v Search Console</span>
          <select
            aria-label="Overený web v Search Console"
            value={selectedProperty}
            disabled={scanning}
            onChange={(e) => {
              setSelectedProperty(e.target.value);
              setScanError("");
            }}
            className="w-full min-w-0 rounded-lg border border-[#333333] bg-[#1a1a1a] px-3.5 py-2 text-sm text-[#f4f4f5] focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
          >
            {properties.map((url) => (
              <option key={url} value={url} className="bg-[#1a1a1a] text-[#f4f4f5]">
                {url}
              </option>
            ))}
          </select>
        </label>
      )}
      {scanError && (
        <p role="alert" className="text-left text-sm text-rose-400">
          {scanError}
        </p>
      )}
      <Button
        disabled={scanning || propertiesBusy || !selectedProperty || !!propertiesError}
        onClick={runScan}
        className="w-full sm:w-auto bg-emerald-600 hover:bg-emerald-500 text-white font-medium shadow-sm transition-all"
      >
        {scanning ? (
          <Loader2 className="animate-spin motion-reduce:animate-none" />
        ) : (
          <RefreshCw className="size-4" />
        )}
        {scanning ? "Prebieha sken…" : "Spustiť sken"}
      </Button>
      {scanning && (
        <p role="status" aria-live="polite" className="text-sm text-zinc-400">
          {scanStage}
        </p>
      )}
    </div>
  );

  const latest = siteSnaps[0];
  const m = latest?.metrics_summary ?? {};
  const a = siteSnaps.find((s) => s.id === aId);
  const b = siteSnaps.find((s) => s.id === bId);

  const remove = async (id: string) => {
    if (!user) return;
    if (!confirm("Zmazať snapshot?")) return;
    const { error } = await supabase
      .from("seo_snapshots")
      .delete()
      .eq("id", id)
      .eq("user_id", user.id);
    if (!error) setSnaps((p) => p.filter((s) => s.id !== id));
  };

  return (
    <div className="dark min-h-screen bg-[#171717] text-[#e2e8f0] font-sans antialiased selection:bg-emerald-500/20 selection:text-emerald-300">
      <AppHeader />
      <Toaster />
      <main className="mx-auto max-w-screen-xl px-6 pb-20">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-emerald-400">
              SEO veliace centrum
            </p>
            <h1 className="mt-1 font-display text-3xl font-bold tracking-tight text-white md:text-4xl">
              Dashboard
            </h1>
          </div>
          <div className="flex w-full min-w-0 flex-wrap items-center gap-2.5 sm:w-auto">
            {sites.length > 0 && (
              <select
                aria-label="Vybraný web"
                value={site}
                onChange={(e) => setSite(e.target.value)}
                className="min-w-0 max-w-full rounded-lg border border-[#333333] bg-[#1a1a1a] px-3.5 py-2 text-sm font-medium text-[#f4f4f5] shadow-inner focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
              >
                {sites.map((s) => (
                  <option key={s} value={s} className="bg-[#1a1a1a] text-[#f4f4f5]">
                    {s}
                  </option>
                ))}
              </select>
            )}
            <Button
              variant="outline"
              disabled={busy || scanning}
              onClick={() => {
                if (sites.length >= 1) {
                  setPaywallOpen(true);
                  return;
                }
                setScanError("");
                setScanOpen(true);
              }}
              className="gap-1.5 rounded-lg border border-[#333333] bg-[#222222] text-[#f4f4f5] hover:bg-[#2a2a2a] hover:border-[#444444] transition-all shadow-sm"
            >
              <Plus className="size-4 text-emerald-400" />
              Analyzovať ďalší web
            </Button>
            {latest && (
              <Button
                variant="outline"
                onClick={() => setReportModalOpen(true)}
                className="gap-1.5 rounded-lg border border-[#333333] bg-[#222222] text-[#f4f4f5] hover:bg-[#2a2a2a] hover:border-[#444444] transition-all shadow-sm"
              >
                <FileText className="size-4 text-emerald-400" />
                Stiahnuť klientsky report (PDF)
              </Button>
            )}
            <Button
              onClick={() => setPaywallOpen(true)}
              className="gap-1.5 rounded-lg bg-white text-zinc-950 font-semibold hover:bg-zinc-200 transition-all shadow-md active:scale-[0.98]"
            >
              <Sparkles className="size-4 text-amber-500" />
              Aktivovať Pro (39 €)
            </Button>
          </div>
        </div>

        <Dialog
          open={scanOpen}
          onOpenChange={(open) => {
            if (!scanning) setScanOpen(open);
          }}
        >
          <DialogContent
            className="max-w-[calc(100%-2rem)] sm:max-w-lg border border-[#3a3a3a] bg-[#212121] text-[#f4f4f5] shadow-2xl"
            aria-describedby={undefined}
            onEscapeKeyDown={(e) => {
              if (scanning) e.preventDefault();
            }}
            onPointerDownOutside={(e) => {
              if (scanning) e.preventDefault();
            }}
          >
            <DialogHeader>
              <DialogTitle className="text-white font-display text-lg">
                Analyzovať ďalší web
              </DialogTitle>
            </DialogHeader>
            {scanOpen && propertyPicker}
          </DialogContent>
        </Dialog>

        {busy ? (
          <p className="mt-10 text-sm text-zinc-400">Načítavam…</p>
        ) : !latest ? (
          <section className="mx-auto mt-10 max-w-lg space-y-5 rounded-xl border border-[#2c2c2c] bg-[#1f1f1f] p-8 shadow-xl shadow-black/40">
            <p className="text-zinc-300 font-medium">Zatiaľ nemáš žiadne uložené snapshoty.</p>
            {!scanOpen && propertyPicker}
          </section>
        ) : (
          <>
            {/* KPI */}
            <section className="mt-8 grid grid-cols-2 gap-3.5 md:grid-cols-4">
              <Kpi
                label="Kliky (90 dní)"
                value={fmt(m.clicksNow ?? 0)}
                delta={<Delta value={(m.clicksNow ?? 0) - (m.clicksPrev ?? 0)} />}
              />
              <Kpi
                label="Impresie"
                value={fmt(m.impressionsNow ?? 0)}
                delta={<Delta value={(m.impressionsNow ?? 0) - (m.impressionsPrev ?? 0)} />}
              />
              <Kpi
                label="Priem. pozícia"
                value={(m.avgPositionNow ?? 0).toFixed(1)}
                delta={
                  <Delta
                    invert
                    value={Number(((m.avgPositionNow ?? 0) - (m.avgPositionPrev ?? 0)).toFixed(1))}
                  />
                }
              />
              <Kpi
                label="Health index"
                value={`${healthIndex(m)}/100`}
                delta={
                  <span className="text-zinc-400">
                    <strong className="text-rose-400">{m.critical ?? 0}</strong> kritických ·{" "}
                    <strong className="text-amber-400">{m.declining ?? 0}</strong> klesá
                  </span>
                }
              />
            </section>
            <p className="mt-3 text-xs text-zinc-400">
              Posledný snapshot:{" "}
              <span className="font-semibold text-zinc-200">{fmtDate(latest.created_at)}</span>
            </p>
            <dl
              aria-label="Porovnávané obdobia GSC"
              className="mt-3 flex flex-wrap gap-x-8 gap-y-2 rounded-xl bg-[#1c1c1c] border border-[#2a2a2a] px-5 py-3 text-sm shadow-inner"
            >
              <div>
                <dt className="text-[11px] font-medium uppercase tracking-wider text-zinc-400">
                  Aktuálne obdobie (90 dní)
                </dt>
                <dd className="font-semibold text-white mt-0.5">
                  {latest.raw_data?.periodNow || "Dátumy nie sú dostupné"}
                </dd>
              </div>
              <div>
                <dt className="text-[11px] font-medium uppercase tracking-wider text-zinc-400">
                  Predchádzajúce obdobie (90 dní)
                </dt>
                <dd className="font-semibold text-white mt-0.5">
                  {latest.raw_data?.periodPrev || "Dátumy nie sú dostupné"}
                </dd>
              </div>
            </dl>

            {user && (
              <OpportunityRadar snap={latest} userId={user.id} onDeploy={handleOpenDeploy} />
            )}
            <Explorer snap={latest} />
            <CtrBooster snap={latest} onDeploy={handleOpenDeploy} />

            {/* Snapshots */}
            <section className="mt-12">
              <h2 className="text-lg font-bold text-white font-display">Uložené snapshoty</h2>
              <ul className="mt-3 divide-y divide-[#282828] rounded-xl bg-[#1f1f1f] border border-[#2c2c2c] shadow-xl shadow-black/40 overflow-hidden">
                {siteSnaps.map((s) => (
                  <li
                    key={s.id}
                    className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5 text-sm hover:bg-[#252525] transition-colors"
                  >
                    <div>
                      <p className="font-semibold text-white">{fmtDate(s.created_at)}</p>
                      <p className="text-xs text-zinc-400 mt-0.5">
                        {s.type} · {s.metrics_summary.pages ?? 0} URL
                      </p>
                    </div>
                    <div className="flex items-center gap-4 text-xs">
                      <span className="font-medium text-zinc-200">
                        {fmt(s.metrics_summary.clicksNow ?? 0)} klikov
                      </span>
                      <span className="text-zinc-400">
                        poz. {(s.metrics_summary.avgPositionNow ?? 0).toFixed(1)}
                      </span>
                      <span className="rounded bg-zinc-800 px-2 py-0.5 text-zinc-300 border border-zinc-700/60 font-medium">
                        health {healthIndex(s.metrics_summary)}/100
                      </span>
                      <Button
                        variant="studio"
                        size="studio"
                        onClick={() => remove(s.id)}
                        aria-label="Zmazať"
                        className="text-zinc-400 hover:text-rose-400 hover:bg-rose-500/10 rounded-md p-1.5 transition-colors"
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            </section>

            {/* Diff */}
            <section className="mt-12">
              <h2 className="text-lg font-bold text-white font-display">Porovnávač snapshotov</h2>
              <div className="mt-3 flex flex-wrap items-center gap-3 text-sm">
                <SnapSelect label="Starší (A)" value={aId} onChange={setAId} snaps={siteSnaps} />
                <span className="text-zinc-500">→</span>
                <SnapSelect label="Novší (B)" value={bId} onChange={setBId} snaps={siteSnaps} />
              </div>
              {siteSnaps.length < 2 && (
                <p className="mt-3 text-sm text-zinc-400">
                  Na porovnanie potrebuješ aspoň 2 snapshoty. Spusti ďalšiu live analýzu neskôr.
                </p>
              )}
              {a && b && a.id !== b.id && <DiffView a={a} b={b} />}
            </section>
          </>
        )}

        {/* Fakturačné údaje a história platieb */}
        <section className="mt-14 border-t border-[#2c2c2c] pt-8">
          <div className="mb-6">
            <h2 className="text-xl font-bold text-white font-display">
              Fakturačné údaje a história platieb
            </h2>
            <p className="text-xs text-zinc-400 mt-1">
              Správa firemných údajov, automatické vystavovanie faktúr cez SuperFaktúru a sťahovanie
              daňových dokladov (PDF).
            </p>
          </div>
          <BillingInvoiceSection />
        </section>
      </main>

      <PaywallModal
        open={paywallOpen}
        onOpenChange={setPaywallOpen}
        title="Odomknite neobmedzený počet webov s balíkom Pro"
        description="Bezplatný plán umožňuje sledovanie 1 webu. S balíkom Pro (39 € / mes.) získate sledovanie až 5 webov, neobmedzený Decay Radar a WordPress exporty."
      />

      <ClientReportModal
        open={reportModalOpen}
        onOpenChange={setReportModalOpen}
        siteUrl={site || latest?.site_url || ""}
        dataset={latest?.raw_data}
        summary={m}
      />

      <CmsDeployDialog
        open={cmsDeployOpen}
        onOpenChange={setCmsDeployOpen}
        siteUrl={site || latest?.site_url || ""}
        targetUrl={deployTargetUrl}
        initialTitle={deployTitle}
        currentTitle={deployCurrentTitle}
        initialMetaDescription={deployMetaDesc}
      />
    </div>
  );
}

function Kpi({ label, value, delta }: { label: string; value: string; delta: React.ReactNode }) {
  return (
    <div className="rounded-xl bg-[#212121] p-5 border border-[#2c2c2c] shadow-xl shadow-black/40 hover:border-[#383838] transition-all duration-200">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400">{label}</p>
      <p className="mt-2 font-display text-3xl font-bold tracking-tight text-white">{value}</p>
      <div className="mt-2.5 flex items-center text-xs">{delta}</div>
    </div>
  );
}

function SnapSelect({
  label,
  value,
  onChange,
  snaps,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  snaps: Snapshot[];
}) {
  return (
    <label className="flex items-center gap-2">
      <span className="text-zinc-400 text-xs uppercase tracking-wider font-medium">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-lg border border-[#333333] bg-[#1a1a1a] px-3 py-1.5 text-xs text-[#f4f4f5] focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500/20"
      >
        {snaps.map((s) => (
          <option key={s.id} value={s.id} className="bg-[#1a1a1a] text-[#f4f4f5]">
            {fmtDate(s.created_at)}
          </option>
        ))}
      </select>
    </label>
  );
}

type Line = {
  key: string;
  aClicks: number;
  bClicks: number;
  aPos: number | null;
  bPos: number | null;
};

function DiffView({ a, b }: { a: Snapshot; b: Snapshot }) {
  const { urls, queries } = useMemo(() => {
    const rowsA = a.raw_data?.rows ?? [];
    const rowsB = b.raw_data?.rows ?? [];
    const build = (
      getA: () => Map<string, [number, number]>,
      getB: () => Map<string, [number, number]>,
    ) => {
      const ma = getA(),
        mb = getB();
      const keys = new Set([...ma.keys(), ...mb.keys()]);
      return [...keys]
        .map<Line>((k) => ({
          key: k,
          aClicks: ma.get(k)?.[0] ?? 0,
          bClicks: mb.get(k)?.[0] ?? 0,
          aPos: ma.get(k)?.[1] ?? null,
          bPos: mb.get(k)?.[1] ?? null,
        }))
        .sort((x, y) => Math.abs(y.bClicks - y.aClicks) - Math.abs(x.bClicks - x.aClicks));
    };
    const urlMap = (rows: ScoredDecayRow[]) => {
      const m = new Map<string, [number, number]>();
      rows.forEach((r) => {
        const u = r.url?.trim();
        if (!u) return;
        const cur = m.get(u);
        if (!cur) {
          m.set(u, [r.clicksNow, r.positionNow]);
        } else {
          m.set(u, [(cur[0] ?? 0) + r.clicksNow, Math.min(cur[1], r.positionNow)]);
        }
      });
      return m;
    };
    const qMap = (rows: ScoredDecayRow[]) => {
      const m = new Map<string, [number, number]>();
      rows.forEach((r) =>
        r.topQueries?.forEach((q) => {
          const query = q.query?.trim();
          if (!query) return;
          const cur = m.get(query);
          m.set(query, [
            (cur?.[0] ?? 0) + q.clicksNow,
            cur ? Math.min(cur[1], q.positionNow) : q.positionNow,
          ]);
        }),
      );
      return m;
    };
    return {
      urls: build(
        () => urlMap(rowsA),
        () => urlMap(rowsB),
      ),
      queries: build(
        () => qMap(rowsA),
        () => qMap(rowsB),
      ),
    };
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
    <div className="overflow-hidden rounded-xl bg-[#1f1f1f] border border-[#2c2c2c] shadow-xl shadow-black/40">
      <div className="border-b border-[#2c2c2c] bg-[#181818] px-4 py-3 text-sm font-semibold text-white font-display">
        {title}
      </div>
      <div className="max-h-[480px] overflow-auto">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-[#161616] text-zinc-400 border-b border-[#282828] text-[11px] uppercase tracking-wider font-semibold">
            <tr>
              <th className="px-3.5 py-2.5 text-left">{title}</th>
              <th className="px-2 text-right">Kliky A→B</th>
              <th className="px-2 text-right">Δ</th>
              <th className="px-3.5 text-right">Pozícia</th>
            </tr>
          </thead>
          <tbody>
            {lines.length === 0 && (
              <tr>
                <td colSpan={4} className="px-3.5 py-6 text-center text-zinc-400">
                  Žiadne dáta.
                </td>
              </tr>
            )}
            {lines.map((l, idx) => {
              const d = l.bClicks - l.aClicks;
              const pd =
                l.aPos != null && l.bPos != null ? Number((l.bPos - l.aPos).toFixed(1)) : 0;
              const bg = d > 0 ? "bg-emerald-500/[0.04]" : d < 0 ? "bg-rose-500/[0.04]" : "";
              return (
                <tr
                  key={`${title}-${l.key || "row"}-${idx}`}
                  className={"border-t border-[#262626] hover:bg-[#252525] transition-colors " + bg}
                >
                  <td
                    className="max-w-[220px] truncate px-3.5 py-2.5 font-medium text-zinc-200"
                    title={l.key}
                  >
                    {l.key.replace(/^https?:\/\/[^/]+/, "") || "/"}
                  </td>
                  <td className="px-2 text-right text-zinc-300 tabular-nums">
                    {fmt(l.aClicks)} → {fmt(l.bClicks)}
                  </td>
                  <td className="px-2 text-right">
                    <Delta value={d} />
                  </td>
                  <td className="px-3.5 text-right text-zinc-300 tabular-nums">
                    {l.bPos != null ? l.bPos.toFixed(1) : "—"}{" "}
                    {pd !== 0 && <Delta invert value={pd} />}
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
  const rows = useMemo(() => {
    const raw = snap.raw_data?.rows ?? [];
    const seen = new Set<string>();
    const unique: ScoredDecayRow[] = [];
    for (const r of raw) {
      const u = r.url?.trim().toLowerCase();
      if (!u || seen.has(u)) continue;
      seen.add(u);
      unique.push(r);
    }
    return unique;
  }, [snap.raw_data?.rows]);

  const [q, setQ] = useState("");
  const [sort, setSort] = useState<SortKey>("decay");
  const [open, setOpen] = useState<Record<string, boolean>>({});

  const list = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const f = rows.filter(
      (r) =>
        !needle ||
        r.url.toLowerCase().includes(needle) ||
        r.topQueries.some((x) => x.query.toLowerCase().includes(needle)),
    );
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
    <section className="mt-12">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-white font-display">Všetky URL a kľúčové slová</h2>
          <p className="text-xs text-zinc-400">
            {rows.length} URL z posledného snapshotu · klikni na riadok pre dopyty
          </p>
        </div>
        <div className="flex flex-wrap gap-2 text-sm">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Hľadať URL alebo dopyt…"
            className="rounded-lg border border-[#333333] bg-[#1a1a1a] px-3.5 py-1.5 text-xs text-[#f4f4f5] placeholder:text-zinc-500 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500/20"
          />
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as SortKey)}
            className="rounded-lg border border-[#333333] bg-[#1a1a1a] px-3 py-1.5 text-xs text-[#f4f4f5] focus:border-emerald-500"
          >
            <option value="decay" className="bg-[#1a1a1a]">
              Najväčší prepad
            </option>
            <option value="clicks" className="bg-[#1a1a1a]">
              Kliky
            </option>
            <option value="impressions" className="bg-[#1a1a1a]">
              Impresie
            </option>
            <option value="position" className="bg-[#1a1a1a]">
              Najlepšia pozícia
            </option>
            <option value="ctr" className="bg-[#1a1a1a]">
              Najnižší CTR
            </option>
          </select>
        </div>
      </div>
      <div className="mt-3 overflow-x-auto rounded-xl bg-[#1f1f1f] border border-[#2c2c2c] shadow-xl shadow-black/40">
        <table className="w-full min-w-[760px] text-xs">
          <thead className="bg-[#181818] text-zinc-400 border-b border-[#282828] text-[11px] uppercase tracking-wider font-semibold">
            <tr>
              <th className="px-3.5 py-2.5 text-left">URL / dopyt</th>
              <th className="px-2 text-right">Kliky</th>
              <th className="px-2 text-right">Impresie</th>
              <th className="px-2 text-right">CTR</th>
              <th className="px-2 text-right">Pozícia</th>
              <th className="px-2 text-right">Decay</th>
              <th className="px-3.5" />
            </tr>
          </thead>
          <tbody>
            {list.length === 0 && (
              <tr>
                <td colSpan={7} className="px-3.5 py-6 text-center text-zinc-400">
                  Nič sa nenašlo.
                </td>
              </tr>
            )}
            {list.map((r, rIdx) => {
              const isOpen = !!open[r.url];
              return (
                <Fragment key={`${r.url}-${rIdx}`}>
                  <tr
                    className="cursor-pointer border-t border-[#262626] hover:bg-[#252525] transition-colors"
                    onClick={() => setOpen((o) => ({ ...o, [r.url]: !isOpen }))}
                  >
                    <td className="max-w-[280px] px-3.5 py-2.5">
                      <span
                        className="flex items-center gap-1.5 truncate font-medium text-zinc-200"
                        title={r.url}
                      >
                        {isOpen ? (
                          <ChevronDown className="size-3.5 shrink-0 text-emerald-400" />
                        ) : (
                          <ChevronRight className="size-3.5 shrink-0 text-zinc-500" />
                        )}
                        {path(r.url)}
                      </span>
                    </td>
                    <td className="px-2 text-right text-zinc-200 tabular-nums">
                      {fmt(r.clicksNow)} <Delta value={r.clicksNow - r.clicksPrev} />
                    </td>
                    <td className="px-2 text-right text-zinc-300 tabular-nums">
                      {fmt(r.impressionsNow)}
                    </td>
                    <td className="px-2 text-right text-zinc-300 tabular-nums">
                      {ctrOf(r.clicksNow, r.impressionsNow).toFixed(1)} %
                    </td>
                    <td className="px-2 text-right text-zinc-300 tabular-nums">
                      {r.positionNow.toFixed(1)}{" "}
                      <Delta invert value={Number((r.positionNow - r.positionPrev).toFixed(1))} />
                    </td>
                    <td className="px-2 text-right font-mono text-zinc-300">{r.decayScore}</td>
                    <td className="px-3.5 py-2.5 text-right">
                      <Button
                        variant="studio"
                        size="studio"
                        onClick={(e) => {
                          e.stopPropagation();
                          refresh(r);
                        }}
                        className="inline-flex items-center gap-1.5 rounded-md bg-emerald-600 hover:bg-emerald-500 px-2.5 py-1 text-[11px] font-medium text-white transition-colors shadow-sm"
                      >
                        <FileText className="size-3" /> Aktualizovať článok
                      </Button>
                    </td>
                  </tr>
                  {isOpen &&
                    r.topQueries.map((x, xIdx) => (
                      <tr
                        key={`${r.url}-${x.query || "empty"}-${xIdx}`}
                        className="bg-[#161616]/90 text-zinc-300 border-t border-[#222222]"
                      >
                        <td className="py-2 pl-10 pr-3 font-mono text-[11px] text-zinc-400">
                          „{x.query}“
                        </td>
                        <td className="px-2 text-right tabular-nums">
                          {fmt(x.clicksNow)} <Delta value={x.clicksNow - x.clicksPrev} />
                        </td>
                        <td className="px-2 text-right text-zinc-500">—</td>
                        <td className="px-2 text-right text-zinc-500">—</td>
                        <td className="px-2 text-right tabular-nums">
                          {x.positionNow.toFixed(1)}{" "}
                          <Delta
                            invert
                            value={Number((x.positionNow - x.positionPrev).toFixed(1))}
                          />
                        </td>
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
const expectedCtr = (pos: number) =>
  pos <= 1 ? 28 : pos <= 2 ? 15 : pos <= 3 ? 11 : pos <= 5 ? 7 : pos <= 10 ? 3 : 1.2;

function CtrBooster({
  snap,
  onDeploy,
}: {
  snap: Snapshot;
  onDeploy?: (url: string, markdown?: string, currentTitle?: string) => void;
}) {
  const candidates = useMemo(() => {
    const raw = snap.raw_data?.rows ?? [];
    const seen = new Set<string>();
    const unique: ScoredDecayRow[] = [];
    for (const r of raw) {
      const u = r.url?.trim().toLowerCase();
      if (!u || seen.has(u)) continue;
      seen.add(u);
      unique.push(r);
    }

    return unique
      .filter((r) => r.impressionsNow >= 100 && r.positionNow <= 15)
      .map((r) => ({
        r,
        ctr: ctrOf(r.clicksNow, r.impressionsNow),
        exp: expectedCtr(r.positionNow),
      }))
      .filter((x) => x.ctr < x.exp)
      .sort((a, b) => b.r.impressionsNow * (b.exp - b.ctr) - a.r.impressionsNow * (a.exp - a.ctr))
      .slice(0, 8);
  }, [snap]);
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
      body: {
        url: r.url,
        title: r.title,
        queries: r.topQueries.map((q) => q.query).slice(0, 10),
        position: r.positionNow,
        ctr,
        impressions: r.impressionsNow,
      },
      onDelta: (c) => {
        buf += c;
        setOut(buf);
      },
      onDone: () => setBusy(false),
      onError: (m) => {
        setBusy(false);
        toast.error(m);
      },
    });
  };

  return (
    <section className="mt-12">
      <h2 className="flex items-center gap-2 text-lg font-bold text-white font-display">
        <Sparkles className="size-4 text-amber-400" /> CTR Booster
      </h2>
      <p className="text-xs text-zinc-400">
        Stránky, ktoré Google často zobrazuje, ale ľudia na ne klikajú menej, než je pri ich pozícii
        bežné.
      </p>
      {candidates.length === 0 ? (
        <p className="mt-3 rounded-xl bg-[#1f1f1f] border border-[#2c2c2c] p-5 text-sm text-zinc-400 shadow-xl shadow-black/40">
          Žiadne stránky s podpriemerným CTR. Výborné!
        </p>
      ) : (
        <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
          <ul className="divide-y divide-[#282828] rounded-xl bg-[#1f1f1f] border border-[#2c2c2c] shadow-xl shadow-black/40 overflow-hidden">
            {candidates.map(({ r, ctr, exp }, idx) => (
              <li
                key={`${r.url}-${idx}`}
                className={
                  "flex items-center justify-between gap-3 px-4 py-3.5 text-sm transition-colors hover:bg-[#252525] " +
                  (active === r.url ? "bg-[#282828] border-l-2 border-emerald-500" : "")
                }
              >
                <div className="min-w-0">
                  <p className="truncate font-semibold text-white" title={r.url}>
                    {path(r.url)}
                  </p>
                  <p className="text-xs text-zinc-400 mt-0.5">
                    poz.{" "}
                    <span className="text-zinc-200 font-medium">{r.positionNow.toFixed(1)}</span> ·{" "}
                    {fmt(r.impressionsNow)} impr. · CTR{" "}
                    <span className="text-rose-400 font-semibold">{ctr.toFixed(1)} %</span> (bežne ~
                    {exp} %)
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  <Button
                    variant="studio"
                    size="studio"
                    disabled={busy}
                    onClick={() => run(r, ctr)}
                    className="rounded-md bg-emerald-600 hover:bg-emerald-500 px-2.5 py-1.5 text-xs font-medium text-white disabled:opacity-50 transition-colors shadow-sm"
                  >
                    Navrhnúť title + popis
                  </Button>
                  {onDeploy && (
                    <Button
                      variant="studio"
                      size="studio"
                      onClick={() => onDeploy(r.url, "", r.title)}
                      className="rounded-md border border-[#383838] bg-[#222222] hover:bg-[#2a2a2a] p-1.5 text-emerald-400 transition-colors shadow-sm"
                      title="🚀 Nasadiť do WordPressu"
                    >
                      <Rocket className="size-3.5" />
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
          {/* Terminal Box for AI Output */}
          <div className="min-h-[220px] rounded-xl bg-[#141414] border border-[#2c2c2c] p-5 shadow-2xl shadow-black/60 flex flex-col justify-between">
            {!active ? (
              <div className="flex flex-col items-center justify-center py-12 text-center text-zinc-500">
                <Sparkles className="size-8 mb-2 text-zinc-600" />
                <p className="text-sm">
                  Vyber stránku vľavo a AI navrhne 3 varianty title a meta popisu.
                </p>
              </div>
            ) : (
              <>
                <div className="mb-3 flex items-center justify-between border-b border-[#282828] pb-3 text-xs">
                  <div className="flex items-center gap-2">
                    <span className="flex gap-1.5">
                      <span className="size-2.5 rounded-full bg-rose-500/80" />
                      <span className="size-2.5 rounded-full bg-amber-500/80" />
                      <span className="size-2.5 rounded-full bg-emerald-500/80" />
                    </span>
                    <span className="font-mono text-emerald-400 truncate max-w-[200px] sm:max-w-[280px]">
                      {path(active)}
                    </span>
                  </div>
                  {out && !busy && (
                    <div className="flex items-center gap-2">
                      <Button
                        variant="studio"
                        size="studio"
                        onClick={() => {
                          navigator.clipboard.writeText(out);
                          toast.success("Skopírované");
                        }}
                        className="inline-flex items-center gap-1 rounded-md border border-[#333333] bg-[#222222] px-2.5 py-1 text-xs text-zinc-300 hover:text-white hover:bg-[#2a2a2a] transition-colors"
                      >
                        <Copy className="size-3" /> Kopírovať
                      </Button>
                      {onDeploy && (
                        <Button
                          variant="studio"
                          size="studio"
                          onClick={() => onDeploy(active, out)}
                          className="inline-flex items-center gap-1 rounded-md bg-emerald-600 hover:bg-emerald-500 px-2.5 py-1 text-xs font-semibold text-white shadow-sm transition-colors"
                        >
                          <Rocket className="size-3" /> 🚀 Nasadiť na web
                        </Button>
                      )}
                    </div>
                  )}
                </div>
                {busy && !out && (
                  <div className="flex items-center gap-2 py-8 text-sm text-zinc-400">
                    <Loader2 className="size-4 animate-spin text-emerald-400" />
                    Generujem optimalizované návrhy…
                  </div>
                )}
                <div className="prose prose-invert prose-sm max-w-none font-mono text-xs text-[#e2e8f0] leading-relaxed">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{out}</ReactMarkdown>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
