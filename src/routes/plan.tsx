import { Button } from "@/components/ui/button";
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
      { title: "30-dňový Content Plan — SEO4WEB" },
      {
        name: "description",
        content:
          "AI-generovaný 30-dňový SEO obsahový kalendár. Prvý deň zadarmo, potom predplatné.",
      },
      { property: "og:title", content: "30-dňový Content Plan — SEO4WEB" },
      { property: "og:description", content: "AI-generovaný 30-dňový SEO obsahový kalendár. Prvý deň zadarmo, potom predplatné." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
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
      <div className="min-h-screen bg-page-bg flex items-center justify-center text-sm text-muted-foreground">
        Načítavam…
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-page-bg font-sans text-foreground">
      <Toaster />
      <AppHeader />

      <main className="pb-40">
        <section className="px-6">
          <div className="mx-auto max-w-screen-xl">
            <div className="max-w-[40ch]">
              <h1 className="mb-6 font-display text-5xl leading-tight text-balance">
                30-dňový obsahový plán
              </h1>
              <p className="mb-8 text-secondary-foreground text-pretty">
                Zadaj svoju niche a cieľ. AI vygeneruje kompletný SEO kalendár na 30 dní —
                deň po dni, vrátane H1 nadpisov, kľúčových slov a CTA.
              </p>
            </div>

            {access && (
              <div
                className={
                  "mb-6 inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs " +
                  (access.allowed
                    ? "bg-success-subtle text-success-foreground ring-1 ring-success-border"
                    : "bg-warning-subtle text-warning-foreground ring-1 ring-warning-border")
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

            <div className="rounded-lg bg-muted/50 p-1.5 ring-1 ring-border/5">
              <div className="rounded-lg bg-card p-6 shadow-sm space-y-4">
                <div>
                  <label className="text-xs font-medium tracking-normalr text-muted-foreground uppercase">
                    Niche / odvetvie
                  </label>
                  <input
                    value={niche}
                    onChange={(e) => setNiche(e.target.value)}
                    disabled={status === "generating"}
                    placeholder="napr. osobné financie pre mladých"
                    className="mt-2 w-full border-none bg-transparent text-lg placeholder:text-muted-foreground focus:outline-none"
                  />
                </div>
                <div className="border-t border-border pt-4">
                  <label className="text-xs font-medium tracking-normalr text-muted-foreground uppercase">
                    Hlavný cieľ
                  </label>
                  <input
                    value={goal}
                    onChange={(e) => setGoal(e.target.value)}
                    disabled={status === "generating"}
                    placeholder="napr. zvýšiť organickú návštevnosť o 200 %"
                    className="mt-2 w-full border-none bg-transparent text-lg placeholder:text-muted-foreground focus:outline-none"
                  />
                </div>
                <div className="border-t border-border pt-4">
                  <label className="text-xs font-medium tracking-normalr text-muted-foreground uppercase">
                    Doplňujúce info (voliteľné)
                  </label>
                  <textarea
                    value={extra}
                    onChange={(e) => setExtra(e.target.value)}
                    disabled={status === "generating"}
                    rows={2}
                    placeholder="cieľová krajina, konkurencia, aktuálny stav webu…"
                    className="mt-2 w-full resize-none border-none bg-transparent text-base placeholder:text-muted-foreground focus:outline-none"
                  />
                </div>
                <div className="flex items-center justify-end border-t border-border pt-4">
                  <Button variant="studio" size="studio"
                    onClick={run}
                    disabled={status === "generating" || (access ? !access.allowed : false)}
                    className="flex items-center gap-2 rounded-[8px] bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary disabled:opacity-60 disabled:cursor-not-allowed"
                  >
                    {status === "generating"
                      ? "Generujem 30-dňový plán..."
                      : access && !access.allowed
                        ? "Predplatné vyžadované"
                        : "Vygenerovať plán"}
                  </Button>
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
                <div className="min-h-[600px] rounded-lg bg-card p-8 shadow-sm ring-1 ring-border/5 md:p-12">
                  {plan ? (
                    <article className="prose prose-neutral max-w-[68ch] prose-headings:font-display prose-h1:text-4xl prose-h2:text-2xl prose-h3:text-lg prose-p:text-secondary-foreground">
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>{plan}</ReactMarkdown>
                    </article>
                  ) : (
                    <div className="space-y-3">
                      <div className="h-4 w-1/3 animate-pulse rounded bg-muted" />
                      <div className="h-4 w-full animate-pulse rounded bg-muted" />
                      <div className="h-4 w-5/6 animate-pulse rounded bg-muted" />
                      <div className="h-4 w-4/6 animate-pulse rounded bg-muted" />
                      <p className="pt-4 text-xs text-muted-foreground">
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
        <div className="fixed bottom-4 left-1/2 flex flex-wrap justify-center max-w-[calc(100vw-1rem)] -translate-x-1/2 gap-2 rounded-full bg-primary p-2 text-primary-foreground shadow-2xl ring-1 ring-border/10">
          <Button variant="studio" size="studio"
            onClick={run}
            disabled={access ? !access.allowed : false}
            className="flex items-center gap-2 rounded-full py-2 pr-4 pl-3 text-sm font-medium hover:bg-primary disabled:opacity-50"
          >
            <RotateCcw className="size-4" /> Regenerovať
          </Button>
          <div className="my-1 w-px bg-foreground" />
          <Button variant="studio" size="studio" onClick={copy} className="flex items-center gap-2 rounded-full py-2 pr-4 pl-3 text-sm font-medium hover:bg-primary">
            <Copy className="size-4" /> Kopírovať
          </Button>
          <Button variant="studio" size="studio" onClick={download} className="flex items-center gap-2 rounded-full bg-background py-2 pr-4 pl-3 text-sm font-medium text-foreground hover:bg-card">
            <ArrowDown className="size-4" /> Stiahnuť .md
          </Button>
        </div>
      )}
    </div>
  );
}
