import { createFileRoute } from "@tanstack/react-router";
import { useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { toast } from "sonner";
import { Toaster } from "@/components/ui/sonner";
import { ArrowDown, Copy, RotateCcw, Square } from "lucide-react";
import workspaceImg from "@/assets/workspace.jpg";
import { streamSSE } from "@/lib/stream-sse";
import { AppHeader } from "@/components/AppHeader";
import { SidebarTips } from "@/components/SidebarTips";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Písmo — AI SEO blog writer pre slovenský trh" },
      {
        name: "description",
        content:
          "Zadaj 2-3 vety o téme. Písmo vygeneruje dlhý SEO-optimalizovaný článok v slovenčine s kompletnou štruktúrou, FAQ a CTA.",
      },
    ],
  }),
  component: Index,
});

function Index() {
  const [topic, setTopic] = useState("");
  const [article, setArticle] = useState("");
  const [status, setStatus] = useState<"idle" | "streaming" | "done">("idle");
  const abortRef = useRef<AbortController | null>(null);

  const startGeneration = async () => {
    if (topic.trim().length < 5) {
      toast.error("Napíš aspoň pár viet o téme.");
      return;
    }
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setArticle("");
    setStatus("streaming");

    let buffer = "";
    let raf = 0;
    const flush = () => {
      raf = 0;
      setArticle(buffer);
    };

    await streamSSE({
      url: "/api/generate-article",
      body: { topic },
      signal: controller.signal,
      onDelta: (chunk) => {
        buffer += chunk;
        if (!raf) raf = requestAnimationFrame(flush);
      },
      onDone: () => {
        if (raf) cancelAnimationFrame(raf);
        setArticle(buffer);
        setStatus("done");
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

      <main className="pb-40">
        <section className="px-6">
          <div className="mx-auto max-w-screen-xl">
            <div className="max-w-[40ch]">
              <h1 className="mb-6 font-serif text-5xl leading-tight text-balance text-neutral-950">
                Vytvorte odborný obsah pre slovenský trh
              </h1>
              <p className="mb-12 text-neutral-600 text-pretty">
                Zadajte dve až tri vety o téme. Písmo vygeneruje hĺbkový článok
                optimalizovaný pre vyhľadávače s kompletnou štruktúrou.
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
                    rows={3}
                    value={topic}
                    onChange={(e) => setTopic(e.target.value)}
                    disabled={status === "streaming"}
                    maxLength={2000}
                    className="w-full resize-none border-none bg-transparent text-lg placeholder:text-neutral-300 focus:ring-0 focus:outline-none disabled:opacity-60"
                    placeholder="Napríklad: Prečo je dôležitá lokálna SEO optimalizácia pre malé firmy v Bratislave a aké nástroje použiť..."
                  />
                  <div className="flex items-center justify-between border-t border-neutral-100 pt-4">
                    <div className="flex gap-2">
                      <span className="rounded bg-neutral-100 px-2 py-1 text-[10px] text-neutral-500">
                        Slovenčina (SK)
                      </span>
                      <span className="rounded bg-neutral-100 px-2 py-1 text-[10px] text-neutral-500">
                        Dĺžka: 1800+ slov
                      </span>
                    </div>
                    <button
                      onClick={startGeneration}
                      disabled={status === "streaming"}
                      className="flex items-center gap-2 rounded-[8px] bg-neutral-900 px-3 py-2 text-sm font-medium text-neutral-50 ring-1 ring-neutral-900 transition-colors hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {status === "streaming"
                        ? "Generujem..."
                        : "Generovať článok"}
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
                title="Ako Písmo pracuje"
                steps={[
                  "Analyzuje sémantické jadro slovenskej SEO scény pre danú tému.",
                  "Navrhuje štruktúru H1-H3, ktorá prirodzene vedie čitateľa k akcii.",
                  "Implementuje FAQ sekciu s relevantnými otázkami pre Google Snippets.",
                ]}
                imageSrc={workspaceImg}
                imageAlt="Pracovný stôl so zápisníkom a perami"
              />

              <div className="col-span-12 lg:col-span-8">
                <div className="mb-6 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    {status === "streaming" ? (
                      <>
                        <div className="size-2 animate-pulse rounded-full bg-emerald-500" />
                        <span className="text-xs font-medium tracking-widest text-neutral-500 uppercase">
                          Generuje sa...
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
                  {article ? (
                    <article className="prose prose-neutral max-w-[68ch] prose-headings:font-serif prose-h1:text-4xl prose-h1:leading-tight prose-h2:text-2xl prose-h2:font-medium prose-h2:mt-12 prose-h3:text-lg prose-p:text-neutral-700 prose-p:leading-relaxed prose-p:text-pretty prose-strong:text-neutral-900 prose-a:text-neutral-900">
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>
                        {article}
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

      {status === "done" && article && (
        <div className="fixed bottom-8 left-1/2 flex -translate-x-1/2 gap-2 rounded-full bg-neutral-900 p-2 text-neutral-50 shadow-2xl ring-1 ring-black/10">
          <button
            onClick={startGeneration}
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
