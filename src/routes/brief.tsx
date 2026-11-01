import { Button } from "@/components/ui/button";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { toast } from "sonner";
import { Toaster } from "@/components/ui/sonner";
import { ArrowDown, Copy, FileText, Save, Square, X } from "lucide-react";
import { AppHeader } from "@/components/AppHeader";
import { SidebarTips } from "@/components/SidebarTips";
import { streamSSE } from "@/lib/stream-sse";
import { useAuth } from "@/hooks/use-auth";
import { saveOutput } from "@/lib/outputs.functions";

export const Route = createFileRoute("/brief")({
  head: () => ({
    meta: [
      { title: "SEO Content Brief — SEO4WEB" },
      {
        name: "description",
        content:
          "Vygeneruj profesionálny SEO content brief: keywordy, štruktúru, meta tagy, FAQ a CTA pre slovenský trh.",
      },
      { property: "og:title", content: "SEO Content Brief — SEO4WEB" },
      { property: "og:description", content: "Vygeneruj profesionálny SEO content brief: keywordy, štruktúru, meta tagy, FAQ a CTA pre slovenský trh." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: BriefPage,
});

type Goal = "" | "traffic" | "leads" | "authority" | "local" | "sales";

function BriefPage() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const save = useServerFn(saveOutput);

  const [domain, setDomain] = useState("");
  const [topic, setTopic] = useState("");
  const [audience, setAudience] = useState("");
  const [language] = useState("Slovenčina (SK)");
  const [competitorInput, setCompetitorInput] = useState("");
  const [competitors, setCompetitors] = useState<string[]>([]);
  const [goal, setGoal] = useState<Goal>("");

  const [brief, setBrief] = useState("");
  const [status, setStatus] = useState<"idle" | "streaming" | "done">("idle");
  const [saved, setSaved] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!loading && !user) navigate({ to: "/login", search: { redirect: "/brief" } });
  }, [user, loading, navigate]);

  const addCompetitor = () => {
    const c = competitorInput
      .split(/[\s,;]+/)
      .map((s) => s.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, ""))
      .map((s) => s.split("/")[0])
      .filter(Boolean);
    if (!c.length) return;
    setCompetitors((cur) => Array.from(new Set([...cur, ...c])).slice(0, 5));
    setCompetitorInput("");
  };

  const start = async () => {
    if (topic.trim().length < 2) {
      toast.error("Zadaj hlavnú tému alebo keyword.");
      return;
    }
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setBrief("");
    setSaved(false);
    setStatus("streaming");

    let buffer = "";
    let raf = 0;
    const flush = () => {
      raf = 0;
      setBrief(buffer);
    };

    await streamSSE({
      url: "/api/generate-brief",
      body: {
        domain: domain.trim(),
        topic: topic.trim(),
        audience: audience.trim(),
        language,
        competitors,
        goal,
      },
      signal: controller.signal,
      onDelta: (chunk) => {
        buffer += chunk;
        if (!raf) raf = requestAnimationFrame(flush);
      },
      onDone: async () => {
        if (raf) cancelAnimationFrame(raf);
        setBrief(buffer);
        setStatus("done");
        // Auto-save brief to history
        try {
          await save({
            data: {
              type: "brief",
              title: `Brief: ${topic.trim()}`.slice(0, 300),
              input: { domain, topic, audience, language, competitors, goal },
              output_markdown: buffer,
            },
          });
          setSaved(true);
        } catch (e) {
          console.error(e);
        }
      },
      onError: (msg) => {
        if (raf) cancelAnimationFrame(raf);
        toast.error(msg);
        setStatus(buffer ? "done" : "idle");
        if (buffer) setBrief(buffer);
      },
    });
  };

  const stop = () => {
    abortRef.current?.abort();
    setStatus(brief ? "done" : "idle");
  };

  const copy = async () => {
    if (!brief) return;
    await navigator.clipboard.writeText(brief);
    toast.success("Skopírované do schránky");
  };

  const download = () => {
    if (!brief) return;
    const blob = new Blob([brief], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `seo4web-brief-${Date.now()}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const useForArticle = () => {
    // Stash the brief and route to Blog Writer
    try {
      sessionStorage.setItem("pismo:brief-context", brief);
      sessionStorage.setItem("pismo:brief-topic", topic);
    } catch {
      // ignore quota errors
    }
    navigate({ to: "/", search: { fromBrief: "1" } as never });
  };

  if (loading || !user) {
    return (
      <div className="min-h-screen bg-page-bg flex items-center justify-center text-sm text-muted-foreground">
        Načítavam…
      </div>
    );
  }

  const showOutput = status !== "idle" || brief.length > 0;

  return (
    <div className="min-h-screen bg-page-bg font-sans text-foreground">
      <Toaster />
      <AppHeader />

      <main className="pb-40">
        <section className="px-6">
          <div className="mx-auto max-w-screen-xl">
            <div className="max-w-[48ch]">
              <h1 className="mb-6 font-display text-4xl md:text-5xl leading-tight text-balance">
                Profesionálny SEO Content Brief
              </h1>
              <p className="mb-10 text-secondary-foreground text-pretty">
                Zadaj tému a kontext. AI pripraví kompletný brief s kľúčovými slovami,
                štruktúrou H1/H2/H3, FAQ, meta tagmi a CTA — pripravený pre copywritera
                alebo priamo do Blog Writera.
              </p>
            </div>

            <div className="rounded-lg bg-muted/50 p-1.5 ring-1 ring-border/5">
              <div className="rounded-lg bg-card p-6 shadow-sm space-y-5">
                <Field
                  label="Hlavná téma / keyword *"
                  hint='Napr. "lokálne SEO pre reštaurácie v Bratislave".'
                >
                  <input
                    value={topic}
                    onChange={(e) => setTopic(e.target.value)}
                    disabled={status === "streaming"}
                    maxLength={300}
                    className="w-full border-none bg-transparent text-lg placeholder:text-muted-foreground focus:outline-none"
                    placeholder="Hlavné keyword alebo téma"
                  />
                </Field>

                <Field
                  label="Doména / web (voliteľné)"
                  hint="Pomôže AI prispôsobiť návrhy tvojmu webu."
                >
                  <input
                    value={domain}
                    onChange={(e) => setDomain(e.target.value)}
                    disabled={status === "streaming"}
                    maxLength={255}
                    className="w-full border-none bg-transparent text-base placeholder:text-muted-foreground focus:outline-none"
                    placeholder="napr. mojweb.sk"
                  />
                </Field>

                <Field label="Cieľové publikum (voliteľné)">
                  <textarea
                    value={audience}
                    onChange={(e) => setAudience(e.target.value)}
                    disabled={status === "streaming"}
                    rows={2}
                    maxLength={500}
                    className="w-full resize-none border-none bg-transparent text-base placeholder:text-muted-foreground focus:outline-none"
                    placeholder="napr. majitelia malých e-shopov, 30–45 r., začiatočníci v SEO"
                  />
                </Field>

                <Field
                  label={`Konkurenti (${competitors.length}/5, voliteľné)`}
                  hint="Stlač Enter alebo čiarku. AI ich zahrnie do porovnania."
                >
                  {competitors.length > 0 && (
                    <div className="mb-2 flex flex-wrap gap-2">
                      {competitors.map((d) => (
                        <span
                          key={d}
                          className="inline-flex items-center gap-1.5 rounded-full bg-muted py-1 pr-1 pl-3 text-sm text-secondary-foreground"
                        >
                          {d}
                          <Button variant="studio" size="studio"
                            type="button"
                            onClick={() => setCompetitors((c) => c.filter((x) => x !== d))}
                            disabled={status === "streaming"}
                            className="flex size-5 items-center justify-center rounded-full text-muted-foreground hover:bg-border hover:text-secondary-foreground disabled:opacity-40"
                            aria-label={`Odstrániť ${d}`}
                          >
                            <X className="size-3" />
                          </Button>
                        </span>
                      ))}
                    </div>
                  )}
                  <input
                    value={competitorInput}
                    onChange={(e) => setCompetitorInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === ",") {
                        e.preventDefault();
                        addCompetitor();
                      }
                    }}
                    onBlur={addCompetitor}
                    disabled={status === "streaming" || competitors.length >= 5}
                    className="w-full border-none bg-transparent text-base placeholder:text-muted-foreground focus:outline-none disabled:opacity-60"
                    placeholder="napr. konkurent.sk"
                  />
                </Field>

                <Field label="Obchodný cieľ (voliteľné)">
                  <select
                    value={goal}
                    onChange={(e) => setGoal(e.target.value as Goal)}
                    disabled={status === "streaming"}
                    className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                  >
                    <option value="">— vyber cieľ —</option>
                    <option value="traffic">Organická návštevnosť</option>
                    <option value="leads">Generovanie leadov</option>
                    <option value="authority">Autorita a E-E-A-T</option>
                    <option value="local">Lokálne SEO</option>
                    <option value="sales">Predaj produktu</option>
                  </select>
                </Field>

                <div className="flex items-center justify-between border-t border-border pt-4">
                  <div className="flex gap-2">
                    <span className="rounded bg-muted px-2 py-1 text-[10px] text-muted-foreground">
                      {language}
                    </span>
                    <span className="rounded bg-muted px-2 py-1 text-[10px] text-muted-foreground">
                      Streamovaný výstup
                    </span>
                  </div>
                  <Button variant="studio" size="studio"
                    onClick={start}
                    disabled={status === "streaming" || topic.trim().length < 2}
                    className="flex items-center gap-2 rounded-[8px] bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {status === "streaming" ? "Generujem brief..." : "Vygenerovať brief"}
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </section>

        {showOutput && (
          <section className="mt-16 px-6">
            <div className="mx-auto grid max-w-screen-xl grid-cols-12 gap-8 lg:gap-12">
              <SidebarTips
                title="Ako brief použiť"
                steps={[
                  "Skontroluj keywordy, štruktúru a meta tagy.",
                  'Pošli copywriterovi alebo klikni "Vygenerovať článok z briefu".',
                  "Hotový článok uložíme do tvojej Histórie.",
                ]}
              />

              <div className="col-span-12 lg:col-span-8">
                <div className="mb-4 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    {status === "streaming" ? (
                      <>
                        <div className="size-2 animate-pulse rounded-full bg-success" />
                        <span className="text-xs font-medium tracking-normalst text-muted-foreground uppercase">
                          Generuje sa…
                        </span>
                      </>
                    ) : (
                      <>
                        <div className="size-2 rounded-full bg-border" />
                        <span className="text-xs font-medium tracking-normalst text-muted-foreground uppercase">
                          {status === "done"
                            ? saved
                                ? "Hotovo · uložené do Histórie"
                                : "Hotovo"
                            : "Pripravené"}
                        </span>
                      </>
                    )}
                  </div>
                  {status === "streaming" && (
                    <Button variant="studio" size="studio"
                      onClick={stop}
                      className="flex items-center gap-1 rounded px-3 py-1.5 text-sm text-muted-foreground hover:bg-muted"
                    >
                      <Square className="size-3" /> Zastaviť
                    </Button>
                  )}
                </div>

                <div className="min-h-[600px] rounded-lg bg-card p-6 shadow-sm ring-1 ring-border/5 md:p-10">
                  {brief ? (
                    <article className="prose prose-neutral max-w-[68ch] prose-headings:font-display prose-h1:text-3xl prose-h2:text-xl prose-h2:font-medium prose-h2:mt-10 prose-h3:text-base prose-p:text-secondary-foreground prose-li:text-secondary-foreground">
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>{brief}</ReactMarkdown>
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

      {status === "done" && brief && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 flex flex-wrap justify-center gap-2 rounded-full bg-primary p-2 text-primary-foreground shadow-2xl ring-1 ring-border/10 max-w-[calc(100vw-1rem)]">
          <Button variant="studio" size="studio"
            onClick={useForArticle}
            className="flex items-center gap-2 rounded-full bg-success py-2 pr-4 pl-3 text-sm font-medium text-primary-foreground hover:bg-success"
          >
            <FileText className="size-4" /> Vygenerovať článok z briefu
          </Button>
          <Button variant="studio" size="studio"
            onClick={copy}
            className="flex items-center gap-2 rounded-full py-2 pr-4 pl-3 text-sm font-medium hover:bg-primary"
          >
            <Copy className="size-4" /> Kopírovať
          </Button>
          <Button variant="studio" size="studio"
            onClick={download}
            className="flex items-center gap-2 rounded-full py-2 pr-4 pl-3 text-sm font-medium hover:bg-primary"
          >
            <ArrowDown className="size-4" /> .md
          </Button>
          {saved && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-primary px-3 py-2 text-xs text-muted-foreground">
              <Save className="size-3" /> v Histórii
            </span>
          )}
        </div>
      )}
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="text-xs font-medium tracking-normalr text-muted-foreground uppercase">
        {label}
      </label>
      {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
      <div className="mt-2">{children}</div>
    </div>
  );
}
