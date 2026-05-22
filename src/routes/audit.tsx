import { createFileRoute } from "@tanstack/react-router";
import { useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { toast } from "sonner";
import { Toaster } from "@/components/ui/sonner";
import { ArrowDown, Copy, RotateCcw, Square, X } from "lucide-react";
import { streamSSE } from "@/lib/stream-sse";
import { AppHeader } from "@/components/AppHeader";
import { SidebarTips } from "@/components/SidebarTips";

export const Route = createFileRoute("/audit")({
  head: () => ({
    meta: [
      { title: "SEO Audit — Písmo" },
      {
        name: "description",
        content:
          "Zadaj 1 až 5 domén. Písmo SEO Audit zanalyzuje konkurenciu cez reálne Semrush dáta a navrhne keyword príležitosti.",
      },
    ],
  }),
  component: AuditPage,
});

function AuditPage() {
  const [input, setInput] = useState("");
  const [domains, setDomains] = useState<string[]>([]);
  const [report, setReport] = useState("");
  const [status, setStatus] = useState<"idle" | "streaming" | "done">("idle");
  const abortRef = useRef<AbortController | null>(null);

  const parseDomains = (raw: string): string[] => {
    return Array.from(
      new Set(
        raw
          .split(/[\s,;\n]+/)
          .map((s) => s.trim().toLowerCase())
          .map((s) => s.replace(/^https?:\/\//, "").replace(/^www\./, ""))
          .map((s) => s.split("/")[0])
          .filter(Boolean),
      ),
    );
  };

  const addFromInput = () => {
    const parsed = parseDomains(input);
    if (parsed.length === 0) return;
    const merged = Array.from(new Set([...domains, ...parsed])).slice(0, 5);
    setDomains(merged);
    setInput("");
  };

  const removeDomain = (d: string) => {
    setDomains((cur) => cur.filter((x) => x !== d));
  };

  const start = async () => {
    const all = Array.from(new Set([...domains, ...parseDomains(input)])).slice(
      0,
      5,
    );
    if (all.length === 0) {
      toast.error("Zadaj aspoň jednu doménu.");
      return;
    }
    setDomains(all);
    setInput("");
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setReport("");
    setStatus("streaming");

    let buffer = "";
    let raf = 0;
    const flush = () => {
      raf = 0;
      setReport(buffer);
    };

    await streamSSE({
      url: "/api/audit-domains",
      body: { domains: all },
      signal: controller.signal,
      onDelta: (chunk) => {
        buffer += chunk;
        if (!raf) raf = requestAnimationFrame(flush);
      },
      onDone: () => {
        if (raf) cancelAnimationFrame(raf);
        setReport(buffer);
        setStatus("done");
      },
      onError: (msg) => {
        if (raf) cancelAnimationFrame(raf);
        toast.error(msg);
        setStatus(buffer ? "done" : "idle");
        if (buffer) setReport(buffer);
      },
    });
  };

  const stop = () => {
    abortRef.current?.abort();
    setStatus(report ? "done" : "idle");
  };

  const copy = async () => {
    if (!report) return;
    await navigator.clipboard.writeText(report);
    toast.success("Skopírované do schránky");
  };

  const download = () => {
    if (!report) return;
    const blob = new Blob([report], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `pismo-seo-audit-${Date.now()}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const showOutput = status !== "idle" || report.length > 0;
  const canRun = (domains.length > 0 || parseDomains(input).length > 0) && status !== "streaming";

  return (
    <div className="min-h-screen bg-page-bg font-sans text-neutral-900 selection:bg-neutral-200">
      <Toaster />
      <AppHeader />

      <main className="pb-40">
        <section className="px-6">
          <div className="mx-auto max-w-screen-xl">
            <div className="max-w-[48ch]">
              <h1 className="mb-6 font-serif text-5xl leading-tight text-balance text-neutral-950">
                Hĺbkový SEO audit konkurencie
              </h1>
              <p className="mb-12 text-neutral-600 text-pretty">
                Zadaj 1 až 5 domén. Stiahnem reálne Semrush dáta, porovnám ich
                a navrhnem keyword príležitosti, kde môžeš konkurenciu predbehnúť.
              </p>
            </div>

            <div className="rounded-[16px] bg-neutral-100/50 p-1.5 ring-1 ring-black/5">
              <div className="rounded-[12px] bg-white p-6 shadow-sm">
                <div className="flex flex-col gap-4">
                  <label
                    htmlFor="domains"
                    className="text-xs font-medium tracking-wider text-neutral-400 uppercase"
                  >
                    Domény ({domains.length}/5)
                  </label>

                  {domains.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                      {domains.map((d) => (
                        <span
                          key={d}
                          className="inline-flex items-center gap-1.5 rounded-full bg-neutral-100 py-1 pr-1 pl-3 text-sm text-neutral-700"
                        >
                          {d}
                          <button
                            type="button"
                            onClick={() => removeDomain(d)}
                            disabled={status === "streaming"}
                            className="flex size-5 items-center justify-center rounded-full text-neutral-400 transition-colors hover:bg-neutral-200 hover:text-neutral-700 disabled:opacity-40"
                            aria-label={`Odstrániť ${d}`}
                          >
                            <X className="size-3" />
                          </button>
                        </span>
                      ))}
                    </div>
                  )}

                  <input
                    id="domains"
                    type="text"
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === ",") {
                        e.preventDefault();
                        addFromInput();
                      }
                    }}
                    onBlur={addFromInput}
                    disabled={status === "streaming" || domains.length >= 5}
                    maxLength={500}
                    className="w-full border-none bg-transparent text-lg placeholder:text-neutral-300 focus:ring-0 focus:outline-none disabled:opacity-60"
                    placeholder={
                      domains.length === 0
                        ? "Napríklad: konkurent.sk, priklad.com"
                        : "Pridať ďalšiu doménu..."
                    }
                  />

                  <div className="flex items-center justify-between border-t border-neutral-100 pt-4">
                    <div className="flex gap-2">
                      <span className="rounded bg-neutral-100 px-2 py-1 text-[10px] text-neutral-500">
                        Semrush
                      </span>
                      <span className="rounded bg-neutral-100 px-2 py-1 text-[10px] text-neutral-500">
                        Slovenčina (SK)
                      </span>
                    </div>
                    <button
                      onClick={start}
                      disabled={!canRun}
                      className="flex items-center gap-2 rounded-[8px] bg-neutral-900 px-3 py-2 text-sm font-medium text-neutral-50 ring-1 ring-neutral-900 transition-colors hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {status === "streaming"
                        ? "Analyzujem..."
                        : "Spustiť analýzu"}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {showOutput && (
          <section className="mt-20 px-6">
            <div className="mx-auto grid max-w-screen-xl grid-cols-12 gap-12">
              <SidebarTips
                title="Ako audit pracuje"
                steps={[
                  "Stiahnem reálne dáta zo Semrush: traffic, top kľúčové slová a backlink profil pre každú doménu.",
                  "Porovnám domény medzi sebou a identifikujem najsilnejšieho konkurenta.",
                  "Navrhnem 12-15 keyword príležitostí a quick-win taktík, ktoré môžeš okamžite použiť.",
                ]}
              />

              <div className="col-span-12 lg:col-span-8">
                <div className="mb-6 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    {status === "streaming" ? (
                      <>
                        <div className="size-2 animate-pulse rounded-full bg-emerald-500" />
                        <span className="text-xs font-medium tracking-widest text-neutral-500 uppercase">
                          {report
                            ? "Generuje sa..."
                            : "Zbieram dáta zo Semrush..."}
                        </span>
                      </>
                    ) : (
                      <>
                        <div className="size-2 rounded-full bg-neutral-300" />
                        <span className="text-xs font-medium tracking-widest text-neutral-500 uppercase">
                          {status === "done" ? "Dokončené" : "Pripravené"}
                        </span>
                      </>
                    )}
                  </div>
                  {status === "streaming" && (
                    <button
                      onClick={stop}
                      className="flex items-center gap-1 rounded px-3 py-1.5 text-sm text-neutral-500 transition-colors hover:bg-neutral-100"
                    >
                      <Square className="size-3" />
                      Zastaviť
                    </button>
                  )}
                </div>

                <div className="min-h-[800px] rounded-[12px] bg-white p-8 shadow-sm ring-1 ring-black/5 md:p-12">
                  {report ? (
                    <article className="prose prose-neutral max-w-[68ch] prose-headings:font-serif prose-h1:text-4xl prose-h1:leading-tight prose-h2:text-2xl prose-h2:font-medium prose-h2:mt-12 prose-h3:text-lg prose-p:text-neutral-700 prose-p:leading-relaxed prose-p:text-pretty prose-strong:text-neutral-900 prose-a:text-neutral-900 prose-table:text-sm">
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>
                        {report}
                      </ReactMarkdown>
                      {status === "streaming" && (
                        <span className="ml-0.5 inline-block h-4 w-1 animate-pulse bg-neutral-900 align-middle" />
                      )}
                    </article>
                  ) : (
                    <div className="space-y-3">
                      <div className="h-4 w-1/3 animate-pulse rounded bg-neutral-100" />
                      <div className="h-4 w-full animate-pulse rounded bg-neutral-100" />
                      <div className="h-4 w-5/6 animate-pulse rounded bg-neutral-100" />
                      <div className="h-4 w-4/6 animate-pulse rounded bg-neutral-100" />
                    </div>
                  )}
                </div>
              </div>
            </div>
          </section>
        )}
      </main>

      {status === "done" && report && (
        <div className="fixed bottom-8 left-1/2 flex -translate-x-1/2 gap-2 rounded-full bg-neutral-900 p-2 text-neutral-50 shadow-2xl ring-1 ring-black/10">
          <button
            onClick={start}
            className="flex items-center gap-2 rounded-full py-2 pr-4 pl-3 text-sm font-medium transition-colors hover:bg-neutral-800"
          >
            <RotateCcw className="size-4" />
            Regenerovať
          </button>
          <div className="my-1 w-px bg-neutral-700" />
          <button
            onClick={copy}
            className="flex items-center gap-2 rounded-full py-2 pr-4 pl-3 text-sm font-medium transition-colors hover:bg-neutral-800"
          >
            <Copy className="size-4" />
            Kopírovať
          </button>
          <button
            onClick={download}
            className="flex items-center gap-2 rounded-full bg-neutral-50 py-2 pr-4 pl-3 text-sm font-medium text-neutral-900 transition-colors hover:bg-white"
          >
            <ArrowDown className="size-4" />
            Stiahnuť .md
          </button>
        </div>
      )}
    </div>
  );
}
