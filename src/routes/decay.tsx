import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { toast } from "sonner";
import { Toaster } from "@/components/ui/sonner";
import {
  Activity,
  ArrowDown,
  ArrowDownRight,
  ArrowUpRight,
  Check,
  Copy,
  Minus,
  RotateCcw,
  Sparkles,
  Square,
  TrendingDown,
  X,
} from "lucide-react";
import { AppHeader } from "@/components/AppHeader";
import { useAuth } from "@/hooks/use-auth";
import { streamSSE } from "@/lib/stream-sse";
import { saveOutput } from "@/lib/outputs.functions";
import { supabase } from "@/integrations/supabase/client";
import {
  DECAY_LANGUAGES,
  DECAY_SCENARIOS,
  LANGUAGE_LABEL,
  SCENARIO_LABEL,
  STATUS_LABEL,
  type DecayDataset,
  type DecayLanguage,
  type DecayScenario,
  type DecayStatus,
  type ScoredDecayRow,
} from "@/lib/decay-schema";

export const Route = createFileRoute("/decay")({
  head: () => ({
    meta: [
      { title: "Decay Radar — nájdi klesajúci obsah | Písmo" },
      {
        name: "description",
        content:
          "Odhaľ stránky, ktoré strácajú organický traffic. Decay Radar analyzuje pokles kliknutí a pozícií a vygeneruje AI refresh plán. Funguje aj v demo režime.",
      },
      { property: "og:title", content: "Decay Radar — nájdi klesajúci obsah" },
      {
        property: "og:description",
        content:
          "Odhaľ stránky, ktoré strácajú organický traffic, a získaj AI refresh plán.",
      },
    ],
  }),
  component: DecayPage,
});

type Phase = "idle" | "analyzing" | "ready" | "error";

const STATUS_STYLE: Record<DecayStatus, string> = {
  critical: "bg-red-100 text-red-700",
  declining: "bg-amber-100 text-amber-700",
  stable: "bg-neutral-100 text-neutral-600",
  growing: "bg-emerald-100 text-emerald-700",
};

function pctBadge(pct: number) {
  if (pct <= -1)
    return (
      <span className="inline-flex items-center gap-1 text-red-600">
        <ArrowDownRight className="size-3.5" /> {pct}%
      </span>
    );
  if (pct >= 1)
    return (
      <span className="inline-flex items-center gap-1 text-emerald-600">
        <ArrowUpRight className="size-3.5" /> +{pct}%
      </span>
    );
  return (
    <span className="inline-flex items-center gap-1 text-neutral-500">
      <Minus className="size-3.5" /> {pct}%
    </span>
  );
}

function buildMarkdown(dataset: DecayDataset, row: ScoredDecayRow, plan: string) {
  const header = [
    `# Decay Radar — refresh plán`,
    ``,
    dataset.demo
      ? `> ⚠️ Analýza je založená na **demo dátach** (${dataset.scenarioLabel}). Pripoj Google Search Console pre reálnu analýzu.`
      : `> Analýza pre ${dataset.siteUrl}`,
    ``,
    `**URL:** ${row.url}`,
    `**Kliknutia:** ${row.clicksPrev} → ${row.clicksNow} (${row.clicksDeltaPct}%)`,
    `**Priemerná pozícia:** ${row.positionPrev.toFixed(1)} → ${row.positionNow.toFixed(1)}`,
    `**Decay skóre:** ${row.decayScore}/100`,
    ``,
    `---`,
    ``,
  ].join("\n");
  return header + plan;
}

