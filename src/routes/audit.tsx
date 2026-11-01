import { Button } from "@/components/ui/button";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { toast } from "sonner";
import { Toaster } from "@/components/ui/sonner";
import { ArrowDown, Copy, RotateCcw, Square, X } from "lucide-react";
import { streamSSE } from "@/lib/stream-sse";
import { AppHeader } from "@/components/AppHeader";
import { SidebarTips } from "@/components/SidebarTips";
import { useAuth } from "@/hooks/use-auth";
import { saveOutput } from "@/lib/outputs.functions";

export const Route = createFileRoute("/audit")({
  head: () => ({
    meta: [
      { title: "SEO Audit — SEO4WEB" },
      {
        name: "description",
        content:
          "Zadaj 1 až 5 domén. SEO4WEB SEO Audit zanalyzuje konkurenciu cez reálne Semrush dáta a navrhne keyword príležitosti.",
      },
      { property: "og:title", content: "SEO Audit — SEO4WEB" },
      { property: "og:description", content: "Zadaj 1 až 5 domén. SEO4WEB SEO Audit zanalyzuje konkurenciu cez reálne Semrush dáta a navrhne keyword príležitosti." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: AuditPage,
});

function AuditPage() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const save = useServerFn(saveOutput);
  const [input, setInput] = useState("");
  const [domains, setDomains] = useState<string[]>([]);
  const [database, setDatabase] = useState<string>("");
  const [yourDomain, setYourDomain] = useState<string>("");
  const [report, setReport] = useState("");
  const [status, setStatus] = useState<"idle" | "streaming" | "done">("idle");
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!loading && !user) navigate({ to: "/login", search: { redirect: "/audit" } });
  }, [user, loading, navigate]);

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
      body: { domains: all, database, yourDomain: yourDomain.trim() },
      signal: controller.signal,
      onDelta: (chunk) => {
        buffer += chunk;
        if (!raf) raf = requestAnimationFrame(flush);
      },
      onDone: async () => {
        if (raf) cancelAnimationFrame(raf);
        setReport(buffer);
        setStatus("done");
        try {
          await save({
            data: {
              type: "audit",
              title: `Audit: ${all.join(", ")}`.slice(0, 200),
              input: { domains: all },
              output_markdown: buffer,
            },
          });
        } catch (e) {
          console.error(e);
        }
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
    a.download = `seo4web-seo-audit-${Date.now()}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const showOutput = status !== "idle" || report.length > 0;
  const canRun = (domains.length > 0 || parseDomains(input).length > 0) && status !== "streaming";

  return (
    <div className="min-h-screen bg-page-bg font-sans text-foreground selection:bg-border">
      <Toaster />
      <AppHeader />

      <main className="pb-40">
        <section className="px-6">
          <div className="mx-auto max-w-screen-xl">
            <div className="max-w-[48ch]">
              <h1 className="mb-6 font-display text-5xl leading-tight text-balance text-foreground">
                Hĺbkový SEO audit konkurencie
              </h1>
              <p className="mb-12 text-secondary-foreground text-pretty">
                Zadaj 1 až 5 domén. Stiahnem reálne Semrush dáta, porovnám ich
                a navrhnem keyword príležitosti, kde môžeš konkurenciu predbehnúť.
              </p>
            </div>

            <div className="rounded-lg bg-muted/50 p-1.5 ring-1 ring-border/5">
              <div className="rounded-lg bg-card p-6 shadow-sm">
                <div className="flex flex-col gap-4">
                  <label
                    htmlFor="domains"
                    className="text-xs font-medium tracking-normalr text-muted-foreground uppercase"
                  >
                    Domény ({domains.length}/5)
                  </label>

                  {domains.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                      {domains.map((d) => (
                        <span
                          key={d}
                          className="inline-flex items-center gap-1.5 rounded-full bg-muted py-1 pr-1 pl-3 text-sm text-secondary-foreground"
                        >
                          {d}
                          <Button variant="studio" size="studio"
                            type="button"
                            onClick={() => removeDomain(d)}
                            disabled={status === "streaming"}
                            className="flex size-5 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-border hover:text-secondary-foreground disabled:opacity-40"
                            aria-label={`Odstrániť ${d}`}
                          >
                            <X className="size-3" />
                          </Button>
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
                    className="w-full border-none bg-transparent text-lg placeholder:text-muted-foreground focus:ring-0 focus:outline-none disabled:opacity-60"
                    placeholder={
                      domains.length === 0
                        ? "Napríklad: konkurent.sk, priklad.com"
                        : "Pridať ďalšiu doménu..."
                    }
                  />

                  <div className="grid grid-cols-1 gap-3 border-t border-border pt-4 sm:grid-cols-2">
                    <div>
                      <label className="block text-[10px] font-medium tracking-normalr text-muted-foreground uppercase">
                        Tvoja doména (voliteľné)
                      </label>
                      <input
                        type="text"
                        value={yourDomain}
                        onChange={(e) => setYourDomain(e.target.value)}
                        disabled={status === "streaming"}
                        maxLength={255}
                        placeholder="napr. mojweb.sk"
                        className="mt-1 w-full rounded-md border border-border bg-card px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-medium tracking-normalr text-muted-foreground uppercase">
                        Trh (Semrush database)
                      </label>
                      <select
                        value={database}
                        onChange={(e) => setDatabase(e.target.value)}
                        disabled={status === "streaming"}
                        className="mt-1 w-full rounded-md border border-border bg-card px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                      >
                        <option value="">Auto-detekcia podľa TLD</option>
                        <option value="sk">Slovensko (sk)</option>
                        <option value="cz">Česko (cz)</option>
                        <option value="us">USA (us)</option>
                        <option value="uk">UK (uk)</option>
                        <option value="de">Nemecko (de)</option>
                        <option value="pl">Poľsko (pl)</option>
                        <option value="hu">Maďarsko (hu)</option>
                        <option value="at">Rakúsko (at)</option>
                      </select>
                    </div>
                  </div>

                  <div className="flex items-center justify-between border-t border-border pt-4">
                    <div className="flex gap-2">
                      <span className="rounded bg-muted px-2 py-1 text-[10px] text-muted-foreground">
                        Semrush
                      </span>
                      <span className="rounded bg-muted px-2 py-1 text-[10px] text-muted-foreground">
                        Gemini 2.5 Pro
                      </span>
                    </div>
                    <Button variant="studio" size="studio"
                      onClick={start}
                      disabled={!canRun}
                      className="flex items-center gap-2 rounded-[8px] bg-primary px-3 py-2 text-sm font-medium text-primary-foreground ring-1 ring-ring transition-colors hover:bg-primary disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {status === "streaming"
                        ? "Analyzujem..."
                        : "Spustiť analýzu"}
                    </Button>
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
                        <div className="size-2 animate-pulse rounded-full bg-success" />
                        <span className="text-xs font-medium tracking-normalst text-muted-foreground uppercase">
                          {report
                            ? "Generuje sa..."
                            : "Zbieram dáta zo Semrush..."}
                        </span>
                      </>
                    ) : (
                      <>
                        <div className="size-2 rounded-full bg-border" />
                        <span className="text-xs font-medium tracking-normalst text-muted-foreground uppercase">
                          {status === "done" ? "Dokončené" : "Pripravené"}
                        </span>
                      </>
                    )}
                  </div>
                  {status === "streaming" && (
                    <Button variant="studio" size="studio"
                      onClick={stop}
                      className="flex items-center gap-1 rounded px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-muted"
                    >
                      <Square className="size-3" />
                      Zastaviť
                    </Button>
                  )}
                </div>

                <div className="min-h-[800px] rounded-lg bg-card p-8 shadow-sm ring-1 ring-border/5 md:p-12">
                  {report ? (
                    <article className="prose prose-neutral max-w-[68ch] prose-headings:font-display prose-h1:text-4xl prose-h1:leading-tight prose-h2:text-2xl prose-h2:font-medium prose-h2:mt-12 prose-h3:text-lg prose-p:text-secondary-foreground prose-p:leading-relaxed prose-p:text-pretty prose-strong:text-foreground prose-a:text-foreground prose-table:text-sm">
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>
                        {report}
                      </ReactMarkdown>
                      {status === "streaming" && (
                        <span className="ml-0.5 inline-block h-4 w-1 animate-pulse bg-primary align-middle" />
                      )}
                    </article>
                  ) : (
                    <div className="space-y-3">
                      <div className="h-4 w-1/3 animate-pulse rounded bg-muted" />
                      <div className="h-4 w-full animate-pulse rounded bg-muted" />
                      <div className="h-4 w-5/6 animate-pulse rounded bg-muted" />
                      <div className="h-4 w-4/6 animate-pulse rounded bg-muted" />
                    </div>
                  )}
                </div>
              </div>
            </div>
          </section>
        )}
      </main>

      {status === "done" && report && (
        <div className="fixed bottom-4 left-1/2 flex flex-wrap justify-center max-w-[calc(100vw-1rem)] -translate-x-1/2 gap-2 rounded-full bg-primary p-2 text-primary-foreground shadow-2xl ring-1 ring-border/10">
          <Button variant="studio" size="studio"
            onClick={start}
            className="flex items-center gap-2 rounded-full py-2 pr-4 pl-3 text-sm font-medium transition-colors hover:bg-primary"
          >
            <RotateCcw className="size-4" />
            Regenerovať
          </Button>
          <div className="my-1 w-px bg-foreground" />
          <Button variant="studio" size="studio"
            onClick={copy}
            className="flex items-center gap-2 rounded-full py-2 pr-4 pl-3 text-sm font-medium transition-colors hover:bg-primary"
          >
            <Copy className="size-4" />
            Kopírovať
          </Button>
          <Button variant="studio" size="studio"
            onClick={download}
            className="flex items-center gap-2 rounded-full bg-background py-2 pr-4 pl-3 text-sm font-medium text-foreground transition-colors hover:bg-card"
          >
            <ArrowDown className="size-4" />
            Stiahnuť .md
          </Button>
        </div>
      )}
    </div>
  );
}
