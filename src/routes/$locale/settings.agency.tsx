import { useState, useEffect } from "react";
import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { AppHeader } from "@/components/AppHeader";
import { Toaster } from "@/components/ui/sonner";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Building2,
  Sparkles,
  Palette,
  Mail,
  FileText,
  Image as ImageIcon,
  Check,
  Printer,
  ShieldCheck,
  ArrowRight,
  Loader2,
  Eye,
  CreditCard,
  Globe,
} from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import { DEFAULT_AGENCY_PROFILE, type AgencyProfile } from "@/lib/agency";
import { PaywallModal } from "@/components/PaywallModal";
import { ClientReportModal } from "@/components/ClientReportModal";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { BillingInvoiceSection } from "@/components/BillingInvoiceSection";
import { CmsConnectionsSection } from "@/components/CmsConnectionsSection";

export const Route = createFileRoute("/$locale/settings/agency")({
  head: () => ({
    meta: [
      { title: "Nastavenia agentúry & Whitelabel Branding — SEO4WEB" },
      {
        name: "description",
        content:
          "Nastavte si logo, farby a kontaktné údaje vašej marketingovej agentúry pre automatické mesačné SEO reporty pre klientov.",
      },
      { property: "og:title", content: "Nastavenia agentúry — SEO4WEB" },
      {
        property: "og:description",
        content: "Identita agentúry, vlastné logo a branding klientskych SEO reportov.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AgencySettingsPage,
});

const COLOR_PRESETS = [
  { name: "Smaragdová (Emerald)", hex: "#10b981" },
  { name: "Zafírová (Sapphire)", hex: "#2563eb" },
  { name: "Kráľovská modrá (Indigo)", hex: "#6366f1" },
  { name: "Fialová (Purple)", hex: "#8b5cf6" },
  { name: "Ružová (Rose)", hex: "#ec4899" },
  { name: "Jantárová (Amber)", hex: "#f59e0b" },
  { name: "Antracit (Slate)", hex: "#0f172a" },
  { name: "Čierna (Minimal)", hex: "#18181b" },
];

function AgencySettingsPage() {
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();

  const [agencyName, setAgencyName] = useState(DEFAULT_AGENCY_PROFILE.agency_name);
  const [logoUrl, setLogoUrl] = useState<string>("");
  const [primaryColor, setPrimaryColor] = useState(DEFAULT_AGENCY_PROFILE.primary_color);
  const [contactEmail, setContactEmail] = useState(DEFAULT_AGENCY_PROFILE.contact_email || "");
  const [reportFooterText, setReportFooterText] = useState(
    DEFAULT_AGENCY_PROFILE.report_footer_text || "",
  );

  const [saving, setSaving] = useState(false);
  const [loadingData, setLoadingData] = useState(true);
  const [userPlan, setUserPlan] = useState<"free" | "pro" | "agency">("free");
  const [paywallOpen, setPaywallOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);

  // Authentication redirect guard - immediately redirect unauthenticated users
  useEffect(() => {
    if (!authLoading && !user) {
      void navigate({ to: "/login", search: { redirect: "/settings/agency" } });
    }
  }, [user, authLoading, navigate]);

  // Load existing profile and subscription
  useEffect(() => {
    if (!user) return;
    const currentUserId = user.id;
    let active = true;

    async function fetchData() {
      setLoadingData(true);
      try {
        // 1. Fetch user subscription
        const { data: sub, error: subError } = await supabase
          .from("subscriptions")
          .select("plan, status")
          .eq("user_id", currentUserId)
          .maybeSingle();

        if (subError) throw subError;
        if (active && sub) {
          const p = sub.plan;
          if (p === "agency" || p === "pro" || p === "free") {
            setUserPlan(p);
          }
        }

        // 2. Fetch agency profile
        const { data: profile, error: profileError } = await supabase
          .from("agency_profiles")
          .select("*")
          .eq("user_id", currentUserId)
          .maybeSingle();

        if (profileError) throw profileError;
        if (active && profile) {
          setAgencyName(profile.agency_name || DEFAULT_AGENCY_PROFILE.agency_name);
          setLogoUrl(profile.logo_url || "");
          setPrimaryColor(profile.primary_color || DEFAULT_AGENCY_PROFILE.primary_color);
          setContactEmail(profile.contact_email || user?.email || "");
          setReportFooterText(
            profile.report_footer_text || DEFAULT_AGENCY_PROFILE.report_footer_text || "",
          );
        } else if (active && user?.email) {
          setContactEmail(user.email);
        }
      } catch (err) {
        console.error("Error loading agency profile:", err);
        if (active) toast.error("Nepodarilo sa načítať nastavenia agentúry.");
      } finally {
        if (active) setLoadingData(false);
      }
    }

    void fetchData();
    return () => {
      active = false;
    };
  }, [user]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) {
      toast.error("Pre uloženie nastavení sa musíte prihlásiť.");
      navigate({ to: "/login", search: { redirect: "/settings/agency" } });
      return;
    }

    if (!agencyName.trim()) {
      toast.error("Zadajte prosím názov agentúry.");
      return;
    }

    setSaving(true);
    try {
      const payload = {
        user_id: user.id,
        agency_name: agencyName.trim(),
        logo_url: logoUrl.trim() || null,
        primary_color: primaryColor,
        contact_email: contactEmail.trim() || null,
        report_footer_text: reportFooterText.trim() || null,
        updated_at: new Date().toISOString(),
      };

      const { error } = await supabase
        .from("agency_profiles")
        .upsert(payload, { onConflict: "user_id" });

      if (error) {
        throw error;
      }

      toast.success("Branding agentúry bol úspešne uložený!");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Nepodarilo sa uložiť profil agentúry.");
    } finally {
      setSaving(false);
    }
  };

  if (authLoading || !user) {
    return (
      <div className="min-h-screen bg-background text-foreground pb-20">
        <AppHeader />
        <Toaster />
        <main className="mx-auto flex max-w-5xl min-h-[60vh] flex-col items-center justify-center px-6 text-center">
          <Loader2 className="size-8 animate-spin text-primary mb-4" />
          <p className="text-sm font-medium text-muted-foreground">
            {authLoading ? "Overujem prihlásenie…" : "Presmerovávam na prihlásenie…"}
          </p>
        </main>
      </div>
    );
  }

  const isAgencyPlan = userPlan === "agency";

  return (
    <div className="min-h-screen bg-background text-foreground pb-20">
      <AppHeader />
      <Toaster />

      <main className="mx-auto max-w-5xl px-6">
        {/* Page Header */}
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border/80 pb-6">
          <div>
            <div className="flex items-center gap-2">
              <span
                className="flex size-7 items-center justify-center rounded-md text-white font-bold text-xs"
                style={{ backgroundColor: primaryColor }}
              >
                <Building2 className="size-4" />
              </span>
              <p className="text-xs uppercase tracking-widest text-muted-foreground font-semibold">
                Whitelabel Report Engine
              </p>
            </div>
            <h1 className="mt-1 text-3xl font-bold tracking-tight md:text-4xl">
              Nastavenia agentúry & Branding
            </h1>
            <p className="mt-1.5 text-sm text-muted-foreground max-w-2xl">
              Prispôsobte si vzhľad mesačných SEO reportov pre vašich klientov. Každý exportovaný
              PDF report bude niesť logo, kontakty a farby vašej agentúry bez loga SEO4WEB.
            </p>
          </div>

          <div className="flex items-center gap-2.5">
            <Button
              variant="outline"
              onClick={() => setPreviewOpen(true)}
              className="gap-1.5 text-xs font-semibold"
            >
              <Eye className="size-4" />
              Náhľad klientskeho reportu
            </Button>
            <Button
              form="agency-form"
              type="submit"
              disabled={saving}
              className="gap-1.5 text-xs font-semibold text-white shadow-sm"
              style={{ backgroundColor: primaryColor }}
            >
              {saving ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Check className="size-3.5" />
              )}
              Uložiť branding
            </Button>
          </div>
        </div>

        {/* Agency Plan Status Banner */}
        {!isAgencyPlan && (
          <div className="mt-6 rounded-xl border border-primary/20 bg-primary/5 p-4 md:p-5 flex flex-wrap items-center justify-between gap-4">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <span className="inline-flex items-center rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-semibold text-primary">
                  Váš aktuálny balík: {userPlan.toUpperCase()}
                </span>
                <span className="text-xs text-muted-foreground">
                  · Whitelabel PDF je funkcia balíka Agency
                </span>
              </div>
              <p className="text-sm font-medium text-foreground">
                Získajte neobmedzené klientske PDF reporty s vlastným logom a neobmedzený počet
                sledovaných webov.
              </p>
            </div>
            <Button
              onClick={() => setPaywallOpen(true)}
              className="gap-1.5 text-xs font-semibold text-white shadow-sm"
              style={{ backgroundColor: primaryColor }}
            >
              <Sparkles className="size-3.5" />
              Aktivovať Agency (89 € / mes.)
            </Button>
          </div>
        )}

        <Tabs defaultValue="branding" className="mt-8">
          <TabsList className="mb-6 grid w-full max-w-xl grid-cols-3">
            <TabsTrigger value="branding" className="gap-2">
              <Building2 className="size-4" />
              <span>Branding & Report</span>
            </TabsTrigger>
            <TabsTrigger value="cms" className="gap-2">
              <Globe className="size-4" />
              <span>CMS Integrácie</span>
            </TabsTrigger>
            <TabsTrigger value="billing" className="gap-2">
              <CreditCard className="size-4" />
              <span>Fakturačné údaje</span>
            </TabsTrigger>
          </TabsList>

          <TabsContent value="branding">
            <div className="grid gap-8 lg:grid-cols-12">
              {/* Settings Form */}
              <div className="lg:col-span-7">
                <form id="agency-form" onSubmit={handleSave} className="space-y-6">
                  {/* Agency Name */}
                  <div className="rounded-xl border border-border bg-card p-5 space-y-4 shadow-sm">
                    <div className="flex items-center gap-2 font-semibold text-sm">
                      <Building2 className="size-4 text-primary" />
                      <span>Základná identita agentúry</span>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="agencyName" className="text-xs font-medium">
                        Názov marketingovej / SEO agentúry{" "}
                        <span className="text-danger-foreground">*</span>
                      </Label>
                      <Input
                        id="agencyName"
                        value={agencyName}
                        onChange={(e) => setAgencyName(e.target.value)}
                        placeholder="napr. Apex Media & Performance"
                        required
                      />
                      <p className="text-[11px] text-muted-foreground">
                        Tento názov bude uvedený na titulnej strane a v záhlaví každého
                        vygenerovaného PDF reportu.
                      </p>
                    </div>

                    {/* Logo URL */}
                    <div className="space-y-2">
                      <Label htmlFor="logoUrl" className="text-xs font-medium">
                        URL adresa loga agentúry (PNG, SVG, WebP)
                      </Label>
                      <div className="flex gap-2">
                        <Input
                          id="logoUrl"
                          value={logoUrl}
                          onChange={(e) => setLogoUrl(e.target.value)}
                          placeholder="https://vasa-agentura.sk/logo.png"
                        />
                      </div>
                      <p className="text-[11px] text-muted-foreground">
                        Odporúčaný formát: horizontálne logo s transparentným pozadím na svetlom
                        podklade.
                      </p>
                    </div>

                    {/* Contact Email */}
                    <div className="space-y-2">
                      <Label htmlFor="contactEmail" className="text-xs font-medium">
                        Kontaktný e-mail pre klientov
                      </Label>
                      <Input
                        id="contactEmail"
                        type="email"
                        value={contactEmail}
                        onChange={(e) => setContactEmail(e.target.value)}
                        placeholder="reporty@vasa-agentura.sk"
                      />
                      <p className="text-[11px] text-muted-foreground">
                        Zobrazí sa v záhlaví a pätičke reportu pre prípadné otázky klienta.
                      </p>
                    </div>
                  </div>

                  {/* Color Scheme */}
                  <div className="rounded-xl border border-border bg-card p-5 space-y-4 shadow-sm">
                    <div className="flex items-center gap-2 font-semibold text-sm">
                      <Palette className="size-4 text-primary" />
                      <span>Farba brandingu a akcenty</span>
                    </div>

                    <div>
                      <Label className="text-xs font-medium">Výber primárnej farby reportu</Label>
                      <p className="text-[11px] text-muted-foreground mb-3">
                        Vyberte farbu korešpondujúcu s vašou firemnou identitou.
                      </p>
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                        {COLOR_PRESETS.map((col) => {
                          const selected = primaryColor.toLowerCase() === col.hex.toLowerCase();
                          return (
                            <button
                              key={col.hex}
                              type="button"
                              onClick={() => setPrimaryColor(col.hex)}
                              className={`flex items-center gap-2 rounded-lg border p-2 text-left text-xs transition-colors ${
                                selected
                                  ? "border-foreground ring-2 ring-primary/20 bg-muted/60 font-semibold"
                                  : "border-border hover:bg-muted/40"
                              }`}
                            >
                              <span
                                className="size-4 rounded-full border border-black/10 shrink-0"
                                style={{ backgroundColor: col.hex }}
                              />
                              <span className="truncate">{col.name.split(" ")[0]}</span>
                            </button>
                          );
                        })}
                      </div>

                      <div className="mt-4 flex items-center gap-3">
                        <Label htmlFor="customHex" className="text-xs shrink-0">
                          Vlastný HEX kód:
                        </Label>
                        <div className="flex items-center gap-2">
                          <input
                            type="color"
                            value={primaryColor}
                            onChange={(e) => setPrimaryColor(e.target.value)}
                            className="size-8 cursor-pointer rounded border border-border bg-transparent p-0.5"
                          />
                          <Input
                            id="customHex"
                            value={primaryColor}
                            onChange={(e) => setPrimaryColor(e.target.value)}
                            className="w-28 text-xs font-mono uppercase"
                            maxLength={7}
                          />
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Report Footer Text */}
                  <div className="rounded-xl border border-border bg-card p-5 space-y-4 shadow-sm">
                    <div className="flex items-center gap-2 font-semibold text-sm">
                      <FileText className="size-4 text-primary" />
                      <span>Pätička a právna doložka reportu</span>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="reportFooter" className="text-xs font-medium">
                        Text do pätičky reportu
                      </Label>
                      <Textarea
                        id="reportFooter"
                        rows={3}
                        value={reportFooterText}
                        onChange={(e) => setReportFooterText(e.target.value)}
                        placeholder="Dôverný mesačný SEO report. Vypracované marketingovou agentúrou XYZ pre klienta."
                      />
                      <p className="text-[11px] text-muted-foreground">
                        Tento text sa vytlačí na spodku každej strany klientskeho reportu.
                      </p>
                    </div>
                  </div>
                </form>
              </div>

              {/* Live Preview Panel */}
              <div className="lg:col-span-5 space-y-4">
                <div className="sticky top-6 rounded-xl border border-border bg-card p-5 shadow-sm space-y-4">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                      <Eye className="size-3.5 text-primary" />
                      Živý náhľad klientskeho reportu
                    </span>
                    <span className="text-[10px] rounded bg-muted px-2 py-0.5 font-medium">
                      100% Whitelabel
                    </span>
                  </div>

                  {/* Mini Report Card Preview */}
                  <div className="rounded-lg border border-border bg-background p-4 shadow-sm space-y-4 text-xs">
                    {/* Header snippet */}
                    <div className="flex items-center justify-between border-b pb-3">
                      <div className="flex items-center gap-2">
                        {logoUrl ? (
                          <img
                            src={logoUrl}
                            alt={agencyName}
                            className="h-7 max-w-[100px] object-contain"
                          />
                        ) : (
                          <div
                            className="flex size-7 items-center justify-center rounded font-bold text-white text-[11px]"
                            style={{ backgroundColor: primaryColor }}
                          >
                            {agencyName.slice(0, 2).toUpperCase()}
                          </div>
                        )}
                        <div>
                          <div className="font-bold text-foreground text-xs leading-none">
                            {agencyName}
                          </div>
                          <div className="text-[10px] text-muted-foreground mt-0.5">
                            {contactEmail || "info@agentura.sk"}
                          </div>
                        </div>
                      </div>
                      <span className="text-[10px] text-muted-foreground">90-dňový audit</span>
                    </div>

                    {/* Banner title snippet */}
                    <div
                      className="rounded-lg p-3 text-white"
                      style={{ backgroundColor: primaryColor }}
                    >
                      <div className="text-[9px] uppercase tracking-wider opacity-90 font-medium">
                        Mesačný SEO Report
                      </div>
                      <div className="font-extrabold text-sm mt-0.5">eshop-klienta.sk</div>
                      <div className="flex items-center justify-between text-[10px] opacity-85 mt-2">
                        <span>Posledných 90 dní</span>
                        <span className="font-bold">Health: 92/100</span>
                      </div>
                    </div>

                    {/* KPI Preview */}
                    <div className="grid grid-cols-3 gap-2 text-center">
                      <div className="rounded border bg-muted/30 p-2">
                        <div className="text-[9px] text-muted-foreground">Kliky</div>
                        <div className="font-bold text-xs mt-0.5">14 250</div>
                        <div className="text-[9px] text-success-foreground font-semibold">
                          +18.4%
                        </div>
                      </div>
                      <div className="rounded border bg-muted/30 p-2">
                        <div className="text-[9px] text-muted-foreground">Impresie</div>
                        <div className="font-bold text-xs mt-0.5">380 000</div>
                        <div className="text-[9px] text-success-foreground font-semibold">
                          +24.1%
                        </div>
                      </div>
                      <div className="rounded border bg-muted/30 p-2">
                        <div className="text-[9px] text-muted-foreground">Pozícia</div>
                        <div className="font-bold text-xs mt-0.5">6.4</div>
                        <div className="text-[9px] text-success-foreground font-semibold">
                          ↑ 1.2
                        </div>
                      </div>
                    </div>

                    {/* Footer preview snippet */}
                    <div className="border-t pt-3 text-[10px] text-center text-muted-foreground">
                      <p className="italic">
                        {reportFooterText || DEFAULT_AGENCY_PROFILE.report_footer_text}
                      </p>
                    </div>
                  </div>

                  <div className="space-y-2 pt-2">
                    <Button
                      onClick={() => setPreviewOpen(true)}
                      className="w-full gap-2 text-xs font-semibold text-white"
                      style={{ backgroundColor: primaryColor }}
                    >
                      <Printer className="size-3.5" />
                      Otvoriť plný PDF Report
                    </Button>
                    <p className="text-[11px] text-muted-foreground text-center">
                      Pri tlači zvoľte formát A4 a uloženie ako PDF.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="cms" className="space-y-6">
            <CmsConnectionsSection />
          </TabsContent>

          <TabsContent value="billing" className="space-y-6">
            <BillingInvoiceSection />
          </TabsContent>
        </Tabs>
      </main>

      {/* Paywall Modal for Agency Plan */}
      <PaywallModal
        open={paywallOpen}
        onOpenChange={setPaywallOpen}
        plan="agency"
        title="Odomknite Whitelabel Reporty s balíkom Agency"
        description="Vytvárajte reprezentatívne klientske SEO reporty s vlastným logom a bez akejkoľvek zmienky o SEO4WEB. Získajte neobmedzené sledovanie webov a prioritu."
      />

      {/* Client Report Modal Preview */}
      <ClientReportModal
        open={previewOpen}
        onOpenChange={setPreviewOpen}
        siteUrl="sc-domain:eshop-klienta.sk"
      />
    </div>
  );
}