function DecayPage() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const save = useServerFn(saveOutput);

  const [scenario, setScenario] = useState<DecayScenario>("blog");
  const [language, setLanguage] = useState<DecayLanguage>("sk");

  const [phase, setPhase] = useState<Phase>("idle");
  const [errorMsg, setErrorMsg] = useState("");
  const [dataset, setDataset] = useState<DecayDataset | null>(null);
  const [selected, setSelected] = useState<ScoredDecayRow | null>(null);

  const [plan, setPlan] = useState("");
  const [planLoading, setPlanLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!loading && !user)
      navigate({ to: "/login", search: { redirect: "/decay" } });
  }, [user, loading, navigate]);

  const analyze = async () => {
    setPhase("analyzing");
    setErrorMsg("");
    setDataset(null);
    setSelected(null);
    setPlan("");
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (session?.access_token)
        headers["Authorization"] = `Bearer ${session.access_token}`;

      const res = await fetch("/api/decay-analyze", {
        method: "POST",
        headers,
        body: JSON.stringify({ scenario }),
      });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        throw new Error(e.error ?? "Analýza zlyhala.");
      }
      const json = await res.json();
      setDataset(json.dataset as DecayDataset);
      setPhase("ready");
    } catch (e) {
      setErrorMsg((e as Error).message || "Analýza zlyhala.");
      setPhase("error");
    }
  };

  const openRow = (row: ScoredDecayRow) => {
    setSelected(row);
    setPlan("");
  };

  const stopPlan = () => {
    abortRef.current?.abort();
    setPlanLoading(false);
  };

  const generatePlan = async () => {
    if (!dataset || !selected) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setPlan("");
    setPlanLoading(true);

    let buffer = "";
    let raf = 0;
    const flush = () => {
      raf = 0;
      setPlan(buffer);
    };

    await streamSSE({
      url: "/api/decay-generate-plan",
      body: {
        demo: dataset.demo,
        scenario: dataset.scenario,
        language,
        siteUrl: dataset.siteUrl,
        row: selected,
      },
      signal: controller.signal,
      onDelta: (chunk) => {
        buffer += chunk;
        if (!raf) raf = requestAnimationFrame(flush);
      },
      onDone: async () => {
        if (raf) cancelAnimationFrame(raf);
        setPlan(buffer);
        setPlanLoading(false);
        try {
          await save({
            data: {
              type: "decay",
              title: `Decay refresh${dataset.demo ? " (demo)" : ""}: ${selected.url}`.slice(
                0,
                300,
              ),
              input: {
                demo: dataset.demo,
                scenario: dataset.scenario,
                siteUrl: dataset.siteUrl,
                url: selected.url,
                language,
              },
              output_markdown: buildMarkdown(dataset, selected, buffer),
            },
          });
        } catch (e) {
          console.error("save decay output:", e);
        }
      },
      onError: (msg) => {
        if (raf) cancelAnimationFrame(raf);
        setPlanLoading(false);
        if (buffer) {
          setPlan(buffer);
          toast.error(msg);
        } else {
          toast.error(msg);
        }
      },
    });
  };

  const copyPlan = async () => {
    if (!plan || !dataset || !selected) return;
    await navigator.clipboard.writeText(buildMarkdown(dataset, selected, plan));
    setCopied(true);
    toast.success("Skopírované");
    setTimeout(() => setCopied(false), 1500);
  };

  const exportPlan = () => {
    if (!plan || !dataset || !selected) return;
    const blob = new Blob([buildMarkdown(dataset, selected, plan)], {
      type: "text/markdown;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `pismo-decay-${Date.now()}.md`;
    a.click();
    URL.revokeObjectURL(url);
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
          {/* Hero / controls */}
          <div className="rounded-[20px] bg-neutral-900 p-1.5 shadow-xl">
            <div className="rounded-[15px] bg-white p-6 md:p-10">
              <div className="mb-6 flex items-center gap-3">
                <div className="flex size-10 items-center justify-center rounded-[10px] bg-neutral-900 text-neutral-50">
                  <TrendingDown className="size-5" />
                </div>
                <span className="rounded-full bg-neutral-100 px-3 py-1 text-[10px] font-medium tracking-widest text-neutral-500 uppercase">
                  Content Decay Radar
                </span>
              </div>

              <h1 className="mb-3 font-serif text-3xl md:text-5xl leading-tight text-balance text-neutral-950">
                Nájdi obsah, ktorý stráca traffic.
              </h1>
              <p className="mb-6 max-w-[60ch] text-base md:text-lg text-neutral-600 text-pretty">
                Decay Radar odhalí stránky s klesajúcimi kliknutiami a pozíciami
                a vygeneruje AI refresh plán na obnovu výkonu.
              </p>

              {/* Demo banner */}
              <div className="mb-6 flex items-start gap-3 rounded-[12px] bg-amber-50 p-4 ring-1 ring-amber-200">
                <Activity className="mt-0.5 size-5 shrink-0 text-amber-600" />
                <p className="text-sm text-amber-800">
                  You're viewing a demo dataset – connect Google Search Console
                  for real analysis. Demo dáta slúžia na onboarding a
                  testovanie; nikdy sa nemiešajú s reálnymi dátami.
                </p>
              </div>

              <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                <Field label="Demo scenár">
                  <select
                    value={scenario}
                    onChange={(e) => setScenario(e.target.value as DecayScenario)}
                    disabled={phase === "analyzing"}
                    className="w-full rounded-[10px] border border-neutral-200 bg-white px-3.5 py-2.5 text-sm focus:border-neutral-900 focus:outline-none disabled:opacity-60"
                  >
                    {DECAY_SCENARIOS.map((s) => (
                      <option key={s} value={s}>
                        {SCENARIO_LABEL[s]}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Jazyk výstupu">
                  <select
                    value={language}
                    onChange={(e) => setLanguage(e.target.value as DecayLanguage)}
                    className="w-full rounded-[10px] border border-neutral-200 bg-white px-3.5 py-2.5 text-sm focus:border-neutral-900 focus:outline-none disabled:opacity-60"
                  >
                    {DECAY_LANGUAGES.map((l) => (
                      <option key={l} value={l}>
                        {LANGUAGE_LABEL[l]}
                      </option>
                    ))}
                  </select>
                </Field>
                <div className="flex items-end">
                  <button
                    onClick={analyze}
                    disabled={phase === "analyzing"}
                    className="flex w-full items-center justify-center gap-2 rounded-[10px] bg-neutral-900 px-4 py-2.5 text-sm font-medium text-neutral-50 hover:bg-neutral-800 disabled:opacity-60"
                  >
                    <TrendingDown className="size-4" />
                    {phase === "analyzing" ? "Analyzujem…" : "Spustiť analýzu"}
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Error */}
          {phase === "error" && (
            <div className="mt-6 rounded-[14px] bg-red-50 p-5 ring-1 ring-red-200">
              <p className="text-sm font-medium text-red-800">Niečo sa pokazilo</p>
              <p className="mt-1 text-sm text-red-700">{errorMsg}</p>
              <button
                onClick={analyze}
                className="mt-3 inline-flex items-center gap-2 rounded-[8px] bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700"
              >
                <RotateCcw className="size-4" /> Skúsiť znova
              </button>
            </div>
          )}

          {/* Loading skeleton */}
          {phase === "analyzing" && (
            <div className="mt-6 space-y-2">
              {[1, 2, 3, 4].map((i) => (
                <div
                  key={i}
                  className="h-14 animate-pulse rounded-[12px] bg-white ring-1 ring-black/5"
                />
              ))}
            </div>
          )}

          {/* Decay table */}
          {phase === "ready" && dataset && (
            <div className="mt-6">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <h2 className="font-serif text-2xl">
                  {dataset.scenarioLabel} · {dataset.rows.length} URL
                </h2>
                {dataset.demo && (
                  <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-medium text-amber-700">
                    Demo dataset
                  </span>
                )}
              </div>

              <div className="overflow-x-auto rounded-[14px] bg-white ring-1 ring-black/5">
                <table className="w-full min-w-[720px] text-sm">
                  <thead>
                    <tr className="border-b border-neutral-100 text-left text-xs text-neutral-500">
                      <th className="px-4 py-3 font-medium">URL</th>
                      <th className="px-4 py-3 font-medium">Kliknutia</th>
                      <th className="px-4 py-3 font-medium">Δ</th>
                      <th className="px-4 py-3 font-medium">Pozícia</th>
                      <th className="px-4 py-3 font-medium">Decay</th>
                      <th className="px-4 py-3 font-medium">Stav</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dataset.rows.map((row) => (
                      <tr
                        key={row.url}
                        onClick={() => openRow(row)}
                        className="cursor-pointer border-b border-neutral-50 last:border-0 hover:bg-neutral-50"
                      >
                        <td className="max-w-[280px] px-4 py-3">
                          <p className="truncate font-medium text-neutral-900">
                            {row.title}
                          </p>
                          <p className="truncate text-xs text-neutral-400">
                            {row.url.replace(/^https?:\/\//, "")}
                          </p>
                        </td>
                        <td className="px-4 py-3 text-neutral-600">
                          {row.clicksPrev.toLocaleString("sk-SK")} →{" "}
                          {row.clicksNow.toLocaleString("sk-SK")}
                        </td>
                        <td className="px-4 py-3">{pctBadge(row.clicksDeltaPct)}</td>
                        <td className="px-4 py-3 text-neutral-600">
                          {row.positionPrev.toFixed(1)} → {row.positionNow.toFixed(1)}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <div className="h-1.5 w-16 overflow-hidden rounded-full bg-neutral-100">
                              <div
                                className={
                                  "h-full rounded-full " +
                                  (row.decayScore >= 55
                                    ? "bg-red-500"
                                    : row.decayScore >= 25
                                      ? "bg-amber-500"
                                      : "bg-emerald-500")
                                }
                                style={{ width: `${row.decayScore}%` }}
                              />
                            </div>
                            <span className="text-xs text-neutral-500">
                              {row.decayScore}
                            </span>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={
                              "rounded-full px-2.5 py-1 text-xs font-medium " +
                              STATUS_STYLE[row.status]
                            }
                          >
                            {STATUS_LABEL[row.status]}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </main>

      {/* URL detail panel */}
      {selected && dataset && (
        <div
          className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm"
          onClick={() => setSelected(null)}
        >
          <div
            className="absolute inset-y-0 right-0 w-full max-w-3xl overflow-y-auto bg-white shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-neutral-100 bg-white/95 px-6 py-4 backdrop-blur">
              <div className="min-w-0">
                <p className="text-xs text-neutral-400">
                  {STATUS_LABEL[selected.status]} · Decay {selected.decayScore}/100
                </p>
                <h2 className="truncate text-base font-medium">{selected.title}</h2>
              </div>
              <button
                onClick={() => setSelected(null)}
                className="flex size-8 shrink-0 items-center justify-center rounded-md text-neutral-500 hover:bg-neutral-100"
                aria-label="Zavrieť"
              >
                <X className="size-4" />
              </button>
            </div>

            <div className="space-y-6 px-6 py-6">
              {dataset.demo && (
                <div className="rounded-[10px] bg-amber-50 px-4 py-2.5 text-xs text-amber-800 ring-1 ring-amber-200">
                  Demo dáta — analýza nevychádza z reálneho Google Search Console.
                </div>
              )}

              <p className="break-all text-xs text-neutral-400">{selected.url}</p>

              {/* Metrics */}
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Metric label="Kliknutia" value={`${selected.clicksNow.toLocaleString("sk-SK")}`} sub={`z ${selected.clicksPrev.toLocaleString("sk-SK")}`} />
                <Metric label="Zmena" value={`${selected.clicksDeltaPct}%`} sub="kliknutia" />
                <Metric label="Pozícia" value={selected.positionNow.toFixed(1)} sub={`z ${selected.positionPrev.toFixed(1)}`} />
                <Metric label="Zobrazenia" value={selected.impressionsNow.toLocaleString("sk-SK")} sub={`z ${selected.impressionsPrev.toLocaleString("sk-SK")}`} />
              </div>

              {/* Query recovery map */}
              <div>
                <h3 className="mb-2 text-sm font-medium text-neutral-900">
                  Query recovery mapa
                </h3>
                <div className="overflow-hidden rounded-[12px] ring-1 ring-black/5">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-neutral-100 bg-neutral-50 text-left text-xs text-neutral-500">
                        <th className="px-3 py-2 font-medium">Query</th>
                        <th className="px-3 py-2 font-medium">Kliknutia</th>
                        <th className="px-3 py-2 font-medium">Pozícia</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selected.topQueries.map((q) => (
                        <tr key={q.query} className="border-b border-neutral-50 last:border-0">
                          <td className="px-3 py-2 text-neutral-800">{q.query}</td>
                          <td className="px-3 py-2 text-neutral-600">
                            {q.clicksPrev} → {q.clicksNow}
                          </td>
                          <td className="px-3 py-2 text-neutral-600">
                            {q.positionPrev.toFixed(1)} → {q.positionNow.toFixed(1)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* AI refresh plan */}
              <div>
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-sm font-medium text-neutral-900">
                    AI refresh plán
                  </h3>
                  <div className="flex gap-2">
                    {plan && (
                      <>
                        <button
                          onClick={copyPlan}
                          className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm text-neutral-600 hover:bg-neutral-100"
                        >
                          {copied ? <Check className="size-4" /> : <Copy className="size-4" />}{" "}
                          Kopírovať
                        </button>
                        <button
                          onClick={exportPlan}
                          className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm text-neutral-600 hover:bg-neutral-100"
                        >
                          <ArrowDown className="size-4" /> .md
                        </button>
                      </>
                    )}
                    {planLoading ? (
                      <button
                        onClick={stopPlan}
                        className="flex items-center gap-1.5 rounded-md bg-neutral-100 px-3 py-1.5 text-sm font-medium text-neutral-700 hover:bg-neutral-200"
                      >
                        <Square className="size-4" /> Zastaviť
                      </button>
                    ) : (
                      <button
                        onClick={generatePlan}
                        className="flex items-center gap-1.5 rounded-md bg-neutral-900 px-3 py-1.5 text-sm font-medium text-neutral-50 hover:bg-neutral-800"
                      >
                        <Sparkles className="size-4" />
                        {plan ? "Znovu vygenerovať" : "Vygenerovať plán"}
                      </button>
                    )}
                  </div>
                </div>

                {planLoading && !plan && (
                  <div className="space-y-3 rounded-[12px] bg-neutral-50 p-4">
                    <div className="h-4 w-1/3 animate-pulse rounded bg-neutral-200" />
                    <div className="h-4 w-full animate-pulse rounded bg-neutral-200" />
                    <div className="h-4 w-5/6 animate-pulse rounded bg-neutral-200" />
                  </div>
                )}

                {plan && (
                  <article className="prose prose-neutral max-w-none rounded-[12px] bg-neutral-50 p-4 prose-headings:font-serif prose-h2:text-lg prose-h2:mt-6 prose-p:text-neutral-700">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{plan}</ReactMarkdown>
                  </article>
                )}

                {!plan && !planLoading && (
                  <p className="rounded-[12px] bg-neutral-50 p-4 text-sm text-neutral-500">
                    Vygeneruj konkrétny plán na obnovu tejto stránky. Plán sa
                    automaticky uloží do Histórie.
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-medium text-neutral-600">
        {label}
      </span>
      {children}
    </label>
  );
}

function Metric({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub: string;
}) {
  return (
    <div className="rounded-[12px] bg-neutral-50 p-3">
      <p className="text-[11px] uppercase tracking-wide text-neutral-400">{label}</p>
      <p className="mt-1 text-lg font-semibold text-neutral-900">{value}</p>
      <p className="text-xs text-neutral-400">{sub}</p>
    </div>
  );
}
