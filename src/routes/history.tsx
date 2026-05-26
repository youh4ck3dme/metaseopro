import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState, useCallback } from "react";
import { useServerFn } from "@tanstack/react-start";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { toast } from "sonner";
import { Toaster } from "@/components/ui/sonner";
import { ArrowDown, Copy, Trash2, X, FileText, BarChart3, Calendar, Lightbulb } from "lucide-react";
import { AppHeader } from "@/components/AppHeader";
import { useAuth } from "@/hooks/use-auth";
import { listOutputs, getOutput, deleteOutput } from "@/lib/outputs.functions";

export const Route = createFileRoute("/history")({
  head: () => ({
    meta: [
      { title: "História — Písmo" },
      {
        name: "description",
        content: "Tvoje vygenerované články, audity, plány a briefy na jednom mieste.",
      },
    ],
  }),
  component: HistoryPage,
});

type FilterType = "all" | "article" | "audit" | "plan" | "brief";

type Item = {
  id: string;
  type: "article" | "audit" | "plan" | "brief";
  title: string | null;
  created_at: string;
};

type FullItem = Item & { output_markdown: string; input: unknown };

const TYPE_LABEL: Record<Item["type"], string> = {
  article: "Článok",
  audit: "SEO Audit",
  plan: "Content Plan",
  brief: "SEO Brief",
};

const TYPE_ICON: Record<Item["type"], typeof FileText> = {
  article: FileText,
  audit: BarChart3,
  plan: Calendar,
  brief: Lightbulb,
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
    a.download = `pismo-${selected.type}-${Date.now()}.md`;
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

  const filtered =
    items?.filter((i) => filter === "all" || i.type === filter) ?? null;

  return (
    <div className="min-h-screen bg-page-bg font-sans text-neutral-900">
      <Toaster />
      <AppHeader />

      <main className="px-6 pb-24">
        <div className="mx-auto max-w-screen-xl">
          <h1 className="mb-2 font-serif text-4xl md:text-5xl leading-tight">
            Tvoja história
          </h1>
          <p className="mb-8 text-neutral-600">
            Všetky vygenerované články, audity, plány a briefy. Viditeľné len pre teba.
          </p>

          <div className="mb-6 flex flex-wrap gap-2">
            {(["all", "article", "audit", "plan", "brief"] as FilterType[]).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={
                  "rounded-full px-3 py-1.5 text-sm transition-colors " +
                  (filter === f
                    ? "bg-neutral-900 text-neutral-50"
                    : "bg-white text-neutral-600 ring-1 ring-black/5 hover:bg-neutral-50")
                }
              >
                {f === "all" ? "Všetko" : TYPE_LABEL[f]}
              </button>
            ))}
          </div>

          {filtered === null ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-16 animate-pulse rounded-[12px] bg-white ring-1 ring-black/5" />
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <div className="rounded-[16px] bg-white p-10 text-center ring-1 ring-black/5">
              <p className="text-neutral-500">
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
                    className="flex items-center justify-between gap-3 rounded-[12px] bg-white px-4 py-3 ring-1 ring-black/5 hover:ring-black/10 transition"
                  >
                    <button
                      onClick={() => open(item.id)}
                      className="flex flex-1 items-center gap-3 text-left min-w-0"
                    >
                      <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-neutral-100 text-neutral-600">
                        <Icon className="size-4" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-neutral-900">
                          {item.title || `(bez názvu)`}
                        </p>
                        <p className="text-xs text-neutral-400">
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
                    </button>
                    <button
                      onClick={() => remove(item.id)}
                      className="flex size-8 items-center justify-center rounded-md text-neutral-400 hover:bg-red-50 hover:text-red-600"
                      aria-label="Zmazať"
                    >
                      <Trash2 className="size-4" />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </main>

      {(selected || loadingDetail) && (
        <div
          className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm"
          onClick={() => setSelected(null)}
        >
          <div className="absolute inset-y-0 right-0 w-full max-w-3xl overflow-y-auto bg-white shadow-2xl">
            <div
              className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-neutral-100 bg-white/95 px-6 py-4 backdrop-blur"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="min-w-0">
                <p className="text-xs text-neutral-400">
                  {selected ? TYPE_LABEL[selected.type] : ""}
                </p>
                <h2 className="truncate text-base font-medium">
                  {selected?.title || "Načítavam…"}
                </h2>
              </div>
              <div className="flex shrink-0 gap-2">
                <button
                  onClick={copy}
                  disabled={!selected}
                  className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm text-neutral-600 hover:bg-neutral-100 disabled:opacity-50"
                >
                  <Copy className="size-4" /> Kopírovať
                </button>
                <button
                  onClick={download}
                  disabled={!selected}
                  className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm text-neutral-600 hover:bg-neutral-100 disabled:opacity-50"
                >
                  <ArrowDown className="size-4" /> .md
                </button>
                <button
                  onClick={() => setSelected(null)}
                  className="flex size-8 items-center justify-center rounded-md text-neutral-500 hover:bg-neutral-100"
                  aria-label="Zavrieť"
                >
                  <X className="size-4" />
                </button>
              </div>
            </div>
            <div className="px-6 py-8" onClick={(e) => e.stopPropagation()}>
              {selected ? (
                <article className="prose prose-neutral max-w-[68ch] prose-headings:font-serif prose-h1:text-3xl prose-h2:text-xl prose-h2:mt-10 prose-p:text-neutral-700">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {selected.output_markdown}
                  </ReactMarkdown>
                </article>
              ) : (
                <p className="text-sm text-neutral-500">Načítavam…</p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
