import { Button } from "@/components/ui/button";
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
import { handoffToWriter } from "@/lib/refresh-handoff";
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
      { title: "Decay Radar — nájdi klesajúci obsah | SEO4WEB" },
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
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: DecayPage,
});

type Phase = "idle" | "analyzing" | "ready" | "error";

const STATUS_STYLE: Record<DecayStatus, string> = {
  critical: "bg-danger-subtle text-danger-foreground",
  declining: "bg-warning-subtle text-warning-foreground",
  stable: "bg-muted text-secondary-foreground",
  growing: "bg-success-subtle text-success-foreground",
};

function pctBadge(pct: number) {
  if (pct <= -1)
    return (
      <span className="inline-flex items-center gap-1 text-danger-foreground">
        <ArrowDownRight className="size-3.5" /> {pct}%
      </span>
    );
  if (pct >= 1)
    return (
      <span className="inline-flex items-center gap-1 text-success-foreground">
        <ArrowUpRight className="size-3.5" /> +{pct}%
      </span>
    );
  return (
    <span className="inline-flex items-center gap-1 text-muted-foreground">
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
  const [mode, setMode] = useState<"demo" | "live">("demo");
  const [gscStatus, setGscStatus] = useState<"loading" | "ok" | "unavailable">(
    "loading",
  );
  const [properties, setProperties] = useState<string[]>([]);
  const [siteUrl, setSiteUrl] = useState("");

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

  // Load verified Search Console properties (if the connector is available).
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();
        const res = await fetch("/api/decay-gsc-properties", {
          headers: session?.access_token
            ? { Authorization: `Bearer ${session.access_token}` }
            : {},
        });
        const json = await res.json().catch(() => ({}));
        if (cancelled) return;
        const list: string[] = (json.properties ?? []).map(
          (p: { siteUrl: string }) => p.siteUrl,
        );
        if (res.ok && json.status === "ok" && list.length > 0) {
          setProperties(list);
          setSiteUrl(list[0] ?? "");
          setGscStatus("ok");
        } else {
          setGscStatus("unavailable");
        }
      } catch {
        if (!cancelled) setGscStatus("unavailable");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user]);

  // Restore the latest saved live snapshot so results survive a refresh.
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("seo_snapshots")
        .select("raw_data")
        .eq("type", "decay")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (cancelled || !data?.raw_data) return;
      setDataset((prev) => prev ?? (data.raw_data as unknown as DecayDataset));
      setPhase((p) => (p === "idle" ? "ready" : p));
    })();
    return () => {
      cancelled = true;
    };
  }, [user]);

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
        body: JSON.stringify(
          mode === "live" ? { mode, scenario, siteUrl } : { mode: "demo", scenario },
        ),
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
    a.download = `seo4web-decay-${Date.now()}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (loading || !user) {
    return (
      <div className="min-h-screen bg-page-bg flex items-center justify-center text-sm text-muted-foreground">
        Načítavam…
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-page-bg font-sans text-foreground">
      <Toaster />
      <AppHeader />

      <main className="px-6 pb-28">
        <div className="mx-auto max-w-screen-xl">
          {/* Hero / controls */}
          <div className="tool-workspace">
            <div className="py-6 md:py-8">
              <div className="mb-6 flex items-center gap-3">
                <div className="flex size-10 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                  <TrendingDown className="size-5" />
                </div>
                <span className="rounded-full bg-muted px-3 py-1 text-[10px] font-medium tracking-normalst text-muted-foreground uppercase">
                  Content Decay Radar
                </span>
              </div>

              <h1 className="mb-3 font-display text-3xl md:text-5xl leading-tight text-balance text-foreground">
                Nájdi obsah, ktorý stráca traffic.
              </h1>
              <p className="mb-6 max-w-[60ch] text-base md:text-lg text-secondary-foreground text-pretty">
                Decay Radar odhalí stránky s klesajúcimi kliknutiami a pozíciami
                a vygeneruje AI refresh plán na obnovu výkonu.
              </p>

              {/* Mode switch */}
              <div className="mb-5 inline-flex rounded-lg bg-muted p-1">
                {(["demo", "live"] as const).map((m) => (
                  <Button variant="studio" size="studio"
                    key={m}
                    onClick={() => setMode(m)}
                    disabled={m === "live" && gscStatus !== "ok"}
                    className={
                      "rounded-[8px] px-4 py-1.5 text-sm font-medium transition disabled:opacity-40 " +
                      (mode === m
                        ? "bg-card text-foreground shadow-sm"
                        : "text-muted-foreground hover:text-foreground")
                    }
                  >
                    {m === "demo" ? "Demo dáta" : "Search Console (live)"}
                  </Button>
                ))}
              </div>

              {mode === "demo" ? (
                <div className="mb-6 flex items-start gap-3 rounded-lg bg-warning-subtle p-4 ring-1 ring-warning-border">
                  <Activity className="mt-0.5 size-5 shrink-0 text-warning-foreground" />
                  <p className="text-sm text-warning-foreground">
                    You're viewing a demo dataset – connect Google Search Console
                    for real analysis.{" "}
                    {gscStatus === "unavailable" &&
                      "Search Console zatiaľ nie je pripojený, preto je dostupný len demo režim. "}
                    Demo dáta sa nikdy nemiešajú s reálnymi dátami.
                  </p>
                </div>
              ) : (
                <div className="mb-6 flex items-start gap-3 rounded-lg bg-success-subtle p-4 ring-1 ring-success-border">
                  <Activity className="mt-0.5 size-5 shrink-0 text-success-foreground" />
                  <p className="text-sm text-success-foreground">
                    Reálne dáta z Google Search Console — porovnanie posledných 90
                    dní s predchádzajúcimi 90 dňami.
                  </p>
                </div>
              )}

              <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                {mode === "demo" ? (
                  <Field label="Demo scenár">
                    <select
                      value={scenario}
                      onChange={(e) => setScenario(e.target.value as DecayScenario)}
                      disabled={phase === "analyzing"}
                      className="w-full rounded-lg border border-border bg-card px-3.5 py-2.5 text-sm focus:border-border focus:outline-none disabled:opacity-60"
                    >
                      {DECAY_SCENARIOS.map((s) => (
                        <option key={s} value={s}>
                          {SCENARIO_LABEL[s]}
                        </option>
                      ))}
                    </select>
                  </Field>
                ) : (
                  <Field label="Search Console property">
                    <select
                      value={siteUrl}
                      onChange={(e) => setSiteUrl(e.target.value)}
                      disabled={phase === "analyzing"}
                      className="w-full rounded-lg border border-border bg-card px-3.5 py-2.5 text-sm focus:border-border focus:outline-none disabled:opacity-60"
                    >
                      {properties.map((p) => (
                        <option key={p} value={p}>
                          {p}
                        </option>
                      ))}
                    </select>
                  </Field>
                )}
                <Field label="Jazyk výstupu">
                  <select
                    value={language}
                    onChange={(e) => setLanguage(e.target.value as DecayLanguage)}
                    className="w-full rounded-lg border border-border bg-card px-3.5 py-2.5 text-sm focus:border-border focus:outline-none disabled:opacity-60"
                  >
                    {DECAY_LANGUAGES.map((l) => (
                      <option key={l} value={l}>
                        {LANGUAGE_LABEL[l]}
                      </option>
                    ))}
                  </select>
                </Field>
                <div className="flex items-end">
                  <Button variant="studio" size="studio"
                    onClick={analyze}
                    disabled={phase === "analyzing"}
                    className="flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary disabled:opacity-60"
                  >
                    <TrendingDown className="size-4" />
                    {phase === "analyzing" ? "Analyzujem…" : "Spustiť analýzu"}
                  </Button>
                </div>
              </div>
            </div>
          </div>

          {/* Error */}
          {phase === "error" && (
            <div className="mt-6 rounded-lg bg-danger-subtle p-5 ring-1 ring-danger-border">
              <p className="text-sm font-medium text-danger-foreground">Niečo sa pokazilo</p>
              <p className="mt-1 text-sm text-danger-foreground">{errorMsg}</p>
              <Button variant="studio" size="studio"
                onClick={analyze}
                className="mt-3 inline-flex items-center gap-2 rounded-[8px] bg-danger px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-danger"
              >
                <RotateCcw className="size-4" /> Skúsiť znova
              </Button>
            </div>
          )}

          {/* Loading skeleton */}
          {phase === "analyzing" && (
            <div className="mt-6 space-y-2">
              {[1, 2, 3, 4].map((i) => (
                <div
                  key={i}
                  className="h-14 animate-pulse rounded-lg bg-card ring-1 ring-border/5"
                />
              ))}
            </div>
          )}

          {/* Decay table */}
          {phase === "ready" && dataset && (
            <div className="mt-6">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <h2 className="font-display text-2xl">
                  {dataset.scenarioLabel} · {dataset.rows.length} URL
                </h2>
                {dataset.demo && (
                  <span className="rounded-full bg-warning-subtle px-3 py-1 text-xs font-medium text-warning-foreground">
                    Demo dataset
                  </span>
                )}
              </div>

              <div className="overflow-x-auto rounded-lg bg-card ring-1 ring-border/5">
                <table className="w-full min-w-[720px] text-sm">
                  <thead>
                    <tr className="border-b border-border text-left text-xs text-muted-foreground">
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
                        className="cursor-pointer border-b border-border last:border-0 hover:bg-background"
                      >
                        <td className="max-w-[280px] px-4 py-3">
                          <p className="truncate font-medium text-foreground">
                            {row.title}
                          </p>
                          <p className="truncate text-xs text-muted-foreground">
                            {row.url.replace(/^https?:\/\//, "")}
                          </p>
                        </td>
                        <td className="px-4 py-3 text-secondary-foreground">
                          {row.clicksPrev.toLocaleString("sk-SK")} →{" "}
                          {row.clicksNow.toLocaleString("sk-SK")}
                        </td>
                        <td className="px-4 py-3">{pctBadge(row.clicksDeltaPct)}</td>
                        <td className="px-4 py-3 text-secondary-foreground">
                          {row.positionPrev.toFixed(1)} → {row.positionNow.toFixed(1)}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <div className="h-1.5 w-16 overflow-hidden rounded-full bg-muted">
                              <div
                                className={
                                  "h-full rounded-full " +
                                  (row.decayScore >= 55
                                    ? "bg-danger"
                                    : row.decayScore >= 25
                                      ? "bg-warning"
                                      : "bg-success")
                                }
                                style={{ width: `${row.decayScore}%` }}
                              />
                            </div>
                            <span className="text-xs text-muted-foreground">
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
          className="fixed inset-0 z-50 bg-overlay/40 backdrop-blur-sm"
          onClick={() => setSelected(null)}
        >
          <div
            className="absolute inset-y-0 right-0 w-full max-w-3xl overflow-y-auto bg-card shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-border bg-card/95 px-6 py-4 backdrop-blur">
              <div className="min-w-0">
                <p className="text-xs text-muted-foreground">
                  {STATUS_LABEL[selected.status]} · Decay {selected.decayScore}/100
                </p>
                <h2 className="truncate text-base font-medium">{selected.title}</h2>
              </div>
              <Button variant="studio" size="studio"
                onClick={() => setSelected(null)}
                className="flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted"
                aria-label="Zavrieť"
              >
                <X className="size-4" />
              </Button>
            </div>

            <div className="space-y-6 px-6 py-6">
              {dataset.demo && (
                <div className="rounded-lg bg-warning-subtle px-4 py-2.5 text-xs text-warning-foreground ring-1 ring-warning-border">
                  Demo dáta — analýza nevychádza z reálneho Google Search Console.
                </div>
              )}

              <p className="break-all text-xs text-muted-foreground">{selected.url}</p>
              <Button variant="studio" size="studio"
                onClick={() => {
                  handoffToWriter(dataset.siteUrl, selected);
                  window.location.href = "/?fromRefresh=1";
                }}
                className="inline-flex items-center gap-1.5 rounded-[8px] bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground"
              >
                <Sparkles className="size-3.5" /> Vygenerovať aktualizovaný článok v Blog Writeri
              </Button>

              {/* Metrics */}
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Metric label="Kliknutia" value={`${selected.clicksNow.toLocaleString("sk-SK")}`} sub={`z ${selected.clicksPrev.toLocaleString("sk-SK")}`} />
                <Metric label="Zmena" value={`${selected.clicksDeltaPct}%`} sub="kliknutia" />
                <Metric label="Pozícia" value={selected.positionNow.toFixed(1)} sub={`z ${selected.positionPrev.toFixed(1)}`} />
                <Metric label="Zobrazenia" value={selected.impressionsNow.toLocaleString("sk-SK")} sub={`z ${selected.impressionsPrev.toLocaleString("sk-SK")}`} />
              </div>

              {/* Query recovery map */}
              <div>
                <h3 className="mb-2 text-sm font-medium text-foreground">
                  Query recovery mapa
                </h3>
                <div className="overflow-hidden rounded-lg ring-1 ring-border/5">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border bg-background text-left text-xs text-muted-foreground">
                        <th className="px-3 py-2 font-medium">Query</th>
                        <th className="px-3 py-2 font-medium">Kliknutia</th>
                        <th className="px-3 py-2 font-medium">Pozícia</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selected.topQueries.map((q) => (
                        <tr key={q.query} className="border-b border-border last:border-0">
                          <td className="px-3 py-2 text-foreground">{q.query}</td>
                          <td className="px-3 py-2 text-secondary-foreground">
                            {q.clicksPrev} → {q.clicksNow}
                          </td>
                          <td className="px-3 py-2 text-secondary-foreground">
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
                  <h3 className="text-sm font-medium text-foreground">
                    AI refresh plán
                  </h3>
                  <div className="flex gap-2">
                    {plan && (
                      <>
                        <Button variant="studio" size="studio"
                          onClick={copyPlan}
                          className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm text-secondary-foreground hover:bg-muted"
                        >
                          {copied ? <Check className="size-4" /> : <Copy className="size-4" />}{" "}
                          Kopírovať
                        </Button>
                        <Button variant="studio" size="studio"
                          onClick={exportPlan}
                          className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm text-secondary-foreground hover:bg-muted"
                        >
                          <ArrowDown className="size-4" /> .md
                        </Button>
                      </>
                    )}
                    {planLoading ? (
                      <Button variant="studio" size="studio"
                        onClick={stopPlan}
                        className="flex items-center gap-1.5 rounded-md bg-muted px-3 py-1.5 text-sm font-medium text-secondary-foreground hover:bg-border"
                      >
                        <Square className="size-4" /> Zastaviť
                      </Button>
                    ) : (
                      <Button variant="studio" size="studio"
                        onClick={generatePlan}
                        className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary"
                      >
                        <Sparkles className="size-4" />
                        {plan ? "Znovu vygenerovať" : "Vygenerovať plán"}
                      </Button>
                    )}
                  </div>
                </div>

                {planLoading && !plan && (
                  <div className="space-y-3 rounded-lg bg-background p-4">
                    <div className="h-4 w-1/3 animate-pulse rounded bg-border" />
                    <div className="h-4 w-full animate-pulse rounded bg-border" />
                    <div className="h-4 w-5/6 animate-pulse rounded bg-border" />
                  </div>
                )}

                {plan && (
                  <article className="prose prose-neutral max-w-none rounded-lg bg-background p-4 prose-headings:font-display prose-h2:text-lg prose-h2:mt-6 prose-p:text-secondary-foreground">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{plan}</ReactMarkdown>
                  </article>
                )}

                {!plan && !planLoading && (
                  <p className="rounded-lg bg-background p-4 text-sm text-muted-foreground">
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
      <span className="mb-1.5 block text-xs font-medium text-secondary-foreground">
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
    <div className="rounded-lg bg-background p-3">
      <p className="text-[11px] uppercase tracking-normal text-muted-foreground">{label}</p>
      <p className="mt-1 text-lg font-semibold text-foreground">{value}</p>
      <p className="text-xs text-muted-foreground">{sub}</p>
    </div>
  );
}
