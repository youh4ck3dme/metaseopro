import { Button } from "@/components/ui/button";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState, useCallback } from "react";
import { useServerFn } from "@tanstack/react-start";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { toast } from "sonner";
import { Toaster } from "@/components/ui/sonner";
import { ArrowDown, Copy, Trash2, X, FileText, BarChart3, Calendar, Lightbulb, Rocket, TrendingDown } from "lucide-react";
import { AppHeader } from "@/components/AppHeader";
import { useAuth } from "@/hooks/use-auth";
import { listOutputs, getOutput, deleteOutput } from "@/lib/outputs.functions";

export const Route = createFileRoute("/history")({
  head: () => ({
    meta: [
      { title: "História — SEO4WEB" },
      {
        name: "description",
        content: "Tvoje vygenerované články, audity, plány a briefy na jednom mieste.",
      },
      { property: "og:title", content: "História — SEO4WEB" },
      { property: "og:description", content: "Tvoje vygenerované články, audity, plány a briefy na jednom mieste." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: HistoryPage,
});

type FilterType = "all" | "article" | "audit" | "plan" | "brief" | "raketa" | "decay";

type Item = {
  id: string;
  type: "article" | "audit" | "plan" | "brief" | "raketa" | "decay";
  title: string | null;
  created_at: string;
};

type FullItem = Item & { output_markdown: string; input: unknown };

const TYPE_LABEL: Record<Item["type"], string> = {
  article: "Článok",
  audit: "SEO Audit",
  plan: "Content Plan",
  brief: "SEO Brief",
  raketa: "SEO Raketa",
  decay: "Decay Radar",
};

const TYPE_ICON: Record<Item["type"], typeof FileText> = {
  article: FileText,
  audit: BarChart3,
  plan: Calendar,
  brief: Lightbulb,
  raketa: Rocket,
  decay: TrendingDown,
};

function HistoryPage() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const list = useServerFn(listOutputs);
  const getOne = useServerFn(getOutput);
  const del = useServerFn(deleteOutput);

  const [items, setItems] = useState<Item[] | null>(null);
  const [filter, setFilter] = useState<FilterType>("all");
  const [selected, setSelected] = useState<FullItem | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);

  const refresh = useCallback(() => {
    list({})
      .then((r) => setItems(r.items as Item[]))
      .catch((e) => toast.error((e as Error).message));
  }, [list]);

  useEffect(() => {
    if (!loading && !user) navigate({ to: "/login", search: { redirect: "/history" } });
  }, [user, loading, navigate]);

  useEffect(() => {
    if (user) refresh();
  }, [user, refresh]);

  const open = async (id: string) => {
    setLoadingDetail(true);
    try {
      const row = await getOne({ data: { id } });
      setSelected(row as FullItem);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setLoadingDetail(false);
    }
  };

  const remove = async (id: string) => {
    if (!confirm("Naozaj zmazať tento záznam?")) return;
    try {
      await del({ data: { id } });
      toast.success("Zmazané");
      setItems((cur) => cur?.filter((i) => i.id !== id) ?? null);
      if (selected?.id === id) setSelected(null);
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const copy = async () => {
    if (!selected) return;
    await navigator.clipboard.writeText(selected.output_markdown);
    toast.success("Skopírované");
  };

  const download = () => {
    if (!selected) return;
    const blob = new Blob([selected.output_markdown], {
      type: "text/markdown;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `seo4web-${selected.type}-${Date.now()}.md`;
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

  const filtered =
    items?.filter((i) => filter === "all" || i.type === filter) ?? null;

  return (
    <div className="min-h-screen bg-page-bg font-sans text-foreground">
      <Toaster />
      <AppHeader />

      <main className="px-6 pb-24">
        <div className="mx-auto max-w-screen-xl">
          <h1 className="mb-2 font-display text-4xl md:text-5xl leading-tight">
            Tvoja história
          </h1>
          <p className="mb-8 text-secondary-foreground">
            Všetky vygenerované články, audity, plány a briefy. Viditeľné len pre teba.
          </p>

          <div className="mb-6 flex flex-wrap gap-2">
            {(["all", "raketa", "decay", "article", "audit", "plan", "brief"] as FilterType[]).map((f) => (
              <Button variant="studio" size="studio"
                key={f}
                onClick={() => setFilter(f)}
                className={
                  "rounded-full px-3 py-1.5 text-sm transition-colors " +
                  (filter === f
                    ? "bg-primary text-primary-foreground"
                    : "bg-card text-secondary-foreground ring-1 ring-border/5 hover:bg-background")
                }
              >
                {f === "all" ? "Všetko" : TYPE_LABEL[f]}
              </Button>
            ))}
          </div>

          {filtered === null ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-16 animate-pulse rounded-lg bg-card ring-1 ring-border/5" />
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <div className="rounded-lg bg-card p-10 text-center ring-1 ring-border/5">
              <p className="text-muted-foreground">
                {items?.length === 0
                  ? "Zatiaľ nemáš žiadne vygenerované výstupy. Vyskúšaj Blog Writer, SEO Audit, Content Plan alebo SEO Brief."
                  : "V tejto kategórii nič nie je."}
              </p>
            </div>
          ) : (
            <ul className="space-y-2">
              {filtered.map((item) => {
                const Icon = TYPE_ICON[item.type];
                return (
                  <li
                    key={item.id}
                    className="flex items-center justify-between gap-3 rounded-lg bg-card px-4 py-3 ring-1 ring-border/5 hover:ring-border/10 transition"
                  >
                    <Button variant="studio" size="studio"
                      onClick={() => open(item.id)}
                      className="flex flex-1 items-center gap-3 text-left min-w-0"
                    >
                      <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted text-secondary-foreground">
                        <Icon className="size-4" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-foreground">
                          {item.title || `(bez názvu)`}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {TYPE_LABEL[item.type]} ·{" "}
                          {new Date(item.created_at).toLocaleString("sk-SK", {
                            day: "2-digit",
                            month: "2-digit",
                            year: "numeric",
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </p>
                      </div>
                    </Button>
                    <Button variant="studio" size="studio"
                      onClick={() => remove(item.id)}
                      className="flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-danger-subtle hover:text-danger-foreground"
                      aria-label="Zmazať"
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </main>

      {(selected || loadingDetail) && (
        <div
          className="fixed inset-0 z-50 bg-overlay/40 backdrop-blur-sm"
          onClick={() => setSelected(null)}
        >
          <div className="absolute inset-y-0 right-0 w-full max-w-3xl overflow-y-auto bg-card shadow-2xl">
            <div
              className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-border bg-card/95 px-6 py-4 backdrop-blur"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="min-w-0">
                <p className="text-xs text-muted-foreground">
                  {selected ? TYPE_LABEL[selected.type] : ""}
                </p>
                <h2 className="truncate text-base font-medium">
                  {selected?.title || "Načítavam…"}
                </h2>
              </div>
              <div className="flex shrink-0 gap-2">
                <Button variant="studio" size="studio"
                  onClick={copy}
                  disabled={!selected}
                  className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm text-secondary-foreground hover:bg-muted disabled:opacity-50"
                >
                  <Copy className="size-4" /> Kopírovať
                </Button>
                <Button variant="studio" size="studio"
                  onClick={download}
                  disabled={!selected}
                  className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm text-secondary-foreground hover:bg-muted disabled:opacity-50"
                >
                  <ArrowDown className="size-4" /> .md
                </Button>
                <Button variant="studio" size="studio"
                  onClick={() => setSelected(null)}
                  className="flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted"
                  aria-label="Zavrieť"
                >
                  <X className="size-4" />
                </Button>
              </div>
            </div>
            <div className="px-6 py-8" onClick={(e) => e.stopPropagation()}>
              {selected ? (
                <article className="prose prose-neutral max-w-[68ch] prose-headings:font-display prose-h1:text-3xl prose-h2:text-xl prose-h2:mt-10 prose-p:text-secondary-foreground">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {selected.output_markdown}
                  </ReactMarkdown>
                </article>
              ) : (
                <p className="text-sm text-muted-foreground">Načítavam…</p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
