import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useServerFn } from "@tanstack/react-start";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { toast } from "sonner";
import { Toaster } from "@/components/ui/sonner";
import {
  Activity,
  ArrowDown,
  Copy,
  Plug,
  RotateCcw,
  Square,
  TrendingDown,
  X,
} from "lucide-react";
import { AppHeader } from "@/components/AppHeader";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import { streamSSE } from "@/lib/stream-sse";
import { saveOutput } from "@/lib/outputs.functions";
import {
  ACTION_LABEL,
  DECAY_TYPE_LABEL,
  DEMO_SCENARIOS,
  LANGUAGE_LABEL,
  PRIORITY_LABEL,
  SCENARIO_LABEL,
  type DecayAnalysisResult,
  type DecayLanguage,
  type DecayMode,
  type DecayRow,
  type DecayWindow,
  type DemoScenario,
  type Priority,
} from "@/lib/decay-schema";
import type { GscSite, GscStatus } from "@/lib/gsc.server";

export const Route = createFileRoute("/decay")({
  head: () => ({
    meta: [
      { title: "Content Decay Radar — obnov upadajúci obsah | Písmo" },
      {
        name: "description",
        content:
          "Nájdi URL, ktoré strácajú organický traffic v Google Search Console, a vygeneruj praktický SEO refresh plán pre každú z nich.",
      },
      { property: "og:title", content: "Content Decay Radar — Písmo" },
      {
        property: "og:description",
        content:
          "Ktoré články strácajú kliky, impresie, CTR a pozície? Radar to nájde a navrhne refresh plán.",
      },
    ],
  }),
  component: DecayPage,
});

async function authedFetch(url: string, body: unknown, signal?: AbortSignal) {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (session?.access_token)
    headers["Authorization"] = `Bearer ${session.access_token}`;
  return fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal,
  });
}

function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium text-neutral-700">
        {label}
      </span>
      {children}
      {hint && <span className="mt-1 block text-xs text-neutral-400">{hint}</span>}
    </label>
  );
}

const PRIORITY_STYLE: Record<Priority, string> = {
  high: "bg-red-100 text-red-700",
  medium: "bg-amber-100 text-amber-700",
  low: "bg-neutral-100 text-neutral-600",
};

function pct(n: number) {
  return `${n >= 0 ? "+" : ""}${n.toFixed(0)}%`;
}
function deltaColor(n: number, goodWhenNegative = false) {
  const positive = goodWhenNegative ? n < 0 : n > 0;
  if (n === 0) return "text-neutral-500";
  return positive ? "text-emerald-600" : "text-red-600";
}

