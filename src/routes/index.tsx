import { Button } from "@/components/ui/button";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { toast } from "sonner";
import { Toaster } from "@/components/ui/sonner";
import {
  ArrowDown,
  BarChart3,
  Calendar,
  Copy,
  FileText,
  Lightbulb,
  RotateCcw,
  Square,
} from "lucide-react";
import workspaceImg from "@/assets/workspace.jpg";
import { streamSSE } from "@/lib/stream-sse";
import { AppHeader } from "@/components/AppHeader";
import { SidebarTips } from "@/components/SidebarTips";
import { useAuth } from "@/hooks/use-auth";
import { SerpLab } from "@/components/SerpLab";
import { saveOutput } from "@/lib/outputs.functions";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "SEO4WEB — AI SEO Command Center pre slovenský trh" },
      {
        name: "description",
        content:
          "Blog Writer, SEO Audit, Content Plan a SEO Brief v jednom nástroji. Profesionálne SEO výstupy v slovenčine pre agentúry, freelancerov a malé firmy.",
      },
      { property: "og:title", content: "SEO4WEB — AI SEO Command Center" },
      {
        property: "og:description",
        content:
          "Audit → Brief → 30-dňový plán → SEO článok. Slovenský trh, jeden workflow.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});

function Index() {
  const { user } = useAuth();
  const save = useServerFn(saveOutput);
  const [topic, setTopic] = useState("");
  const [primaryKeyword, setPrimaryKeyword] = useState("");
  const [audience, setAudience] = useState("");
  const [tone, setTone] = useState<"" | "friendly" | "expert" | "sales">("");
  const [targetLength, setTargetLength] = useState<"" | "1500" | "2000" | "2800">("");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [article, setArticle] = useState("");
  const [status, setStatus] = useState<"idle" | "streaming" | "done">("idle");
  const [savedId, setSavedId] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Auto-load brief context if user came from /brief
  useEffect(() => {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    if (url.searchParams.get("fromBrief")) {
      const ctx = sessionStorage.getItem("pismo:brief-context");
      const t = sessionStorage.getItem("pismo:brief-topic");
      if (ctx) {
        const prefill = `Napíš kompletný SEO článok v slovenčine presne podľa nasledujúceho briefu. Drž sa štruktúry H1/H2/H3, primárneho keywordu, sekundárnych KW, FAQ, meta tagov a CTA z briefu:\n\n${ctx}`;
        setTopic(prefill);
        if (t) toast.success(`Brief načítaný: ${t}`);
      }
    }
    if (url.searchParams.get("fromRefresh")) {
      const raw = sessionStorage.getItem("pismo:refresh-context");
      if (raw) {
        try {
          const c = JSON.parse(raw) as { brief: string; keyword: string; label: string };
          setTopic(c.brief);
          if (c.keyword) setPrimaryKeyword(c.keyword);
          toast.success(`Podklady pre refresh načítané: ${c.label}. Skontroluj a klikni na generovanie.`);
        } catch {
          /* ignore */
        }
      }
    }
  }, []);

  const startGeneration = async () => {
    if (!user) {
      toast.error("Pre generovanie sa najprv prihlás.");
      return;
    }
    if (topic.trim().length < 5) {
      toast.error("Napíš aspoň pár viet o téme.");
      return;
    }
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setArticle("");
    setSavedId(null);
    setStatus("streaming");

    let buffer = "";
    let raf = 0;
    const flush = () => {
      raf = 0;
      setArticle(buffer);
    };

    await streamSSE({
      url: "/api/generate-article",
      body: { topic, primaryKeyword, audience, tone, targetLength },
      signal: controller.signal,
      onDelta: (chunk) => {
        buffer += chunk;
        if (!raf) raf = requestAnimationFrame(flush);
      },
      onDone: async () => {
        if (raf) cancelAnimationFrame(raf);
        setArticle(buffer);
        setStatus("done");
        try {
          const r = await save({
            data: {
              type: "article",
              title:
                topic.trim().slice(0, 80) +
                (topic.trim().length > 80 ? "…" : ""),
              input: { topic },
              output_markdown: buffer,
            },
          });
          setSavedId(r.id);
        } catch (e) {
          console.error(e);
        }
      },
      onError: (msg) => {
        if (raf) cancelAnimationFrame(raf);
        toast.error(msg);
        setStatus(buffer ? "done" : "idle");
        if (buffer) setArticle(buffer);
      },
    });
  };

  const stop = () => {
    abortRef.current?.abort();
    setStatus(article ? "done" : "idle");
  };

  const copy = async () => {
    if (!article) return;
    await navigator.clipboard.writeText(article);
    toast.success("Skopírované do schránky");
  };

  const download = () => {
    if (!article) return;
    const blob = new Blob([article], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `seo4web-clanok-${Date.now()}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const showOutput = status !== "idle" || article.length > 0;

  return (
    <div className="min-h-screen bg-page-bg font-sans text-foreground selection:bg-border">
      <Toaster />
      <AppHeader />

      <main className="pb-32">
        {/* Hero */}
        <section className="px-6">
          <div className="mx-auto max-w-screen-xl">
            <div className="max-w-[44ch]">
              <span className="inline-block rounded-full bg-primary px-3 py-1 text-[10px] font-medium tracking-normalst text-primary-foreground uppercase">
                AI SEO Command Center
              </span>
              <h1 className="mt-5 mb-6 font-display text-4xl md:text-5xl lg:text-6xl leading-tight text-balance text-foreground">
                SEO4WEB
              </h1>
              <p className="mb-8 text-base md:text-lg text-secondary-foreground text-pretty">
                Audit konkurencie, content brief, 30-dňový plán a hotový článok —
                jeden workflow pre agentúry, freelancerov a malé firmy.
              </p>
              <div className="flex flex-wrap gap-3">
                <Link
                  to={user ? "/brief" : "/login"}
                  className="rounded-[8px] bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary"
                >
                  {user ? "Vytvoriť SEO brief" : "Začať zadarmo"}
                </Link>
                <Link
                  to="/audit"
                  className="rounded-[8px] bg-card px-4 py-2.5 text-sm font-medium text-foreground ring-1 ring-border/10 hover:bg-background"
                >
                  Spustiť SEO audit
                </Link>
                <a
                  href="#writer"
                  className="rounded-[8px] bg-card px-4 py-2.5 text-sm font-medium text-foreground ring-1 ring-border/10 hover:bg-background"
                >
                  Vytvoriť článok
                </a>
              </div>
            </div>
          </div>
        </section>

        {/* Tools */}
        <section className="mt-20 px-6">
          <div className="mx-auto max-w-screen-xl">
            <h2 className="mb-2 font-display text-2xl md:text-3xl">Štyri nástroje, jeden workflow</h2>
            <p className="mb-8 text-sm text-muted-foreground">
              Pracujú samostatne aj v reťazci — od auditu po publikovaný článok.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <ToolCard
                to="/audit"
                icon={<BarChart3 className="size-5" />}
                title="SEO Audit"
                desc="Reálne Semrush dáta + keyword príležitosti a quick-win taktiky."
              />
              <ToolCard
                to="/brief"
                icon={<Lightbulb className="size-5" />}
                title="SEO Brief"
                desc="Štruktúrovaný brief: keywordy, H1/H2/H3, meta, FAQ, CTA."
              />
              <ToolCard
                to="/plan"
                icon={<Calendar className="size-5" />}
                title="Content Plan"
                desc="30-dňový kalendár obsahu s denným H1, KW a dĺžkou článku."
              />
              <ToolCard
                to="#writer"
                icon={<FileText className="size-5" />}
                title="Blog Writer"
                desc="Long-form SEO článok v slovenčine, streamovaný v reálnom čase."
              />
            </div>
          </div>
        </section>

        {/* Workflow */}
        <section className="mt-20 px-6">
          <div className="mx-auto max-w-screen-xl">
            <div className="border-y border-border py-8 md:py-10">
              <h2 className="mb-2 font-display text-2xl md:text-3xl">Workflow SEO4WEB</h2>
              <p className="mb-8 text-sm text-muted-foreground max-w-[60ch]">
                Štandardná postupnosť, ktorú reálne používajú SEO špecialisti — len rýchlejšie.
              </p>
              <ol className="grid grid-cols-1 md:grid-cols-4 gap-4">
                {[
                  ["Audit", "Zmapuj konkurenciu a keyword gap."],
                  ["Brief", "Vytvor presný brief: KW, štruktúra, meta, FAQ."],
                  ["30-dňový plán", "Rozplánuj obsah na celý mesiac."],
                  ["SEO článok", "Vygeneruj long-form článok podľa briefu."],
                ].map(([t, d], i) => (
                  <li key={t} className="rounded-lg bg-background p-4 ring-1 ring-border/5">
                    <div className="mb-2 text-xs font-medium tracking-normalst text-muted-foreground uppercase">
                      Krok {i + 1}
                    </div>
                    <p className="font-medium text-foreground">{t}</p>
                    <p className="mt-1 text-sm text-secondary-foreground">{d}</p>
                  </li>
                ))}
              </ol>
            </div>
          </div>
        </section>

        {/* Benefits */}
        <section className="mt-20 px-6">
          <div className="mx-auto max-w-screen-xl grid grid-cols-1 md:grid-cols-3 gap-4">
            {[
              [
                "Pre agentúry",
                "Zdvojnásob výstup tímu bez najímania ďalších copywriterov. Briefy a články priamo k schváleniu.",
              ],
              [
                "Pre freelancerov",
                "Doruč klientovi audit, plán a článok za hodiny, nie dni. Profesionálne výstupy v slovenčine.",
              ],
              [
                "Pre malé firmy",
                "Vlastný marketing bez agentúry. Píš o tom, čomu rozumieš — SEO4WEB dorobí SEO časť.",
              ],
            ].map(([t, d]) => (
              <div key={t} className="rounded-lg bg-card p-5 ring-1 ring-border/5">
                <p className="font-medium text-foreground">{t}</p>
                <p className="mt-2 text-sm text-secondary-foreground">{d}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Blog Writer */}
        <section id="writer" className="mt-24 px-6 scroll-mt-12">
          <div className="mx-auto max-w-screen-xl">
            <div className="max-w-[44ch] mb-8">
              <h2 className="mb-3 font-display text-3xl md:text-4xl">Blog Writer</h2>
              <p className="text-secondary-foreground text-pretty">
                Zadaj 2–3 vety o téme alebo vlož brief. SEO4WEB vygeneruje hĺbkový SEO článok
                s kompletnou štruktúrou.
              </p>
            </div>

            <div className="rounded-lg bg-muted/50 p-1.5 ring-1 ring-border/5">
              <div className="rounded-lg bg-card p-6 shadow-sm">
                <div className="flex flex-col gap-4">
                  <label
                    htmlFor="prompt"
                    className="text-xs font-medium tracking-normalr text-muted-foreground uppercase"
                  >
                    Téma a kontext článku
                  </label>
                  <textarea
                    id="prompt"
                    rows={topic.length > 200 ? 8 : 3}
                    value={topic}
                    onChange={(e) => setTopic(e.target.value)}
                    disabled={status === "streaming"}
                    maxLength={4000}
                    className="w-full resize-none border-none bg-transparent text-base md:text-lg placeholder:text-muted-foreground focus:ring-0 focus:outline-none disabled:opacity-60"
                    placeholder="Napríklad: Prečo je dôležitá lokálna SEO optimalizácia pre malé firmy v Bratislave a aké nástroje použiť…"
                  />

                  <div className="border-t border-border pt-3">
                    <Button variant="studio" size="studio"
                      type="button"
                      onClick={() => setShowAdvanced((v) => !v)}
                      className="text-xs font-medium tracking-normalr text-muted-foreground uppercase hover:text-foreground"
                    >
                      {showAdvanced ? "− Skryť pokročilé" : "+ Pokročilé (KW, publikum, tón, dĺžka)"}
                    </Button>
                    {showAdvanced && (
                      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <input
                          value={primaryKeyword}
                          onChange={(e) => setPrimaryKeyword(e.target.value)}
                          disabled={status === "streaming"}
                          maxLength={150}
                          placeholder="Primárne keyword"
                          className="rounded-md border border-border bg-card px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                        />
                        <input
                          value={audience}
                          onChange={(e) => setAudience(e.target.value)}
                          disabled={status === "streaming"}
                          maxLength={300}
                          placeholder="Cieľové publikum"
                          className="rounded-md border border-border bg-card px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                        />
                        <select
                          value={tone}
                          onChange={(e) => setTone(e.target.value as typeof tone)}
                          disabled={status === "streaming"}
                          className="rounded-md border border-border bg-card px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                        >
                          <option value="">Tón (auto)</option>
                          <option value="friendly">Priateľský</option>
                          <option value="expert">Expertný</option>
                          <option value="sales">Predajný</option>
                        </select>
                        <select
                          value={targetLength}
                          onChange={(e) => setTargetLength(e.target.value as typeof targetLength)}
                          disabled={status === "streaming"}
                          className="rounded-md border border-border bg-card px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                        >
                          <option value="">Dĺžka (auto)</option>
                          <option value="1500">~1500 slov</option>
                          <option value="2000">~2000 slov</option>
                          <option value="2800">~2800 slov</option>
                        </select>
                      </div>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
                    <div className="flex flex-wrap gap-2">
                      <span className="rounded bg-muted px-2 py-1 text-[10px] text-muted-foreground">
                        Slovenčina (SK)
                      </span>
                      <span className="rounded bg-muted px-2 py-1 text-[10px] text-muted-foreground">
                        Dĺžka: 1800+ slov
                      </span>
                      {!user && (
                        <span className="rounded bg-warning-subtle px-2 py-1 text-[10px] text-warning-foreground ring-1 ring-warning-border">
                          Prihlásenie potrebné
                        </span>
                      )}
                    </div>
                    {user ? (
                      <Button variant="studio" size="studio"
                        onClick={startGeneration}
                        disabled={status === "streaming"}
                        className="flex items-center gap-2 rounded-[8px] bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {status === "streaming" ? "Generujem…" : "Generovať článok"}
                      </Button>
                    ) : (
                      <Link
                        to="/login"
                        search={{ redirect: "/" }}
                        className="rounded-[8px] bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary"
                      >
                        Prihlásiť a generovať
                      </Link>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {showOutput && (
          <section className="mt-12 px-6">
            <div className="mx-auto grid max-w-screen-xl grid-cols-12 gap-8 lg:gap-12">
              <SidebarTips
                title="Ako SEO4WEB pracuje"
                steps={[
                  "Analyzuje sémantické jadro slovenskej SEO scény pre danú tému.",
                  "Navrhuje štruktúru H1-H3, ktorá prirodzene vedie k akcii.",
                  "Pridáva FAQ pre Google Snippets a CTA na konci článku.",
                ]}
                imageSrc={workspaceImg}
                imageAlt="Pracovný stôl so zápisníkom a perami"
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
                            ? savedId
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

                <div className="min-h-[600px] rounded-lg bg-card p-6 shadow-sm ring-1 ring-border/5 md:p-12">
                  {article ? (
                    <article className="prose prose-neutral max-w-[68ch] prose-headings:font-display prose-h1:text-3xl md:prose-h1:text-4xl prose-h1:leading-tight prose-h2:text-xl md:prose-h2:text-2xl prose-h2:font-medium prose-h2:mt-10 prose-h3:text-base md:prose-h3:text-lg prose-p:text-secondary-foreground prose-p:leading-relaxed prose-strong:text-foreground prose-a:text-foreground">
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>{article}</ReactMarkdown>
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
        {status === "done" && article && <SerpLab key={article.length} article={article} primary={primaryKeyword} />}
      </main>

      {status === "done" && article && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 flex flex-wrap justify-center gap-2 rounded-full bg-primary p-2 text-primary-foreground shadow-2xl ring-1 ring-border/10 max-w-[calc(100vw-1rem)]">
          <Button variant="studio" size="studio"
            onClick={startGeneration}
            className="flex items-center gap-2 rounded-full py-2 pr-4 pl-3 text-sm font-medium hover:bg-primary"
          >
            <RotateCcw className="size-4" /> Regenerovať
          </Button>
          <Button variant="studio" size="studio"
            onClick={copy}
            className="flex items-center gap-2 rounded-full py-2 pr-4 pl-3 text-sm font-medium hover:bg-primary"
          >
            <Copy className="size-4" /> Kopírovať
          </Button>
          <Button variant="studio" size="studio"
            onClick={download}
            className="flex items-center gap-2 rounded-full bg-background py-2 pr-4 pl-3 text-sm font-medium text-foreground hover:bg-card"
          >
            <ArrowDown className="size-4" /> .md
          </Button>
        </div>
      )}
    </div>
  );
}

function ToolCard({
  to,
  icon,
  title,
  desc,
}: {
  to: string;
  icon: React.ReactNode;
  title: string;
  desc: string;
}) {
  const isHash = to.startsWith("#");
  const className =
    "block rounded-lg bg-card p-5 ring-1 ring-border/5 transition hover:ring-border/15 hover:-translate-y-0.5";
  const inner = (
    <>
      <div className="mb-3 inline-flex size-9 items-center justify-center rounded-md bg-primary text-primary-foreground">
        {icon}
      </div>
      <p className="font-medium text-foreground">{title}</p>
      <p className="mt-1 text-sm text-secondary-foreground">{desc}</p>
    </>
  );
  if (isHash) {
    return (
      <a href={to} className={className}>
        {inner}
      </a>
    );
  }
  return (
    <Link to={to} className={className}>
      {inner}
    </Link>
  );
}
