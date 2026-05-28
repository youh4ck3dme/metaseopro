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
import { saveOutput } from "@/lib/outputs.functions";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Písmo — AI SEO Command Center pre slovenský trh" },
      {
        name: "description",
        content:
          "Blog Writer, SEO Audit, Content Plan a SEO Brief v jednom nástroji. Profesionálne SEO výstupy v slovenčine pre agentúry, freelancerov a malé firmy.",
      },
      { property: "og:title", content: "Písmo — AI SEO Command Center" },
      {
        property: "og:description",
        content:
          "Audit → Brief → 30-dňový plán → SEO článok. Slovenský trh, jeden workflow.",
      },
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
    a.download = `pismo-clanok-${Date.now()}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const showOutput = status !== "idle" || article.length > 0;

  return (
    <div className="min-h-screen bg-page-bg font-sans text-neutral-900 selection:bg-neutral-200">
      <Toaster />
      <AppHeader />

      <main className="pb-32">
        {/* Hero */}
        <section className="px-6">
          <div className="mx-auto max-w-screen-xl">
            <div className="max-w-[44ch]">
              <span className="inline-block rounded-full bg-neutral-900 px-3 py-1 text-[10px] font-medium tracking-widest text-neutral-50 uppercase">
                AI SEO Command Center
              </span>
              <h1 className="mt-5 mb-6 font-serif text-4xl md:text-5xl lg:text-6xl leading-tight text-balance text-neutral-950">
                Odborný SEO obsah pre slovenský trh
              </h1>
              <p className="mb-8 text-base md:text-lg text-neutral-600 text-pretty">
                Audit konkurencie, content brief, 30-dňový plán a hotový článok —
                jeden workflow pre agentúry, freelancerov a malé firmy.
              </p>
              <div className="flex flex-wrap gap-3">
                <Link
                  to={user ? "/brief" : "/login"}
                  className="rounded-[8px] bg-neutral-900 px-4 py-2.5 text-sm font-medium text-neutral-50 hover:bg-neutral-800"
                >
                  {user ? "Vytvoriť SEO brief" : "Začať zadarmo"}
                </Link>
                <Link
                  to="/audit"
                  className="rounded-[8px] bg-white px-4 py-2.5 text-sm font-medium text-neutral-900 ring-1 ring-black/10 hover:bg-neutral-50"
                >
                  Spustiť SEO audit
                </Link>
                <a
                  href="#writer"
                  className="rounded-[8px] bg-white px-4 py-2.5 text-sm font-medium text-neutral-900 ring-1 ring-black/10 hover:bg-neutral-50"
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
            <h2 className="mb-2 font-serif text-2xl md:text-3xl">Štyri nástroje, jeden workflow</h2>
            <p className="mb-8 text-sm text-neutral-500">
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
            <div className="rounded-[16px] bg-white p-6 md:p-10 ring-1 ring-black/5">
              <h2 className="mb-2 font-serif text-2xl md:text-3xl">Workflow Písma</h2>
              <p className="mb-8 text-sm text-neutral-500 max-w-[60ch]">
                Štandardná postupnosť, ktorú reálne používajú SEO špecialisti — len rýchlejšie.
              </p>
              <ol className="grid grid-cols-1 md:grid-cols-4 gap-4">
                {[
                  ["Audit", "Zmapuj konkurenciu a keyword gap."],
                  ["Brief", "Vytvor presný brief: KW, štruktúra, meta, FAQ."],
                  ["30-dňový plán", "Rozplánuj obsah na celý mesiac."],
                  ["SEO článok", "Vygeneruj long-form článok podľa briefu."],
                ].map(([t, d], i) => (
                  <li key={t} className="rounded-[12px] bg-neutral-50 p-4 ring-1 ring-black/5">
                    <div className="mb-2 text-xs font-medium tracking-widest text-neutral-400 uppercase">
                      Krok {i + 1}
                    </div>
                    <p className="font-medium text-neutral-900">{t}</p>
                    <p className="mt-1 text-sm text-neutral-600">{d}</p>
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
                "Vlastný marketing bez agentúry. Píš o tom, čomu rozumieš — Písmo dorobí SEO časť.",
              ],
            ].map(([t, d]) => (
              <div key={t} className="rounded-[12px] bg-white p-5 ring-1 ring-black/5">
                <p className="font-medium text-neutral-900">{t}</p>
                <p className="mt-2 text-sm text-neutral-600">{d}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Blog Writer */}
        <section id="writer" className="mt-24 px-6 scroll-mt-12">
          <div className="mx-auto max-w-screen-xl">
            <div className="max-w-[44ch] mb-8">
              <h2 className="mb-3 font-serif text-3xl md:text-4xl">Blog Writer</h2>
              <p className="text-neutral-600 text-pretty">
                Zadaj 2–3 vety o téme alebo vlož brief. Písmo vygeneruje hĺbkový SEO článok
                s kompletnou štruktúrou.
              </p>
            </div>

            <div className="rounded-[16px] bg-neutral-100/50 p-1.5 ring-1 ring-black/5">
              <div className="rounded-[12px] bg-white p-6 shadow-sm">
                <div className="flex flex-col gap-4">
                  <label
                    htmlFor="prompt"
                    className="text-xs font-medium tracking-wider text-neutral-400 uppercase"
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
                    className="w-full resize-none border-none bg-transparent text-base md:text-lg placeholder:text-neutral-300 focus:ring-0 focus:outline-none disabled:opacity-60"
                    placeholder="Napríklad: Prečo je dôležitá lokálna SEO optimalizácia pre malé firmy v Bratislave a aké nástroje použiť…"
                  />
                  <div className="flex flex-wrap items-center justify-between gap-3 border-t border-neutral-100 pt-4">
                    <div className="flex flex-wrap gap-2">
                      <span className="rounded bg-neutral-100 px-2 py-1 text-[10px] text-neutral-500">
                        Slovenčina (SK)
                      </span>
                      <span className="rounded bg-neutral-100 px-2 py-1 text-[10px] text-neutral-500">
                        Dĺžka: 1800+ slov
                      </span>
                      {!user && (
                        <span className="rounded bg-amber-50 px-2 py-1 text-[10px] text-amber-700 ring-1 ring-amber-200">
                          Prihlásenie potrebné
                        </span>
                      )}
                    </div>
                    {user ? (
                      <button
                        onClick={startGeneration}
                        disabled={status === "streaming"}
                        className="flex items-center gap-2 rounded-[8px] bg-neutral-900 px-3 py-2 text-sm font-medium text-neutral-50 hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {status === "streaming" ? "Generujem…" : "Generovať článok"}
                      </button>
                    ) : (
                      <Link
                        to="/login"
                        search={{ redirect: "/" }}
                        className="rounded-[8px] bg-neutral-900 px-3 py-2 text-sm font-medium text-neutral-50 hover:bg-neutral-800"
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
                title="Ako Písmo pracuje"
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
                        <div className="size-2 animate-pulse rounded-full bg-emerald-500" />
                        <span className="text-xs font-medium tracking-widest text-neutral-500 uppercase">
                          Generuje sa…
                        </span>
                      </>
                    ) : (
                      <>
                        <div className="size-2 rounded-full bg-neutral-300" />
                        <span className="text-xs font-medium tracking-widest text-neutral-500 uppercase">
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
                    <button
                      onClick={stop}
                      className="flex items-center gap-1 rounded px-3 py-1.5 text-sm text-neutral-500 hover:bg-neutral-100"
                    >
                      <Square className="size-3" /> Zastaviť
                    </button>
                  )}
                </div>

                <div className="min-h-[600px] rounded-[12px] bg-white p-6 shadow-sm ring-1 ring-black/5 md:p-12">
                  {article ? (
                    <article className="prose prose-neutral max-w-[68ch] prose-headings:font-serif prose-h1:text-3xl md:prose-h1:text-4xl prose-h1:leading-tight prose-h2:text-xl md:prose-h2:text-2xl prose-h2:font-medium prose-h2:mt-10 prose-h3:text-base md:prose-h3:text-lg prose-p:text-neutral-700 prose-p:leading-relaxed prose-strong:text-neutral-900 prose-a:text-neutral-900">
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>{article}</ReactMarkdown>
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

      {status === "done" && article && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 flex flex-wrap justify-center gap-2 rounded-full bg-neutral-900 p-2 text-neutral-50 shadow-2xl ring-1 ring-black/10 max-w-[calc(100vw-1rem)]">
          <button
            onClick={startGeneration}
            className="flex items-center gap-2 rounded-full py-2 pr-4 pl-3 text-sm font-medium hover:bg-neutral-800"
          >
            <RotateCcw className="size-4" /> Regenerovať
          </button>
          <button
            onClick={copy}
            className="flex items-center gap-2 rounded-full py-2 pr-4 pl-3 text-sm font-medium hover:bg-neutral-800"
          >
            <Copy className="size-4" /> Kopírovať
          </button>
          <button
            onClick={download}
            className="flex items-center gap-2 rounded-full bg-neutral-50 py-2 pr-4 pl-3 text-sm font-medium text-neutral-900 hover:bg-white"
          >
            <ArrowDown className="size-4" /> .md
          </button>
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
    "block rounded-[12px] bg-white p-5 ring-1 ring-black/5 transition hover:ring-black/15 hover:-translate-y-0.5";
  const inner = (
    <>
      <div className="mb-3 inline-flex size-9 items-center justify-center rounded-md bg-neutral-900 text-neutral-50">
        {icon}
      </div>
      <p className="font-medium text-neutral-900">{title}</p>
      <p className="mt-1 text-sm text-neutral-600">{desc}</p>
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