function DecayPage() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const save = useServerFn(saveOutput);

  // mode + connection
  const [mode, setMode] = useState<DecayMode>("demo");
  const [gscStatus, setGscStatus] = useState<GscStatus | "unknown" | "connecting">(
    "unknown",
  );
  const [sites, setSites] = useState<GscSite[]>([]);
  const [lastSync, setLastSync] = useState<string | null>(null);

  // form
  const [property, setProperty] = useState("");
  const [demoScenario, setDemoScenario] = useState<DemoScenario>("blog");
  const [window28, setWindow] = useState<DecayWindow>("28");
  const [minImpressions, setMinImpressions] = useState(50);
  const [urlContains, setUrlContains] = useState("");
  const [includeQueryLevel, setIncludeQueryLevel] = useState(true);
  const [language, setLanguage] = useState<DecayLanguage>("sk");

  // results
  const [analyzing, setAnalyzing] = useState(false);
  const [analysis, setAnalysis] = useState<DecayAnalysisResult | null>(null);
  const [selected, setSelected] = useState<DecayRow | null>(null);

  // ai plan
  const [planFor, setPlanFor] = useState<DecayRow | null>(null);
  const [plan, setPlan] = useState("");
  const [planStatus, setPlanStatus] = useState<"idle" | "streaming" | "done">(
    "idle",
  );
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!loading && !user)
      navigate({ to: "/login", search: { redirect: "/decay" } });
  }, [user, loading, navigate]);

  const checkConnection = async () => {
    setGscStatus("connecting");
    try {
      const res = await authedFetch("/api/decay/gsc-properties", {});
      if (!res.ok) {
        setGscStatus("reconnect");
        return;
      }
      const json = (await res.json()) as { status: GscStatus; sites: GscSite[] };
      setGscStatus(json.status);
      setSites(json.sites);
      if (json.status === "connected") {
        setLastSync(new Date().toISOString());
        if (json.sites[0] && !property) setProperty(json.sites[0].siteUrl);
        setMode("live");
      }
    } catch {
      setGscStatus("reconnect");
    }
  };

  const runAnalysis = async () => {
    if (mode === "live" && !property) {
      toast.error("Vyber GSC property.");
      return;
    }
    setAnalyzing(true);
    setAnalysis(null);
    setSelected(null);
    setPlanFor(null);
    setPlan("");
    setPlanStatus("idle");
    try {
      const res = await authedFetch("/api/decay/analyze", {
        mode,
        property: mode === "live" ? property : "",
        window: window28,
        minImpressions,
        urlContains,
        includeQueryLevel,
        language,
        demoScenario,
      });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        if (e.gscStatus) setGscStatus(e.gscStatus as GscStatus);
        throw new Error(e.error ?? "Analýza zlyhala.");
      }
      const json = (await res.json()) as { result: DecayAnalysisResult };
      setAnalysis(json.result);
      if (json.result.rows.length === 0)
        toast.info("Žiadne stránky nesplnili kritériá. Skús nižší prah impresií.");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setAnalyzing(false);
    }
  };

  const generatePlan = async (row: DecayRow) => {
    if (!analysis) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setPlanFor(row);
    setSelected(null);
    setPlan("");
    setPlanStatus("streaming");

    let buffer = "";
    let raf = 0;
    const flush = () => {
      raf = 0;
      setPlan(buffer);
    };

    await streamSSE({
      url: "/api/decay/generate-refresh-plan",
      body: {
        mode: analysis.mode,
        property: analysis.property,
        window: analysis.window,
        language,
        row,
      },
      signal: controller.signal,
      onDelta: (chunk) => {
        buffer += chunk;
        if (!raf) raf = requestAnimationFrame(flush);
      },
      onDone: async () => {
        if (raf) cancelAnimationFrame(raf);
        setPlan(buffer);
        setPlanStatus("done");
        try {
          await save({
            data: {
              type: "decay",
              title: `Content Decay Radar: ${row.url}`.slice(0, 300),
              input: {
                property: analysis.property,
                url: row.url,
                period: `${analysis.window}v${analysis.window}`,
                mode: analysis.mode,
                score: row.priority_score,
                lostClicks: Math.max(0, -row.clicks_delta),
                topQueries: row.top_lost_queries.map((q) => q.query).slice(0, 10),
              },
              output_markdown: buffer,
            },
          });
          toast.success("Uložené do histórie");
        } catch (e) {
          console.error("save decay output:", e);
        }
      },
      onError: (msg) => {
        if (raf) cancelAnimationFrame(raf);
        if (buffer) {
          setPlan(buffer);
          setPlanStatus("done");
          toast.error(msg);
        } else {
          setPlanStatus("idle");
          setPlanFor(null);
          toast.error(msg);
        }
      },
    });
  };

  const stopPlan = () => {
    abortRef.current?.abort();
    setPlanStatus(plan ? "done" : "idle");
  };

  const copyPlan = async () => {
    if (!plan) return;
    await navigator.clipboard.writeText(plan);
    toast.success("Skopírované");
  };
  const exportPlan = () => {
    if (!plan) return;
    const blob = new Blob([plan], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `pismo-decay-${Date.now()}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };
  const toBlogWriter = () => {
    if (!plan) return;
    sessionStorage.setItem("pismo:brief-context", plan);
    sessionStorage.setItem(
      "pismo:brief-topic",
      planFor ? `Refresh: ${planFor.url}` : "Decay refresh",
    );
    navigate({ to: "/", search: { fromBrief: "1" } as never });
  };
  const toBrief = () => {
    if (!planFor) return;
    sessionStorage.setItem("pismo:decay-brief-topic", planFor.url);
    navigate({ to: "/brief", search: { fromDecay: "1" } as never });
  };

  if (loading || !user) {
    return (
      <div className="min-h-screen bg-page-bg flex items-center justify-center text-sm text-neutral-500">
        Načítavam…
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-page-bg font-sans text-neutral-900">
      <Toaster />
      <AppHeader />

      <main className="px-6 pb-28">
        <div className="mx-auto max-w-screen-xl">
          {/* Hero */}
          <div className="rounded-[20px] bg-neutral-900 p-1.5 shadow-xl">
            <div className="rounded-[15px] bg-white p-6 md:p-10">
              <div className="mb-6 flex items-center gap-3">
                <div className="flex size-10 items-center justify-center rounded-[10px] bg-neutral-900 text-neutral-50">
                  <TrendingDown className="size-5" />
                </div>
                <span className="rounded-full bg-neutral-100 px-3 py-1 text-[10px] font-medium tracking-widest text-neutral-500 uppercase">
                  Content Decay Radar
                </span>
                {mode === "live" ? (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-100 px-3 py-1 text-[10px] font-semibold tracking-wide text-emerald-700 uppercase">
                    <Activity className="size-3" /> Live Data
                  </span>
                ) : (
                  <span className="rounded-full bg-amber-100 px-3 py-1 text-[10px] font-semibold tracking-wide text-amber-700 uppercase">
                    Demo Mode
                  </span>
                )}
              </div>

              <h1 className="mb-3 font-serif text-3xl md:text-5xl leading-tight text-balance text-neutral-950">
                Content Decay Radar
              </h1>
              <p className="mb-8 max-w-[62ch] text-base md:text-lg text-neutral-600 text-pretty">
                Nájdi články, ktoré kedysi ťahali traffic a dnes pomaly hnijú v
                SERPe.
              </p>

              <div className="flex flex-wrap gap-3">
                <button
                  onClick={checkConnection}
                  disabled={gscStatus === "connecting"}
                  className="inline-flex items-center gap-2 rounded-[10px] bg-neutral-900 px-4 py-2.5 text-sm font-medium text-neutral-50 hover:bg-neutral-800 disabled:opacity-60"
                >
                  <Plug className="size-4" />
                  {gscStatus === "connecting"
                    ? "Pripájam…"
                    : "Pripojiť Google Search Console"}
                </button>
                <button
                  onClick={runAnalysis}
                  disabled={analyzing}
                  className="inline-flex items-center gap-2 rounded-[10px] border border-neutral-300 px-4 py-2.5 text-sm font-medium text-neutral-800 hover:bg-neutral-50 disabled:opacity-60"
                >
                  {analyzing ? "Analyzujem…" : "Spustiť analýzu"}
                </button>
              </div>
            </div>
          </div>

          {/* Connection card */}
          <div className="mt-6 rounded-[16px] bg-white p-5 ring-1 ring-black/5">
            <ConnectionCard
              status={gscStatus}
              sites={sites}
              property={property}
              setProperty={setProperty}
              lastSync={lastSync}
              mode={mode}
              setMode={setMode}
            />
          </div>

          {/* Demo banner */}
          {mode === "demo" && (
            <div className="mt-4 rounded-[12px] border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
              Demo dataset – pripoj Google Search Console pre reálnu analýzu. Demo
              dáta nie sú reálne metriky.
            </div>
          )}

          {/* Analysis form */}
          <div className="mt-6 rounded-[16px] bg-white p-5 ring-1 ring-black/5 md:p-6">
            <h2 className="mb-4 text-sm font-semibold tracking-wide text-neutral-500 uppercase">
              Nastavenia analýzy
            </h2>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
              {mode === "demo" ? (
                <Field label="Demo scenár">
                  <select
                    value={demoScenario}
                    onChange={(e) =>
                      setDemoScenario(e.target.value as DemoScenario)
                    }
                    className="w-full rounded-[10px] border border-neutral-200 bg-white px-3.5 py-2.5 text-sm focus:border-neutral-900 focus:outline-none"
                  >
                    {DEMO_SCENARIOS.map((s) => (
                      <option key={s} value={s}>
                        {SCENARIO_LABEL[s]}
                      </option>
                    ))}
                  </select>
                </Field>
              ) : (
                <Field label="GSC property">
                  <select
                    value={property}
                    onChange={(e) => setProperty(e.target.value)}
                    className="w-full rounded-[10px] border border-neutral-200 bg-white px-3.5 py-2.5 text-sm focus:border-neutral-900 focus:outline-none"
                  >
                    {sites.length === 0 && <option value="">(žiadne)</option>}
                    {sites.map((s) => (
                      <option key={s.siteUrl} value={s.siteUrl}>
                        {s.siteUrl}
                      </option>
                    ))}
                  </select>
                </Field>
              )}

              <Field label="Porovnávacie okno">
                <select
                  value={window28}
                  onChange={(e) => setWindow(e.target.value as DecayWindow)}
                  className="w-full rounded-[10px] border border-neutral-200 bg-white px-3.5 py-2.5 text-sm focus:border-neutral-900 focus:outline-none"
                >
                  <option value="28">28 vs 28 dní</option>
                  <option value="90">90 vs 90 dní</option>
                </select>
              </Field>

              <Field label="Min. impresie" hint="Filtruje slabé stránky">
                <input
                  type="number"
                  min={0}
                  value={minImpressions}
                  onChange={(e) =>
                    setMinImpressions(Math.max(0, Number(e.target.value) || 0))
                  }
                  className="w-full rounded-[10px] border border-neutral-200 bg-white px-3.5 py-2.5 text-sm focus:border-neutral-900 focus:outline-none"
                />
              </Field>

              <Field label="URL obsahuje (voliteľné)">
                <input
                  value={urlContains}
                  onChange={(e) => setUrlContains(e.target.value)}
                  placeholder="/blog/"
                  maxLength={300}
                  className="w-full rounded-[10px] border border-neutral-200 bg-white px-3.5 py-2.5 text-sm focus:border-neutral-900 focus:outline-none"
                />
              </Field>

              <Field label="Jazyk výstupu">
                <select
                  value={language}
                  onChange={(e) => setLanguage(e.target.value as DecayLanguage)}
                  className="w-full rounded-[10px] border border-neutral-200 bg-white px-3.5 py-2.5 text-sm focus:border-neutral-900 focus:outline-none"
                >
                  {(["sk", "cs", "en"] as DecayLanguage[]).map((l) => (
                    <option key={l} value={l}>
                      {LANGUAGE_LABEL[l]}
                    </option>
                  ))}
                </select>
              </Field>

              <label className="flex items-center gap-2.5 self-end pb-2.5 text-sm text-neutral-700">
                <input
                  type="checkbox"
                  checked={includeQueryLevel}
                  onChange={(e) => setIncludeQueryLevel(e.target.checked)}
                  className="size-4 rounded border-neutral-300"
                />
                Analýza na úrovni queries
              </label>
            </div>

            <div className="mt-5">
              <button
                onClick={runAnalysis}
                disabled={analyzing}
                className="inline-flex items-center gap-2 rounded-[10px] bg-neutral-900 px-5 py-2.5 text-sm font-medium text-neutral-50 hover:bg-neutral-800 disabled:opacity-60"
              >
                {analyzing ? "Analyzujem…" : "Spustiť analýzu"}
              </button>
            </div>
          </div>

          {/* Results */}
          {analyzing && (
            <div className="mt-6 space-y-3">
              {[1, 2, 3].map((i) => (
                <div
                  key={i}
                  className="h-16 animate-pulse rounded-[12px] bg-white ring-1 ring-black/5"
                />
              ))}
            </div>
          )}

          {analysis && !analyzing && (
            <>
              <Summary analysis={analysis} />
              <DecayTable
                rows={analysis.rows}
                onSelect={setSelected}
                onGenerate={generatePlan}
              />
            </>
          )}

          {/* AI plan */}
          {planFor && (
            <div className="mt-8 rounded-[16px] bg-white p-5 ring-1 ring-black/5 md:p-8">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-xs tracking-wide text-neutral-400 uppercase">
                    AI Refresh plán
                  </p>
                  <h3 className="truncate font-serif text-xl text-neutral-900">
                    {planFor.url}
                  </h3>
                </div>
                <div className="flex flex-wrap gap-2">
                  {planStatus === "streaming" ? (
                    <button
                      onClick={stopPlan}
                      className="inline-flex items-center gap-1.5 rounded-md border border-neutral-300 px-3 py-1.5 text-sm text-neutral-700 hover:bg-neutral-50"
                    >
                      <Square className="size-4" /> Stop
                    </button>
                  ) : (
                    <>
                      <button
                        onClick={copyPlan}
                        disabled={!plan}
                        className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm text-neutral-600 hover:bg-neutral-100 disabled:opacity-50"
                      >
                        <Copy className="size-4" /> Kopírovať
                      </button>
                      <button
                        onClick={exportPlan}
                        disabled={!plan}
                        className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm text-neutral-600 hover:bg-neutral-100 disabled:opacity-50"
                      >
                        <ArrowDown className="size-4" /> .md
                      </button>
                      <button
                        onClick={toBlogWriter}
                        disabled={!plan}
                        className="inline-flex items-center gap-1.5 rounded-md border border-neutral-300 px-3 py-1.5 text-sm text-neutral-700 hover:bg-neutral-50 disabled:opacity-50"
                      >
                        Poslať do Blog Writera
                      </button>
                      <button
                        onClick={toBrief}
                        disabled={!plan}
                        className="inline-flex items-center gap-1.5 rounded-md border border-neutral-300 px-3 py-1.5 text-sm text-neutral-700 hover:bg-neutral-50 disabled:opacity-50"
                      >
                        Vytvoriť Brief
                      </button>
                      <button
                        onClick={() => generatePlan(planFor)}
                        className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm text-neutral-600 hover:bg-neutral-100"
                      >
                        <RotateCcw className="size-4" /> Znova
                      </button>
                    </>
                  )}
                </div>
              </div>
              {plan ? (
                <article className="prose prose-neutral max-w-[72ch] prose-headings:font-serif prose-h2:text-lg prose-h2:mt-8 prose-p:text-neutral-700">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{plan}</ReactMarkdown>
                </article>
              ) : (
                <p className="text-sm text-neutral-500">Generujem refresh plán…</p>
              )}
            </div>
          )}
        </div>
      </main>

      {/* URL detail drawer */}
      {selected && (
        <div
          className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm"
          onClick={() => setSelected(null)}
        >
          <div
            className="absolute inset-y-0 right-0 w-full max-w-xl overflow-y-auto bg-white shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-neutral-100 bg-white/95 px-6 py-4 backdrop-blur">
              <div className="min-w-0">
                <p className="text-xs text-neutral-400">
                  {DECAY_TYPE_LABEL[selected.decay_type]}
                </p>
                <h2 className="truncate text-sm font-medium">{selected.url}</h2>
              </div>
              <button
                onClick={() => setSelected(null)}
                className="flex size-8 items-center justify-center rounded-md text-neutral-500 hover:bg-neutral-100"
                aria-label="Zavrieť"
              >
                <X className="size-4" />
              </button>
            </div>
            <div className="space-y-6 px-6 py-6">
              <MetricGrid row={selected} />

              <div>
                <h3 className="mb-2 text-sm font-semibold text-neutral-700">
                  Odporúčaná akcia
                </h3>
                <span className="inline-block rounded-full bg-neutral-900 px-3 py-1 text-sm text-neutral-50">
                  {ACTION_LABEL[selected.recommended_action]}
                </span>
              </div>

              <QueryList
                title="Najviac stratené queries"
                rows={selected.top_lost_queries}
                empty="Žiadne výrazné straty na queries."
              />
              <QueryList
                title="Príležitostné queries (pozícia 4–20)"
                rows={selected.top_opportunity_queries}
                empty="Žiadne príležitostné queries."
                opportunity
              />

              <button
                onClick={() => generatePlan(selected)}
                className="w-full rounded-[10px] bg-neutral-900 px-4 py-2.5 text-sm font-medium text-neutral-50 hover:bg-neutral-800"
              >
                Vygenerovať refresh plán
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ConnectionCard({
  status,
  sites,
  property,
  setProperty,
  lastSync,
  mode,
  setMode,
}: {
  status: GscStatus | "unknown" | "connecting";
  sites: GscSite[];
  property: string;
  setProperty: (v: string) => void;
  lastSync: string | null;
  mode: DecayMode;
  setMode: (m: DecayMode) => void;
}) {
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-semibold tracking-wide text-neutral-500 uppercase">
          Google Search Console
        </h2>
        <div className="inline-flex rounded-full bg-neutral-100 p-1 text-xs">
          <button
            onClick={() => setMode("demo")}
            className={
              "rounded-full px-3 py-1 " +
              (mode === "demo" ? "bg-white shadow-sm" : "text-neutral-500")
            }
          >
            Demo
          </button>
          <button
            onClick={() => setMode("live")}
            disabled={status !== "connected"}
            className={
              "rounded-full px-3 py-1 disabled:opacity-40 " +
              (mode === "live" ? "bg-white shadow-sm" : "text-neutral-500")
            }
          >
            Live
          </button>
        </div>
      </div>

      {status === "unknown" && (
        <p className="text-sm text-neutral-500">
          Klikni na „Pripojiť Google Search Console" pre načítanie tvojich
          properties. Bez pripojenia funguje Demo mód.
        </p>
      )}
      {status === "connecting" && (
        <p className="text-sm text-neutral-500">Kontrolujem pripojenie…</p>
      )}
      {status === "not_connected" && (
        <p className="text-sm text-neutral-600">
          Google Search Console zatiaľ nie je pripojené. Pokračuj v Demo móde,
          alebo prepoj GSC connector v nastaveniach.
        </p>
      )}
      {status === "reconnect" && (
        <p className="text-sm text-red-600">
          Pripojenie vypršalo alebo zlyhalo. Skús prepojiť GSC connector znova.
        </p>
      )}
      {status === "permission_error" && (
        <p className="text-sm text-red-600">
          Nedostatočné oprávnenia pre toto GSC konto.
        </p>
      )}
      {status === "no_properties" && (
        <p className="text-sm text-neutral-600">
          Toto konto nemá žiadne overené Search Console properties.
        </p>
      )}
      {status === "connected" && (
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-sm text-emerald-700">
            <Activity className="size-4" /> Pripojené · {sites.length} properties
          </div>
          <Field label="Vyber property">
            <select
              value={property}
              onChange={(e) => setProperty(e.target.value)}
              className="w-full rounded-[10px] border border-neutral-200 bg-white px-3.5 py-2.5 text-sm focus:border-neutral-900 focus:outline-none"
            >
              {sites.map((s) => (
                <option key={s.siteUrl} value={s.siteUrl}>
                  {s.siteUrl} ({s.permissionLevel})
                </option>
              ))}
            </select>
          </Field>
          {lastSync && (
            <p className="text-xs text-neutral-400">
              Posledná synchronizácia:{" "}
              {new Date(lastSync).toLocaleString("sk-SK")}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function Summary({ analysis }: { analysis: DecayAnalysisResult }) {
  const s = analysis.summary;
  const cards = [
    { label: "Analyzované stránky", value: s.pages_analyzed },
    { label: "Stránky s poklesom", value: s.pages_with_decay },
    { label: "Stratené kliky (odhad)", value: s.estimated_lost_clicks },
    { label: "Kritické poklesy", value: s.critical_decay_count },
  ];
  return (
    <div className="mt-8">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {cards.map((c) => (
          <div
            key={c.label}
            className="rounded-[14px] bg-white p-4 ring-1 ring-black/5"
          >
            <p className="text-2xl font-semibold text-neutral-900">{c.value}</p>
            <p className="mt-1 text-xs text-neutral-500">{c.label}</p>
          </div>
        ))}
      </div>
      {s.highest_opportunity_url && (
        <p className="mt-3 text-sm text-neutral-500">
          Najväčšia príležitosť:{" "}
          <span className="text-neutral-800">{s.highest_opportunity_url}</span>
        </p>
      )}
    </div>
  );
}

function DecayTable({
  rows,
  onSelect,
  onGenerate,
}: {
  rows: DecayRow[];
  onSelect: (r: DecayRow) => void;
  onGenerate: (r: DecayRow) => void;
}) {
  if (rows.length === 0) return null;
  return (
    <div className="mt-6 overflow-hidden rounded-[16px] bg-white ring-1 ring-black/5">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[860px] text-sm">
          <thead>
            <tr className="border-b border-neutral-100 text-left text-xs tracking-wide text-neutral-400 uppercase">
              <th className="px-4 py-3 font-medium">URL</th>
              <th className="px-4 py-3 font-medium">Typ</th>
              <th className="px-4 py-3 font-medium">Kliky</th>
              <th className="px-4 py-3 font-medium">Impresie</th>
              <th className="px-4 py-3 font-medium">CTR</th>
              <th className="px-4 py-3 font-medium">Pozícia</th>
              <th className="px-4 py-3 font-medium">Priorita</th>
              <th className="px-4 py-3 font-medium"></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr
                key={r.url}
                className="border-b border-neutral-50 hover:bg-neutral-50/60"
              >
                <td className="max-w-[260px] px-4 py-3">
                  <button
                    onClick={() => onSelect(r)}
                    className="block truncate text-left text-neutral-800 hover:underline"
                    title={r.url}
                  >
                    {r.url.replace(/^https?:\/\//, "")}
                  </button>
                </td>
                <td className="px-4 py-3 text-neutral-600">
                  {DECAY_TYPE_LABEL[r.decay_type]}
                </td>
                <td className={"px-4 py-3 " + deltaColor(r.clicks_delta)}>
                  {r.clicks_delta} ({pct(r.clicks_delta_percent)})
                </td>
                <td className={"px-4 py-3 " + deltaColor(r.impressions_delta)}>
                  {pct(r.impressions_delta_percent)}
                </td>
                <td className={"px-4 py-3 " + deltaColor(r.ctr_delta)}>
                  {(r.ctr_delta * 100).toFixed(1)} pb
                </td>
                <td
                  className={"px-4 py-3 " + deltaColor(r.position_delta, true)}
                >
                  {r.position_delta > 0 ? "+" : ""}
                  {r.position_delta.toFixed(1)}
                </td>
                <td className="px-4 py-3">
                  <span
                    className={
                      "rounded-full px-2.5 py-0.5 text-xs font-medium " +
                      PRIORITY_STYLE[r.priority]
                    }
                  >
                    {PRIORITY_LABEL[r.priority]}
                  </span>
                </td>
                <td className="px-4 py-3 text-right">
                  <button
                    onClick={() => onGenerate(r)}
                    className="rounded-md bg-neutral-900 px-2.5 py-1.5 text-xs font-medium text-neutral-50 hover:bg-neutral-800"
                  >
                    Refresh plán
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function MetricGrid({ row }: { row: DecayRow }) {
  const items = [
    {
      label: "Kliky",
      prev: row.previous_clicks,
      cur: row.current_clicks,
      delta: deltaColor(row.clicks_delta),
      d: `${row.clicks_delta} (${pct(row.clicks_delta_percent)})`,
    },
    {
      label: "Impresie",
      prev: row.previous_impressions,
      cur: row.current_impressions,
      delta: deltaColor(row.impressions_delta),
      d: pct(row.impressions_delta_percent),
    },
    {
      label: "CTR",
      prev: `${(row.previous_ctr * 100).toFixed(2)}%`,
      cur: `${(row.current_ctr * 100).toFixed(2)}%`,
      delta: deltaColor(row.ctr_delta),
      d: `${(row.ctr_delta * 100).toFixed(2)} pb`,
    },
    {
      label: "Pozícia",
      prev: row.previous_position.toFixed(1),
      cur: row.current_position.toFixed(1),
      delta: deltaColor(row.position_delta, true),
      d: `${row.position_delta > 0 ? "+" : ""}${row.position_delta.toFixed(1)}`,
    },
  ];
  return (
    <div className="grid grid-cols-2 gap-3">
      {items.map((it) => (
        <div key={it.label} className="rounded-[12px] bg-neutral-50 p-3">
          <p className="text-xs text-neutral-400">{it.label}</p>
          <p className="mt-1 text-sm text-neutral-800">
            {it.prev} → <span className="font-semibold">{it.cur}</span>
          </p>
          <p className={"mt-0.5 text-xs " + it.delta}>{it.d}</p>
        </div>
      ))}
    </div>
  );
}

function QueryList({
  title,
  rows,
  empty,
  opportunity,
}: {
  title: string;
  rows: DecayRow["top_lost_queries"];
  empty: string;
  opportunity?: boolean;
}) {
  return (
    <div>
      <h3 className="mb-2 text-sm font-semibold text-neutral-700">{title}</h3>
      {rows.length === 0 ? (
        <p className="text-sm text-neutral-400">{empty}</p>
      ) : (
        <ul className="space-y-1.5">
          {rows.map((q) => (
            <li
              key={q.query}
              className="flex items-center justify-between gap-3 rounded-md bg-neutral-50 px-3 py-2 text-sm"
            >
              <span className="truncate text-neutral-700" title={q.query}>
                {q.query}
              </span>
              <span
                className={
                  "shrink-0 text-xs " +
                  (opportunity
                    ? "text-neutral-500"
                    : deltaColor(q.clicks_delta))
                }
              >
                {opportunity
                  ? `poz. ${q.current_position.toFixed(1)} · ${q.current_impressions} imp.`
                  : `${q.clicks_delta} klikov`}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
