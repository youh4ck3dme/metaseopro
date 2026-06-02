import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { toast } from "sonner";
import { Toaster } from "@/components/ui/sonner";
import {
  ArrowDown,
  Check,
  Copy,
  Rocket,
  RotateCcw,
  Square,
} from "lucide-react";
import { AppHeader } from "@/components/AppHeader";
import { useAuth } from "@/hooks/use-auth";
import { streamSSE } from "@/lib/stream-sse";
import { saveOutput } from "@/lib/outputs.functions";
import { supabase } from "@/integrations/supabase/client";
import {
  LANGUAGE_LABEL,
  OUTPUT_LABEL,
  OUTPUT_LABEL as _OUTPUT_LABEL,
  RAKETA_LANGUAGES,
  RAKETA_OUTPUTS,
  RaketaFormSchema,
  type RaketaAnalysis,
  type RaketaLanguage,
  type RaketaOutput,
} from "@/lib/raketa-schema";

export const Route = createFileRoute("/raketa")({
  head: () => ({
    meta: [
      { title: "SEO Raketa — automatický SEO workflow | Písmo" },
      {
        name: "description",
        content:
          "Zadaj web a konkurenciu. Písmo zanalyzuje obsah, nájde SEO medzery a vygeneruje audit, článok, brief alebo 30-dňový content plán.",
      },
      { property: "og:title", content: "SEO Raketa — automatický SEO workflow" },
      {
        property: "og:description",
        content:
          "Analyzuj vlastný web, konkurenciu alebo oboje. Výstup: audit, článok, brief alebo content plán.",
      },
    ],
  }),
  component: RaketaPage,
});

type Phase =
  | "idle"
  | "validating"
  | "scanning"
  | "comparing"
  | "generating"
  | "ready"
  | "error";

const PHASE_STEPS: { key: Phase; label: string }[] = [
  { key: "validating", label: "Validujem" },
  { key: "scanning", label: "Skenujem" },
  { key: "comparing", label: "Porovnávam" },
  { key: "generating", label: "Generujem" },
  { key: "ready", label: "Hotovo" },
];

type Section = { heading: string; body: string };

function splitSections(markdown: string): Section[] {
  const lines = markdown.split("\n");
  const sections: Section[] = [];
  let current: Section | null = null;
  for (const line of lines) {
    const m = /^##\s+(.*)$/.exec(line);
    if (m) {
      if (current) sections.push(current);
      current = { heading: m[1].trim(), body: "" };
    } else if (current) {
      current.body += line + "\n";
    } else {
      // preamble before first heading
      current = { heading: "Úvod", body: line + "\n" };
    }
  }
  if (current) sections.push(current);
  return sections.filter((s) => s.body.trim().length > 0 || s.heading);
}

