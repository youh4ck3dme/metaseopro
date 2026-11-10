import { Fragment, useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  Printer,
  Sparkles,
  ArrowUpRight,
  ArrowDownRight,
  TrendingUp,
  Target,
  CheckCircle2,
  Calendar,
  Mail,
  Building2,
  X,
  ExternalLink,
  Settings,
  Layers,
  Share2,
  Check,
} from "lucide-react";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import {
  buildExecutiveReportData,
  formatDomainDisplayName,
  generateShareableReportLink,
  type AgencyProfile,
  type ExecutiveReportData,
  DEFAULT_AGENCY_PROFILE,
} from "@/lib/agency";
import type { DecayDataset } from "@/lib/decay-schema";

interface ClientReportModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  siteUrl: string;
  dataset?: DecayDataset | null;
  summary?: {
    pages?: number;
    clicksNow?: number;
    clicksPrev?: number;
    impressionsNow?: number;
    impressionsPrev?: number;
    avgPositionNow?: number;
    avgPositionPrev?: number;
    critical?: number;
    declining?: number;
  };
}

export function ClientReportModal({
  open,
  onOpenChange,
  siteUrl,
  dataset,
  summary,
}: ClientReportModalProps) {
  const [agency, setAgency] = useState<AgencyProfile>(DEFAULT_AGENCY_PROFILE);
  const [experiments, setExperiments] = useState<
    Array<{
      id: string;
      page_url: string;
      implemented_at: string;
      target_queries?: string[];
      changes?: string;
      status?: string;
      baseline?: { clicks?: number; position?: number };
    }>
  >([]);
  const [loading, setLoading] = useState(false);

  // Load agency profile and experiments
  useEffect(() => {
    if (!open) return;
    let active = true;

    async function loadData() {
      setLoading(true);
      try {
        const {
          data: { user },
        } = await supabase.auth.getUser();

        if (user) {
          // 1. Fetch agency profile
          const { data: profile } = await supabase
            .from("agency_profiles" as never)
            .select("*")
            .eq("user_id", user.id)
            .maybeSingle();

          if (active && profile) {
            setAgency(profile as unknown as AgencyProfile);
          }

          // 2. Fetch seo_experiments for this site
          const { data: exps } = await supabase
            .from("seo_experiments")
            .select("id, page_url, implemented_at, target_queries, changes, status, baseline")
            .eq("site_url", siteUrl)
            .order("created_at", { ascending: false })
            .limit(10);

          if (active && exps) {
            setExperiments(exps as never);
          }
        }
      } catch (err) {
        console.error("Error loading agency report data:", err);
      } finally {
        if (active) setLoading(false);
      }
    }

    void loadData();
    return () => {
      active = false;
    };
  }, [open, siteUrl]);

  const report: ExecutiveReportData = buildExecutiveReportData({
    dataset,
    siteUrl,
    summary,
    experiments,
    agencyProfile: agency,
  });

  const [copiedLink, setCopiedLink] = useState(false);

  const handlePrint = () => {
    window.print();
  };

  const handleCopyShareLink = async () => {
    const link = generateShareableReportLink({
      siteUrl,
      agencyName: report.agency.name,
    });
    try {
      await navigator.clipboard.writeText(link);
      setCopiedLink(true);
      toast.success("Odkaz na klientsky report bol skopírovaný do schránky!");
      setTimeout(() => setCopiedLink(false), 2500);
    } catch {
      toast.error("Nepodarilo sa skopírovať odkaz.");
    }
  };

  const fmt = (n: number) => new Intl.NumberFormat("sk-SK").format(Math.round(n));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl p-0 max-h-[92vh] flex flex-col gap-0 overflow-hidden bg-background">
        {/* Modal Toolbar (Hidden during print) */}
        <div className="no-print flex items-center justify-between border-b px-6 py-3.5 bg-card shrink-0">
          <div className="flex items-center gap-3">
            <span
              className="flex size-8 items-center justify-center rounded-lg text-white font-bold text-sm shadow-sm"
              style={{ backgroundColor: report.agency.primaryColor }}
            >
              {report.agency.name.charAt(0).toUpperCase()}
            </span>
            <div>
              <DialogTitle className="text-base font-semibold leading-none">
                Mesačný SEO Report pre klienta
              </DialogTitle>
              <p className="text-xs text-muted-foreground mt-0.5">
                Branding agentúry:{" "}
                <span className="font-medium text-foreground">{report.agency.name}</span> · Web:{" "}
                {report.client.domain}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button
              onClick={handleCopyShareLink}
              variant="outline"
              size="sm"
              className="h-8 gap-1.5 text-xs"
              title="Kopírovať odkaz na report"
            >
              {copiedLink ? (
                <Check className="size-3.5 text-emerald-500" />
              ) : (
                <Share2 className="size-3.5" />
              )}
              {copiedLink ? "Skopírované" : "Zdieľať odkaz"}
            </Button>
            <Button asChild variant="outline" size="sm" className="h-8 gap-1 text-xs">
              <Link to="/settings/agency" onClick={() => onOpenChange(false)}>
                <Settings className="size-3.5" />
                Branding agentúry
              </Link>
            </Button>
            <Button
              onClick={handlePrint}
              size="sm"
              className="h-8 gap-1.5 text-xs font-semibold shadow-sm text-white"
              style={{ backgroundColor: report.agency.primaryColor }}
            >
              <Printer className="size-3.5" />
              Stiahnuť / Tlačiť PDF
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="size-8"
              onClick={() => onOpenChange(false)}
            >
              <X className="size-4" />
            </Button>
          </div>
        </div>

        {/* Scrollable Printable Report Canvas */}
        <div className="overflow-y-auto flex-1 p-6 md:p-10 bg-muted/20">
          <article
            id="executive-client-report"
            className="mx-auto max-w-4xl rounded-xl border border-border bg-card p-8 md:p-12 shadow-sm text-foreground print:border-none print:shadow-none print:p-0 print:max-w-none print:bg-white print:text-black"
          >
            {/* ================= PAGE 1: HEADER & EXECUTIVE SUMMARY ================= */}
            <header className="border-b border-border/80 pb-8 print:pb-6">
              <div className="flex flex-wrap items-start justify-between gap-6">
                {/* Agency Brand Identity */}
                <div className="flex items-center gap-3.5">
                  {report.agency.logoUrl ? (
                    <img
                      src={report.agency.logoUrl}
                      alt={report.agency.name}
                      className="h-12 max-w-[200px] object-contain"
                    />
                  ) : (
                    <div
                      className="flex size-12 items-center justify-center rounded-xl font-bold text-xl text-white shadow-sm"
                      style={{ backgroundColor: report.agency.primaryColor }}
                    >
                      {report.agency.name.slice(0, 2).toUpperCase()}
                    </div>
                  )}
                  <div>
                    <h2 className="font-bold text-lg leading-tight tracking-tight">
                      {report.agency.name}
                    </h2>
                    <p className="text-xs text-muted-foreground flex items-center gap-1.5 mt-0.5 print:text-gray-600">
                      <Mail className="size-3" />
                      {report.agency.contactEmail || "info@agentura.sk"}
                    </p>
                  </div>
                </div>

                {/* Report Meta & Dates */}
                <div className="text-right">
                  <div className="inline-flex items-center gap-1.5 rounded-full bg-muted px-3 py-1 text-xs font-medium text-muted-foreground print:border print:border-gray-200">
                    <Calendar className="size-3 text-primary" />
                    <span>90-dňové porovnávacie obdobie</span>
                  </div>
                  <p className="mt-2 text-xs text-muted-foreground print:text-gray-500">
                    Vygenerované:{" "}
                    <span className="font-medium text-foreground print:text-black">
                      {report.client.generatedAt}
                    </span>
                  </p>
                </div>
              </div>

              {/* Client Title Bar */}
              <div
                className="mt-8 rounded-xl p-6 text-white shadow-sm"
                style={{ backgroundColor: report.agency.primaryColor }}
              >
                <div className="flex flex-wrap items-end justify-between gap-4">
                  <div>
                    <span className="text-xs uppercase tracking-widest opacity-90 font-medium">
                      Mesačný SEO & Performance Report
                    </span>
                    <h1 className="mt-1 text-2xl md:text-3xl font-extrabold tracking-tight">
                      {report.client.domain}
                    </h1>
                    <p className="mt-1 text-xs opacity-85">
                      Porovnanie: {report.client.periodNow} voči {report.client.periodPrev}
                    </p>
                  </div>

                  {/* Health Index Badge */}
                  <div className="rounded-lg bg-black/20 backdrop-blur-sm px-4 py-2.5 text-right border border-white/10">
                    <div className="text-[11px] uppercase tracking-wider opacity-85">
                      SEO Health Index
                    </div>
                    <div className="text-2xl font-black">
                      {report.executiveSummary.healthIndex}{" "}
                      <span className="text-sm font-normal opacity-80">/ 100</span>
                    </div>
                    <div className="text-[11px] font-medium opacity-90">
                      Stav: {report.executiveSummary.healthStatus}
                    </div>
                  </div>
                </div>
              </div>
            </header>

            {/* Executive Summary Cards */}
            <section className="py-8 border-b border-border/80 print:py-6">
              <div className="flex items-center gap-2 mb-4">
                <TrendingUp className="size-5" style={{ color: report.agency.primaryColor }} />
                <h3 className="text-lg font-bold tracking-tight">
                  Výkonnostný sumár (Executive Summary)
                </h3>
              </div>

              <p className="text-sm leading-relaxed text-muted-foreground print:text-gray-700 mb-6 bg-muted/40 p-4 rounded-lg border border-border/40 print:bg-gray-50">
                {report.executiveSummary.executiveNote}
              </p>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {/* Organické kliknutia */}
                <div className="rounded-xl border border-border bg-card p-4 shadow-sm print:bg-white print:border-gray-200">
                  <div className="text-xs text-muted-foreground print:text-gray-500 font-medium">
                    Organické kliky
                  </div>
                  <div className="mt-1.5 text-2xl font-bold tracking-tight">
                    {fmt(report.executiveSummary.clicksNow)}
                  </div>
                  <div className="mt-1.5 flex items-center gap-1 text-xs font-semibold">
                    {report.executiveSummary.clicksDelta >= 0 ? (
                      <span className="flex items-center text-success-foreground">
                        <ArrowUpRight className="size-3.5" />+
                        {fmt(report.executiveSummary.clicksDelta)} (
                        {report.executiveSummary.clicksDeltaPct.toFixed(1)}%)
                      </span>
                    ) : (
                      <span className="flex items-center text-danger-foreground">
                        <ArrowDownRight className="size-3.5" />
                        {fmt(report.executiveSummary.clicksDelta)} (
                        {report.executiveSummary.clicksDeltaPct.toFixed(1)}%)
                      </span>
                    )}
                  </div>
                </div>

                {/* Impresie */}
                <div className="rounded-xl border border-border bg-card p-4 shadow-sm print:bg-white print:border-gray-200">
                  <div className="text-xs text-muted-foreground print:text-gray-500 font-medium">
                    Zobrazenia (Impresie)
                  </div>
                  <div className="mt-1.5 text-2xl font-bold tracking-tight">
                    {fmt(report.executiveSummary.impressionsNow)}
                  </div>
                  <div className="mt-1.5 flex items-center gap-1 text-xs font-semibold">
                    {report.executiveSummary.impressionsDelta >= 0 ? (
                      <span className="flex items-center text-success-foreground">
                        <ArrowUpRight className="size-3.5" />+
                        {fmt(report.executiveSummary.impressionsDelta)} (
                        {report.executiveSummary.impressionsDeltaPct.toFixed(1)}%)
                      </span>
                    ) : (
                      <span className="flex items-center text-danger-foreground">
                        <ArrowDownRight className="size-3.5" />
                        {fmt(report.executiveSummary.impressionsDelta)} (
                        {report.executiveSummary.impressionsDeltaPct.toFixed(1)}%)
                      </span>
                    )}
                  </div>
                </div>

                {/* Priemerná pozícia */}
                <div className="rounded-xl border border-border bg-card p-4 shadow-sm print:bg-white print:border-gray-200">
                  <div className="text-xs text-muted-foreground print:text-gray-500 font-medium">
                    Priemerná pozícia
                  </div>
                  <div className="mt-1.5 text-2xl font-bold tracking-tight">
                    {report.executiveSummary.avgPositionNow.toFixed(1)}
                  </div>
                  <div className="mt-1.5 flex items-center gap-1 text-xs font-semibold">
                    {report.executiveSummary.avgPositionDelta < 0 ? (
                      <span className="flex items-center text-success-foreground">
                        <ArrowUpRight className="size-3.5" />
                        {Math.abs(report.executiveSummary.avgPositionDelta).toFixed(1)} posun vpred
                      </span>
                    ) : report.executiveSummary.avgPositionDelta > 0 ? (
                      <span className="flex items-center text-danger-foreground">
                        <ArrowDownRight className="size-3.5" />+
                        {report.executiveSummary.avgPositionDelta.toFixed(1)} pokles
                      </span>
                    ) : (
                      <span className="text-muted-foreground">stabilná pozícia</span>
                    )}
                  </div>
                </div>

                {/* Počet URL */}
                <div className="rounded-xl border border-border bg-card p-4 shadow-sm print:bg-white print:border-gray-200">
                  <div className="text-xs text-muted-foreground print:text-gray-500 font-medium">
                    Analyzované URL
                  </div>
                  <div className="mt-1.5 text-2xl font-bold tracking-tight">
                    {report.executiveSummary.totalPages}
                  </div>
                  <div className="mt-1.5 text-xs text-muted-foreground print:text-gray-500">
                    indexovaných v Google
                  </div>
                </div>
              </div>
            </section>

            {/* ================= PAGE 2: TOP WINNERS & STRIKING DISTANCE ================= */}
            <section className="py-8 border-b border-border/80 print:py-6 break-inside-avoid">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <Sparkles className="size-5" style={{ color: report.agency.primaryColor }} />
                  <h3 className="text-lg font-bold tracking-tight">
                    Top víťazi mesiaca (Rastúce výrazy & URL)
                  </h3>
                </div>
                <span className="text-xs text-muted-foreground print:text-gray-500">
                  Najväčší nárast organických kliknutí
                </span>
              </div>

              {report.topWinners.length === 0 ? (
                <p className="text-sm text-muted-foreground py-3">
                  Zatiaľ nie sú zaznamenané výrazné skoky v klikoch.
                </p>
              ) : (
                <div className="overflow-hidden rounded-lg border border-border/80 print:border-gray-200">
                  <table className="w-full text-left text-sm">
                    <thead className="bg-muted/50 text-xs font-semibold text-muted-foreground uppercase tracking-wider print:bg-gray-100 print:text-gray-700">
                      <tr>
                        <th className="py-2.5 px-3.5">Kľúčový výraz / URL</th>
                        <th className="py-2.5 px-3.5 text-right">Kliky (Aktuálne)</th>
                        <th className="py-2.5 px-3.5 text-right">Predtým</th>
                        <th className="py-2.5 px-3.5 text-right">Nárast</th>
                        <th className="py-2.5 px-3.5 text-right">Pozícia</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/60 print:divide-gray-200">
                      {report.topWinners.map((w, idx) => (
                        <tr key={idx} className="hover:bg-muted/20 print:hover:bg-transparent">
                          <td className="py-2.5 px-3.5">
                            <div className="font-semibold text-foreground print:text-black">
                              {w.query}
                            </div>
                            <div className="text-xs text-muted-foreground truncate max-w-sm print:text-gray-600">
                              {w.url.replace(/^https?:\/\/[^/]+/i, "")}
                            </div>
                          </td>
                          <td className="py-2.5 px-3.5 text-right font-bold">{fmt(w.clicksNow)}</td>
                          <td className="py-2.5 px-3.5 text-right text-muted-foreground print:text-gray-500">
                            {fmt(w.clicksPrev)}
                          </td>
                          <td className="py-2.5 px-3.5 text-right font-semibold text-success-foreground">
                            +{fmt(w.clicksDelta)}
                          </td>
                          <td className="py-2.5 px-3.5 text-right font-medium">
                            {w.positionNow.toFixed(1)}
                            {w.positionDelta > 0.5 && (
                              <span className="text-[11px] text-success-foreground ml-1">
                                (↑ {w.positionDelta.toFixed(1)})
                              </span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            {/* Striking Distance Opportunities */}
            <section className="py-8 border-b border-border/80 print:py-6 break-inside-avoid">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <Target className="size-5" style={{ color: report.agency.primaryColor }} />
                  <h3 className="text-lg font-bold tracking-tight">
                    Odhalené príležitosti (Striking Distance — pozície 4–15)
                  </h3>
                </div>
                <span className="text-xs text-muted-foreground print:text-gray-500">
                  Vysoké zobrazenia s potenciálom rýchleho skoku
                </span>
              </div>

              {report.opportunities.length === 0 ? (
                <p className="text-sm text-muted-foreground py-3">
                  Žiadne dopyty v Striking Distance nevyžadujú okamžitý zásah.
                </p>
              ) : (
                <div className="overflow-hidden rounded-lg border border-border/80 print:border-gray-200">
                  <table className="w-full text-left text-sm">
                    <thead className="bg-muted/50 text-xs font-semibold text-muted-foreground uppercase tracking-wider print:bg-gray-100 print:text-gray-700">
                      <tr>
                        <th className="py-2.5 px-3.5">Dopyt & URL</th>
                        <th className="py-2.5 px-3.5 text-center">Pozícia</th>
                        <th className="py-2.5 px-3.5 text-right">Impresie</th>
                        <th className="py-2.5 px-3.5 text-right">Potenciál</th>
                        <th className="py-2.5 px-3.5">Odporúčaná akcia agentúry</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/60 print:divide-gray-200">
                      {report.opportunities.map((o, idx) => (
                        <tr key={idx} className="hover:bg-muted/20 print:hover:bg-transparent">
                          <td className="py-2.5 px-3.5">
                            <div className="font-semibold text-foreground print:text-black">
                              {o.query}
                            </div>
                            <div className="text-xs text-muted-foreground truncate max-w-xs print:text-gray-600">
                              {o.url.replace(/^https?:\/\/[^/]+/i, "")}
                            </div>
                          </td>
                          <td className="py-2.5 px-3.5 text-center">
                            <span className="inline-block rounded bg-primary/10 text-primary px-2 py-0.5 font-bold text-xs print:bg-gray-100 print:text-black">
                              {o.position.toFixed(1)}
                            </span>
                          </td>
                          <td className="py-2.5 px-3.5 text-right font-medium">
                            {fmt(o.impressions)}
                          </td>
                          <td className="py-2.5 px-3.5 text-right font-bold text-success-foreground">
                            {o.potentialGrowth}
                          </td>
                          <td className="py-2.5 px-3.5 text-xs text-muted-foreground print:text-gray-700">
                            {o.recommendedAction}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            {/* ================= PAGE 3: OPTIMIZATIONS & NEXT MONTH PLAN ================= */}
            <section className="py-8 border-b border-border/80 print:py-6 break-inside-avoid">
              <div className="flex items-center gap-2 mb-4">
                <CheckCircle2 className="size-5" style={{ color: report.agency.primaryColor }} />
                <h3 className="text-lg font-bold tracking-tight">
                  Realizované optimalizácie v sledovanom období
                </h3>
              </div>

              <div className="space-y-3">
                {report.realizedOptimizations.map((exp) => (
                  <div
                    key={exp.id}
                    className="flex flex-wrap items-start justify-between gap-3 rounded-lg border border-border/70 p-3.5 bg-card/60 text-sm print:bg-white print:border-gray-200"
                  >
                    <div className="space-y-1 max-w-xl">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-semibold px-2 py-0.5 rounded bg-muted text-muted-foreground print:border print:border-gray-200">
                          {exp.implemented_at}
                        </span>
                        <span className="text-xs font-medium text-foreground truncate print:text-black">
                          {exp.page_url.replace(/^https?:\/\/[^/]+/i, "")}
                        </span>
                      </div>
                      <p className="text-xs text-foreground/90 font-medium print:text-black">
                        {exp.changes}
                      </p>
                      {exp.target_queries.length > 0 && (
                        <p className="text-[11px] text-muted-foreground print:text-gray-600">
                          Cielené kľúčové slová: {exp.target_queries.join(", ")}
                        </p>
                      )}
                    </div>
                    <span className="inline-flex items-center gap-1 text-xs font-semibold text-success-foreground bg-success-subtle px-2.5 py-1 rounded-full print:bg-gray-100 print:text-green-700">
                      <CheckCircle2 className="size-3" />
                      {exp.status}
                    </span>
                  </div>
                ))}
              </div>
            </section>

            {/* Strategic Recommendations for Next Month */}
            <section className="py-8 border-b border-border/80 print:py-6 break-inside-avoid">
              <div className="flex items-center gap-2 mb-4">
                <Layers className="size-5" style={{ color: report.agency.primaryColor }} />
                <h3 className="text-lg font-bold tracking-tight">
                  Strategické odporúčania a akčný plán na ďalší mesiac
                </h3>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                {report.recommendations.map((rec, i) => (
                  <div
                    key={i}
                    className="rounded-lg border border-border/70 p-4 bg-muted/20 print:bg-white print:border-gray-200 space-y-1.5"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <h4 className="font-bold text-sm text-foreground print:text-black">
                        {rec.title}
                      </h4>
                      <span
                        className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded text-white"
                        style={{ backgroundColor: report.agency.primaryColor }}
                      >
                        {rec.priority}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground leading-relaxed print:text-gray-700">
                      {rec.description}
                    </p>
                    <div className="text-[11px] font-semibold text-primary pt-1 print:text-gray-800">
                      Očakávaný dopad: {rec.impact}
                    </div>
                  </div>
                ))}
              </div>
            </section>

            {/* Whitelabel Footer */}
            <footer className="pt-8 text-center text-xs text-muted-foreground print:pt-6 print:text-gray-600 break-inside-avoid">
              <p className="font-medium text-foreground print:text-black">
                {report.agency.footerText}
              </p>
              <p className="mt-1">
                Otázky a konzultácie k reportu:{" "}
                <span className="font-semibold text-foreground print:text-black">
                  {report.agency.contactEmail}
                </span>
              </p>
              <p className="mt-2 text-[10px] opacity-75">
                Tento dokument je dôverný a určený výhradne pre klienta {report.client.domain}.
                Všetky práva vyhradené © {new Date().getFullYear()} {report.agency.name}.
              </p>
            </footer>
          </article>
        </div>
      </DialogContent>
    </Dialog>
  );
}
