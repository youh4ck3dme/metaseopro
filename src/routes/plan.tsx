import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { toast } from "sonner";
import { Toaster } from "@/components/ui/sonner";
import { ArrowDown, Copy, RotateCcw, Lock } from "lucide-react";
import { AppHeader } from "@/components/AppHeader";
import { SidebarTips } from "@/components/SidebarTips";
import { useAuth } from "@/hooks/use-auth";
import {
  generateContentPlan,
  checkContentPlanAccess,
} from "@/lib/content-plan.functions";
import { saveOutput } from "@/lib/outputs.functions";

export const Route = createFileRoute("/plan")({
  head: () => ({
    meta: [
      { title: "30-dňový Content Plan — Písmo" },
      {
        name: "description",
        content:
          "AI-generovaný 30-dňový SEO obsahový kalendár. Prvý deň zadarmo, potom predplatné.",
      },
    ],
  }),
  component: PlanPage,
});

type Access = {
  allowed: boolean;
  isFirstDay: boolean;
  generationsCount: number;
  firstUsedAt: string | null;
};

function PlanPage() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const checkAccess = useServerFn(checkContentPlanAccess);
  const generate = useServerFn(generateContentPlan);
  const save = useServerFn(saveOutput);

  const [access, setAccess] = useState<Access | null>(null);
  const [niche, setNiche] = useState("");
  const [goal, setGoal] = useState("");
  const [extra, setExtra] = useState("");
  const [plan, setPlan] = useState("");
  const [status, setStatus] = useState<"idle" | "generating" | "done">("idle");

  useEffect(() => {
    if (!loading && !user) navigate({ to: "/login", search: { redirect: "/plan" } });
  }, [user, loading, navigate]);

  useEffect(() => {
    if (user) checkAccess({}).then(setAccess).catch(() => {});
  }, [user, checkAccess]);

  const run = async () => {
    if (niche.trim().length < 2 || goal.trim().length < 2) {
      toast.error("Vyplň niche aj cieľ.");
      return;
    }
    setStatus("generating");
    setPlan("");
    try {
      const res = await generate({ data: { niche, goal, extra } });
      setPlan(res.plan);
      setStatus("done");
      const a = await checkAccess({});
      setAccess(a);
      try {
        await save({
          data: {
            type: "plan",
            title: `Plán: ${niche.trim()}`.slice(0, 200),
            input: { niche, goal, extra },
            output_markdown: res.plan,
          },
        });
      } catch (err) {
        console.error(err);
      }
    } catch (e) {
      const msg = (e as Error).message ?? "Chyba";
      if (msg.includes("PAYMENT_REQUIRED")) {
        toast.error("Tvoj prvý deň zdarma sa skončil. Predplatné bude čoskoro dostupné.");
        setAccess({ ...(access ?? { generationsCount: 0, firstUsedAt: null }), allowed: false, isFirstDay: false });
      } else {
        toast.error(msg);
      }
      setStatus("idle");
    }
  };

  const copy = async () => {
    if (!plan) return;
    await navigator.clipboard.writeText(plan);
    toast.success("Skopírované");
  };
  const download = () => {
    if (!plan) return;
    const blob = new Blob([plan], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `content-plan-${Date.now()}.md`;
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

  return (
    <div className="min-h-screen bg-page-bg font-sans text-neutral-900">
      <Toaster />
      <AppHeader />

      <main className="pb-40">
        <section className="px-6">
          <div className="mx-auto max-w-screen-xl">
            <div className="max-w-[40ch]">
              <h1 className="mb-6 font-serif text-5xl leading-tight text-balance">
                30-dňový obsahový plán
              </h1>
              <p className="mb-8 text-neutral-600 text-pretty">
                Zadaj svoju niche a cieľ. AI vygeneruje kompletný SEO kalendár na 30 dní —
                deň po dni, vrátane H1 nadpisov, kľúčových slov a CTA.
              </p>
            </div>

            {access && (
              <div
                className={
                  "mb-6 inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs " +
                  (access.allowed
                    ? "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200"
                    : "bg-amber-50 text-amber-800 ring-1 ring-amber-200")
                }
              >
                {access.allowed ? (
                  access.generationsCount === 0 ? (
                    <>🎁 Prvý plán máš zadarmo</>
                  ) : (
                    <>✅ Prvý deň zadarmo aktívny ({access.generationsCount} generovaní)</>
                  )
                ) : (
                  <>
                    <Lock className="size-3" /> Free deň ukončený — predplatné bude čoskoro
                  </>
                )}
              </div>
            )}

            <div className="rounded-[16px] bg-neutral-100/50 p-1.5 ring-1 ring-black/5">
              <div className="rounded-[12px] bg-white p-6 shadow-sm space-y-4">
                <div>
                  <label className="text-xs font-medium tracking-wider text-neutral-400 uppercase">
                    Niche / odvetvie
                  </label>
                  <input
                    value={niche}
                    onChange={(e) => setNiche(e.target.value)}
                    disabled={status === "generating"}
                    placeholder="napr. osobné financie pre mladých"
                    className="mt-2 w-full border-none bg-transparent text-lg placeholder:text-neutral-300 focus:outline-none"
                  />
                </div>
                <div className="border-t border-neutral-100 pt-4">
                  <label className="text-xs font-medium tracking-wider text-neutral-400 uppercase">
                    Hlavný cieľ
                  </label>
                  <input
                    value={goal}
                    onChange={(e) => setGoal(e.target.value)}
                    disabled={status === "generating"}
                    placeholder="napr. zvýšiť organickú návštevnosť o 200 %"
                    className="mt-2 w-full border-none bg-transparent text-lg placeholder:text-neutral-300 focus:outline-none"
                  />
                </div>
                <div className="border-t border-neutral-100 pt-4">
                  <label className="text-xs font-medium tracking-wider text-neutral-400 uppercase">
                    Doplňujúce info (voliteľné)
                  </label>
                  <textarea
                    value={extra}
                    onChange={(e) => setExtra(e.target.value)}
                    disabled={status === "generating"}
                    rows={2}
                    placeholder="cieľová krajina, konkurencia, aktuálny stav webu…"
                    className="mt-2 w-full resize-none border-none bg-transparent text-base placeholder:text-neutral-300 focus:outline-none"
                  />
                </div>
                <div className="flex items-center justify-end border-t border-neutral-100 pt-4">
                  <button
                    onClick={run}
                    disabled={status === "generating" || (access ? !access.allowed : false)}
                    className="flex items-center gap-2 rounded-[8px] bg-neutral-900 px-4 py-2 text-sm font-medium text-neutral-50 hover:bg-neutral-800 disabled:opacity-60 disabled:cursor-not-allowed"
                  >
                    {status === "generating"
                      ? "Generujem 30-dňový plán..."
                      : access && !access.allowed
                        ? "Predplatné vyžadované"
                        : "Vygenerovať plán"}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </section>

        {(status !== "idle" || plan) && (
          <section className="mt-16 px-6">
            <div className="mx-auto grid max-w-screen-xl grid-cols-12 gap-12">
              <SidebarTips
                title="Ako Content Plan pracuje"
                steps={[
                  "Analyzuje tvoju niche a cieľ z pohľadu E-E-A-T a search intent.",
                  "Navrhuje 30-dňový mix obsahu: how-to, listicles, ultimate guides, case studies.",
                  "Pre každý deň pripraví H1, primárne KW, dĺžku a CTA pripravené na publikáciu.",
                ]}
              />
              <div className="col-span-12 lg:col-span-8">
                <div className="min-h-[600px] rounded-[12px] bg-white p-8 shadow-sm ring-1 ring-black/5 md:p-12">
                  {plan ? (
                    <article className="prose prose-neutral max-w-[68ch] prose-headings:font-serif prose-h1:text-4xl prose-h2:text-2xl prose-h3:text-lg prose-p:text-neutral-700">
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>{plan}</ReactMarkdown>
                    </article>
                  ) : (
                    <div className="space-y-3">
                      <div className="h-4 w-1/3 animate-pulse rounded bg-neutral-100" />
                      <div className="h-4 w-full animate-pulse rounded bg-neutral-100" />
                      <div className="h-4 w-5/6 animate-pulse rounded bg-neutral-100" />
                      <div className="h-4 w-4/6 animate-pulse rounded bg-neutral-100" />
                      <p className="pt-4 text-xs text-neutral-400">
                        AI pripravuje kompletný 30-dňový plán. Môže to trvať 30–60 sekúnd.
                      </p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </section>
        )}
      </main>

      {status === "done" && plan && (
        <div className="fixed bottom-8 left-1/2 flex -translate-x-1/2 gap-2 rounded-full bg-neutral-900 p-2 text-neutral-50 shadow-2xl ring-1 ring-black/10">
          <button
            onClick={run}
            disabled={access ? !access.allowed : false}
            className="flex items-center gap-2 rounded-full py-2 pr-4 pl-3 text-sm font-medium hover:bg-neutral-800 disabled:opacity-50"
          >
            <RotateCcw className="size-4" /> Regenerovať
          </button>
          <div className="my-1 w-px bg-neutral-700" />
          <button onClick={copy} className="flex items-center gap-2 rounded-full py-2 pr-4 pl-3 text-sm font-medium hover:bg-neutral-800">
            <Copy className="size-4" /> Kopírovať
          </button>
          <button onClick={download} className="flex items-center gap-2 rounded-full bg-neutral-50 py-2 pr-4 pl-3 text-sm font-medium text-neutral-900 hover:bg-white">
            <ArrowDown className="size-4" /> Stiahnuť .md
          </button>
        </div>
      )}
    </div>
  );
}