function RaketaPage() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const save = useServerFn(saveOutput);

  const [ownUrl, setOwnUrl] = useState("");
  const [competitorUrl, setCompetitorUrl] = useState("");
  const [keyword, setKeyword] = useState("");
  const [language, setLanguage] = useState<RaketaLanguage>("sk");
  const [output, setOutput] = useState<RaketaOutput>("audit");

  const [phase, setPhase] = useState<Phase>("idle");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [errorMsg, setErrorMsg] = useState<string>("");
  const [analysis, setAnalysis] = useState<RaketaAnalysis | null>(null);
  const [result, setResult] = useState("");
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!loading && !user)
      navigate({ to: "/login", search: { redirect: "/raketa" } });
  }, [user, loading, navigate]);

  const running =
    phase === "validating" ||
    phase === "scanning" ||
    phase === "comparing" ||
    phase === "generating";

  const copyText = async (text: string, key: string) => {
    if (!text) return;
    await navigator.clipboard.writeText(text);
    setCopiedKey(key);
    toast.success("Skopírované");
    setTimeout(() => setCopiedKey((k) => (k === key ? null : k)), 1500);
  };

  const exportMarkdown = () => {
    if (!result) return;
    const blob = new Blob([result], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `pismo-raketa-${output}-${Date.now()}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const reset = () => {
    abortRef.current?.abort();
    setPhase("idle");
    setAnalysis(null);
    setResult("");
    setErrorMsg("");
  };

  const stop = () => {
    abortRef.current?.abort();
    setPhase(result ? "ready" : "idle");
  };

  const launch = async () => {
    setErrors({});
    setErrorMsg("");
    const parsed = RaketaFormSchema.safeParse({
      ownUrl,
      competitorUrl,
      keyword,
      language,
      output,
    });
    if (!parsed.success) {
      const fieldErrors: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const path = issue.path[0];
        if (typeof path === "string" && !fieldErrors[path])
          fieldErrors[path] = issue.message;
      }
      setErrors(fieldErrors);
      setPhase("validating");
      setTimeout(() => setPhase("idle"), 400);
      toast.error("Skontroluj zadané polia.");
      return;
    }

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setResult("");
    setAnalysis(null);
    setPhase("validating");

    // STEP 1 + 2: analyze (validate + scan + compare)
    let analysisData: RaketaAnalysis;
    try {
      setPhase("scanning");
      const { data: { session } } = await supabase.auth.getSession();
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (session?.access_token)
        headers["Authorization"] = `Bearer ${session.access_token}`;

      const res = await fetch("/api/raketa-analyze", {
        method: "POST",
        headers,
        body: JSON.stringify({
          ownUrl: parsed.data.ownUrl,
          competitorUrl: parsed.data.competitorUrl,
          keyword: parsed.data.keyword,
        }),
        signal: controller.signal,
      });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        throw new Error(e.error ?? "Analýza webu zlyhala.");
      }
      const json = await res.json();
      analysisData = json.analysis as RaketaAnalysis;
      setAnalysis(analysisData);
      setPhase("comparing");
      // brief pause so the user sees the comparing state
      await new Promise((r) => setTimeout(r, 400));
    } catch (e) {
      if ((e as Error).name === "AbortError") return;
      setErrorMsg((e as Error).message || "Analýza webu zlyhala.");
      setPhase("error");
      return;
    }

    // STEP 3 + 4: generate output (streamed)
    setPhase("generating");
    let buffer = "";
    let raf = 0;
    const flush = () => {
      raf = 0;
      setResult(buffer);
    };

    await streamSSE({
      url: "/api/raketa-generate",
      body: {
        keyword: parsed.data.keyword,
        language: parsed.data.language,
        output: parsed.data.output,
        analysis: analysisData,
      },
      signal: controller.signal,
      onDelta: (chunk) => {
        buffer += chunk;
        if (!raf) raf = requestAnimationFrame(flush);
      },
      onDone: async () => {
        if (raf) cancelAnimationFrame(raf);
        setResult(buffer);
        setPhase("ready");
        // STEP 5: save to history
        try {
          await save({
            data: {
              type: "raketa",
              title: `${OUTPUT_LABEL[parsed.data.output]}: ${parsed.data.keyword}`.slice(
                0,
                300,
              ),
              input: {
                ownUrl: parsed.data.ownUrl,
                competitorUrl: parsed.data.competitorUrl,
                keyword: parsed.data.keyword,
                language: parsed.data.language,
                output: parsed.data.output,
              },
              output_markdown: buffer,
            },
          });
        } catch (e) {
          console.error("save raketa output:", e);
        }
      },
      onError: (msg) => {
        if (raf) cancelAnimationFrame(raf);
        if (buffer) {
          setResult(buffer);
          setPhase("ready");
          toast.error(msg);
        } else {
          setErrorMsg(msg);
          setPhase("error");
        }
      },
    });
  };

  const sections = useMemo(
    () => (phase === "ready" ? splitSections(result) : []),
    [phase, result],
  );

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
          {/* Hero input card */}
          <div className="rounded-[20px] bg-neutral-900 p-1.5 shadow-xl">
            <div className="rounded-[15px] bg-white p-6 md:p-10">
              <div className="mb-6 flex items-center gap-3">
                <div className="flex size-10 items-center justify-center rounded-[10px] bg-neutral-900 text-neutral-50">
                  <Rocket className="size-5" />
                </div>
                <span className="rounded-full bg-neutral-100 px-3 py-1 text-[10px] font-medium tracking-widest text-neutral-500 uppercase">
                  Automatický SEO workflow
                </span>
              </div>

              <h1 className="mb-3 font-serif text-3xl md:text-5xl leading-tight text-balance text-neutral-950">
                Zadaj web. My odpálime SEO raketu.
              </h1>
              <p className="mb-8 max-w-[60ch] text-base md:text-lg text-neutral-600 text-pretty">
                Analyzuj vlastný web, konkurenciu alebo oboje. Výstup: audit,
                článok, brief alebo content plán.
              </p>

              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <Field label="Tvoja URL" error={errors.ownUrl} required>
                  <input
                    value={ownUrl}
                    onChange={(e) => setOwnUrl(e.target.value)}
                    disabled={running}
                    placeholder="https://tvojweb.sk"
                    className="w-full rounded-[10px] border border-neutral-200 bg-white px-3.5 py-2.5 text-sm focus:border-neutral-900 focus:outline-none disabled:opacity-60"
                  />
                </Field>
                <Field label="URL konkurencie (voliteľné)" error={errors.competitorUrl}>
                  <input
                    value={competitorUrl}
                    onChange={(e) => setCompetitorUrl(e.target.value)}
                    disabled={running}
                    placeholder="https://konkurencia.sk"
                    className="w-full rounded-[10px] border border-neutral-200 bg-white px-3.5 py-2.5 text-sm focus:border-neutral-900 focus:outline-none disabled:opacity-60"
                  />
                </Field>
                <Field label="Cieľový keyword / téma" error={errors.keyword} required>
                  <input
                    value={keyword}
                    onChange={(e) => setKeyword(e.target.value)}
                    disabled={running}
                    maxLength={200}
                    placeholder="napr. lokálne SEO Bratislava"
                    className="w-full rounded-[10px] border border-neutral-200 bg-white px-3.5 py-2.5 text-sm focus:border-neutral-900 focus:outline-none disabled:opacity-60"
                  />
                </Field>
                <Field label="Jazyk">
                  <select
                    value={language}
                    onChange={(e) => setLanguage(e.target.value as RaketaLanguage)}
                    disabled={running}
                    className="w-full rounded-[10px] border border-neutral-200 bg-white px-3.5 py-2.5 text-sm focus:border-neutral-900 focus:outline-none disabled:opacity-60"
                  >
                    {RAKETA_LANGUAGES.map((l) => (
                      <option key={l} value={l}>
                        {LANGUAGE_LABEL[l]}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Cieľ / typ výstupu">
                  <select
                    value={output}
                    onChange={(e) => setOutput(e.target.value as RaketaOutput)}
                    disabled={running}
                    className="w-full rounded-[10px] border border-neutral-200 bg-white px-3.5 py-2.5 text-sm focus:border-neutral-900 focus:outline-none disabled:opacity-60 md:col-span-1"
                  >
                    {RAKETA_OUTPUTS.map((o) => (
                      <option key={o} value={o}>
                        {OUTPUT_LABEL[o]}
                      </option>
                    ))}
                  </select>
                </Field>
                <div className="flex items-end">
                  {running ? (
                    <button
                      onClick={stop}
                      className="flex w-full items-center justify-center gap-2 rounded-[10px] bg-neutral-100 px-4 py-2.5 text-sm font-medium text-neutral-700 hover:bg-neutral-200"
                    >
                      <Square className="size-4" /> Zastaviť
                    </button>
                  ) : (
                    <button
                      onClick={launch}
                      className="flex w-full items-center justify-center gap-2 rounded-[10px] bg-neutral-900 px-4 py-2.5 text-sm font-medium text-neutral-50 hover:bg-neutral-800"
                    >
                      <Rocket className="size-4" /> Odpáliť raketu
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Progress */}
          {(running || phase === "ready") && (
            <div className="mt-6 rounded-[14px] bg-white p-4 ring-1 ring-black/5">
              <ol className="flex flex-wrap items-center gap-x-2 gap-y-2">
                {PHASE_STEPS.map((step, i) => {
                  const activeIndex = PHASE_STEPS.findIndex((s) => s.key === phase);
                  const done = i < activeIndex || phase === "ready";
                  const active = i === activeIndex && phase !== "ready";
                  return (
                    <li key={step.key} className="flex items-center gap-2">
                      <span
                        className={
                          "flex size-6 items-center justify-center rounded-full text-[11px] font-semibold " +
                          (done
                            ? "bg-emerald-500 text-white"
                            : active
                              ? "bg-neutral-900 text-white"
                              : "bg-neutral-100 text-neutral-400")
                        }
                      >
                        {done ? <Check className="size-3.5" /> : i + 1}
                      </span>
                      <span
                        className={
                          "text-xs font-medium " +
                          (done || active ? "text-neutral-900" : "text-neutral-400")
                        }
                      >
                        {step.label}
                        {active && <span className="ml-1 animate-pulse">…</span>}
                      </span>
                      {i < PHASE_STEPS.length - 1 && (
                        <span className="mx-1 hidden h-px w-6 bg-neutral-200 sm:block" />
                      )}
                    </li>
                  );
                })}
              </ol>
            </div>
          )}

          {/* Error state */}
          {phase === "error" && (
            <div className="mt-6 rounded-[14px] bg-red-50 p-5 ring-1 ring-red-200">
              <p className="text-sm font-medium text-red-800">Niečo sa pokazilo</p>
              <p className="mt-1 text-sm text-red-700">{errorMsg}</p>
              <button
                onClick={launch}
                className="mt-3 inline-flex items-center gap-2 rounded-[8px] bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700"
              >
                <RotateCcw className="size-4" /> Skúsiť znova
              </button>
            </div>
          )}

          {/* Analysis snapshot */}
          {analysis && (phase === "comparing" || phase === "generating" || phase === "ready") && (
            <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2">
              <AnalysisCard title="Tvoj web" page={analysis.own} />
              {analysis.competitor && (
                <AnalysisCard title="Konkurencia" page={analysis.competitor} />
              )}
            </div>
          )}

          {/* Generating skeletons */}
          {phase === "generating" && (
            <div className="mt-6 space-y-4">
              {!result && (
                <div className="rounded-[14px] bg-white p-6 ring-1 ring-black/5">
                  <div className="space-y-3">
                    <div className="h-4 w-1/3 animate-pulse rounded bg-neutral-100" />
                    <div className="h-4 w-full animate-pulse rounded bg-neutral-100" />
                    <div className="h-4 w-5/6 animate-pulse rounded bg-neutral-100" />
                    <div className="h-4 w-4/6 animate-pulse rounded bg-neutral-100" />
                  </div>
                </div>
              )}
              {result && (
                <div className="rounded-[14px] bg-white p-6 ring-1 ring-black/5 md:p-8">
                  <article className="prose prose-neutral max-w-[72ch] prose-headings:font-serif prose-h2:text-xl prose-h2:mt-8 prose-p:text-neutral-700">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{result}</ReactMarkdown>
                    <span className="ml-0.5 inline-block h-4 w-1 animate-pulse bg-neutral-900 align-middle" />
                  </article>
                </div>
              )}
            </div>
          )}

          {/* Result sections */}
          {phase === "ready" && sections.length > 0 && (
            <div className="mt-6">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <div className="size-2 rounded-full bg-emerald-500" />
                  <span className="text-xs font-medium tracking-widest text-neutral-500 uppercase">
                    Hotovo · uložené do Histórie
                  </span>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => copyText(result, "all")}
                    className="flex items-center gap-1.5 rounded-[8px] bg-white px-3 py-1.5 text-sm font-medium text-neutral-700 ring-1 ring-black/10 hover:bg-neutral-50"
                  >
                    {copiedKey === "all" ? (
                      <Check className="size-4" />
                    ) : (
                      <Copy className="size-4" />
                    )}
                    Kopírovať všetko
                  </button>
                  <button
                    onClick={exportMarkdown}
                    className="flex items-center gap-1.5 rounded-[8px] bg-neutral-900 px-3 py-1.5 text-sm font-medium text-neutral-50 hover:bg-neutral-800"
                  >
                    <ArrowDown className="size-4" /> Export .md
                  </button>
                  <button
                    onClick={reset}
                    className="flex items-center gap-1.5 rounded-[8px] bg-white px-3 py-1.5 text-sm font-medium text-neutral-700 ring-1 ring-black/10 hover:bg-neutral-50"
                  >
                    <RotateCcw className="size-4" /> Nová raketa
                  </button>
                </div>
              </div>

              <div className="space-y-4">
                {sections.map((s, i) => (
                  <div
                    key={i}
                    className="rounded-[14px] bg-white p-5 ring-1 ring-black/5 md:p-7"
                  >
                    <div className="mb-3 flex items-start justify-between gap-3">
                      <h2 className="font-serif text-lg md:text-xl text-neutral-950">
                        {s.heading}
                      </h2>
                      <button
                        onClick={() =>
                          copyText(`## ${s.heading}\n\n${s.body.trim()}`, `s-${i}`)
                        }
                        className="flex shrink-0 items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900"
                      >
                        {copiedKey === `s-${i}` ? (
                          <Check className="size-3.5" />
                        ) : (
                          <Copy className="size-3.5" />
                        )}
                        Kopírovať
                      </button>
                    </div>
                    <article className="prose prose-neutral max-w-none prose-headings:font-serif prose-h3:text-base prose-p:text-neutral-700 prose-table:text-sm">
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>
                        {s.body.trim()}
                      </ReactMarkdown>
                    </article>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

function Field({
  label,
  error,
  required,
  children,
}: {
  label: string;
  error?: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="mb-1.5 block text-xs font-medium tracking-wider text-neutral-500 uppercase">
        {label}
        {required && <span className="ml-1 text-neutral-400">*</span>}
      </label>
      {children}
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  );
}

function AnalysisCard({
  title,
  page,
}: {
  title: string;
  page: RaketaAnalysis["own"];
}) {
  return (
    <div className="rounded-[14px] bg-white p-5 ring-1 ring-black/5">
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="text-sm font-medium text-neutral-900">{title}</p>
        {page.estimated && (
          <span className="rounded bg-amber-50 px-2 py-0.5 text-[10px] text-amber-700 ring-1 ring-amber-200">
            Odhad
          </span>
        )}
      </div>
      <p className="truncate text-xs text-neutral-400">{page.url}</p>
      <dl className="mt-3 grid grid-cols-2 gap-2 text-xs">
        <Stat label="Title" value={page.title ? "✓" : "chýba"} />
        <Stat label="Meta desc" value={page.metaDescription ? "✓" : "chýba"} />
        <Stat label="H1 / H2" value={`${page.h1.length} / ${page.h2.length}`} />
        <Stat label="CTA" value={String(page.ctas.length)} />
        <Stat label="Slová" value={`~${page.wordCount}`} />
      </dl>
      {page.note && <p className="mt-3 text-xs text-neutral-500">{page.note}</p>}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md bg-neutral-50 px-2.5 py-1.5">
      <dt className="text-[10px] uppercase tracking-wider text-neutral-400">
        {label}
      </dt>
      <dd className="text-sm font-medium text-neutral-900">{value}</dd>
    </div>
  );
}
