import { Link, useRouterState, useNavigate } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import {
  ChartNoAxesCombined,
  LayoutDashboard,
  Rocket,
  TrendingDown,
  Search,
  PenTool,
  Calendar,
  FileCheck,
  History,
  Building2,
  Printer,
  Sparkles,
  Crown,
  ChevronDown,
  LogOut,
  User as UserIcon,
  Menu,
  X,
  ArrowUpRight,
  ShieldCheck,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import { PaywallModal } from "@/components/PaywallModal";
import type { PlanId } from "@/lib/slovak-billing";
import { isLocale, readLocaleCookie, writeLocaleCookie, type Locale } from "@/lib/i18n";

const SEO_TOOLS = [
  {
    to: "/dashboard",
    label: "Dashboard",
    desc: "Centrálny prehľad KPI, Opportunity Radar a domény",
    icon: LayoutDashboard,
  },
  {
    to: "/raketa",
    label: "SEO Raketa",
    desc: "Technická on-page inšpekcia URL a porovnanie",
    icon: Rocket,
  },
  {
    to: "/decay",
    label: "Decay Radar",
    desc: "Detekcia poklesu návštevnosti v Google Search Console",
    icon: TrendingDown,
  },
  {
    to: "/audit",
    label: "SEO Audit",
    desc: "Konkurenčná analýza a keyword gap cez Semrush",
    icon: Search,
  },
  {
    to: "/",
    label: "Blog Writer",
    desc: "AI tvorba článkov a živý Google SERP Lab",
    icon: PenTool,
  },
] as const;

const CONTENT_TOOLS = [
  {
    to: "/plan",
    label: "Content Plan",
    desc: "30-dňový publikačný kalendár a pillar klastre",
    icon: Calendar,
  },
  {
    to: "/brief",
    label: "SEO Brief",
    desc: "Kompletné zadanie pre copywritera s E-E-A-T",
    icon: FileCheck,
  },
  {
    to: "/history",
    label: "História",
    desc: "Archív všetkých vygenerovaných analýz a článkov",
    icon: History,
  },
] as const;

const AGENCY_TOOLS = [
  {
    to: "/settings/agency",
    label: "Whitelabel Agentúra",
    desc: "Vlastné logo, primárna farba a pätička reportu",
    icon: Building2,
  },
  {
    to: "/dashboard",
    label: "Klientsky PDF Report",
    desc: "Reprezentatívny mesačný report pre klienta na Dashboarde",
    icon: Printer,
  },
] as const;

function PlanBadge({ plan }: { plan: PlanId }) {
  if (plan === "agency") {
    return (
      <Badge
        variant="outline"
        className="gap-1 border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400 font-semibold text-[11px] px-2 py-0.5"
      >
        <Crown className="size-3 text-amber-500" />
        Agency
      </Badge>
    );
  }
  if (plan === "pro") {
    return (
      <Badge
        variant="outline"
        className="gap-1 border-primary/40 bg-primary/10 text-primary font-semibold text-[11px] px-2 py-0.5"
      >
        <Sparkles className="size-3 text-primary" />
        Pro
      </Badge>
    );
  }
  return (
    <Badge
      variant="outline"
      className="border-border bg-muted/60 text-muted-foreground font-medium text-[11px] px-2 py-0.5"
    >
      Free
    </Badge>
  );
}

export function AppHeader() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [paywallOpen, setPaywallOpen] = useState(false);
  const [userPlan, setUserPlan] = useState<PlanId>("free");
  const [locale, setLocale] = useState<Locale>(() => readLocaleCookie() ?? "sk");

  const switchLocale = (next: Locale) => {
    if (next === locale) return;
    writeLocaleCookie(next);
    setLocale(next);
    if (typeof document !== "undefined") document.documentElement.lang = next;
    window.location.reload();
  };

  // Load user subscription tier
  useEffect(() => {
    if (!user) {
      setUserPlan("free");
      return;
    }
    const userId = user.id;
    let active = true;

    async function loadPlan() {
      try {
        const { data } = await supabase
          .from("subscriptions")
          .select("plan, status")
          .eq("user_id", userId)
          .maybeSingle();

        if (active && data?.plan) {
          if (data.plan === "agency" || data.plan === "pro" || data.plan === "free") {
            setUserPlan(data.plan);
          }
        }
      } catch {
        // Fallback to free on network or schema error
      }
    }

    void loadPlan();

    return () => {
      active = false;
    };
  }, [user]);

  const handleSignOut = async () => {
    await signOut();
    setMobileOpen(false);
    navigate({ to: "/login", search: { redirect: "/" } });
  };

  const isSeoActive =
    pathname === "/dashboard" ||
    pathname === "/raketa" ||
    pathname === "/decay" ||
    pathname === "/audit" ||
    pathname === "/";

  const isContentActive = pathname === "/plan" || pathname === "/brief" || pathname === "/history";

  const isAgencyActive = pathname.startsWith("/settings/agency");

  return (
    <header className="app-header mb-8 px-4 md:px-6 border-b border-border/40 bg-background/95 backdrop-blur-md sticky top-0 z-40">
      <div className="mx-auto flex min-h-16 max-w-screen-xl items-center justify-between gap-4">
        {/* Brand Logo */}
        <Link
          to="/"
          className="flex shrink-0 items-center gap-2.5 group"
          onClick={() => setMobileOpen(false)}
          aria-label="SEO4WEB — AI SEO Command Center"
        >
          <span className="brand-mark flex size-9 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-sm transition-transform group-hover:scale-105">
            <ChartNoAxesCombined className="size-5" />
          </span>
          <div className="flex flex-col">
            <span className="font-display text-xl font-bold leading-none tracking-tight text-foreground">
              SEO4WEB
            </span>
            <span className="text-[10px] text-muted-foreground font-medium tracking-wider uppercase mt-0.5 hidden sm:inline">
              AI SEO Command Center
            </span>
          </div>
        </Link>

        {/* ================= DESKTOP LOGICAL NAVIGATION ================= */}
        <nav aria-label="Hlavná navigácia" className="hidden lg:flex items-center gap-1">
          {/* 1. Dashboard Direct Link */}
          <Link
            to="/dashboard"
            aria-current={pathname === "/dashboard" ? "page" : undefined}
            className={
              "inline-flex items-center gap-1.5 rounded-md px-3 py-2 text-xs font-semibold transition-colors " +
              (pathname === "/dashboard"
                ? "bg-secondary text-primary shadow-xs"
                : "text-muted-foreground hover:bg-muted hover:text-foreground")
            }
          >
            <LayoutDashboard className="size-3.5" />
            Dashboard
          </Link>

          {/* 2. SEO Nástroje Dropdown */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className={
                  "h-8 gap-1 px-3 text-xs font-semibold transition-colors " +
                  (isSeoActive && pathname !== "/dashboard"
                    ? "bg-secondary text-primary shadow-xs"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground")
                }
              >
                <span>SEO Nástroje</span>
                <ChevronDown className="size-3 opacity-60" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="start"
              className="w-80 p-2 bg-popover text-popover-foreground border-border shadow-lg"
            >
              <DropdownMenuLabel className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider px-2 py-1">
                Technické & Analytické moduly
              </DropdownMenuLabel>
              {SEO_TOOLS.map((item) => {
                const Icon = item.icon;
                const active = pathname === item.to;
                return (
                  <DropdownMenuItem key={item.to} asChild className="p-0">
                    <Link
                      to={item.to}
                      className={
                        "flex items-start gap-3 p-2 rounded-md transition-colors w-full cursor-pointer " +
                        (active ? "bg-secondary text-primary" : "hover:bg-muted text-foreground")
                      }
                    >
                      <div className="size-7 rounded-md bg-muted flex items-center justify-center shrink-0 mt-0.5">
                        <Icon className="size-3.5 text-foreground" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-xs font-semibold">{item.label}</div>
                        <div className="text-[11px] text-muted-foreground leading-tight truncate">
                          {item.desc}
                        </div>
                      </div>
                    </Link>
                  </DropdownMenuItem>
                );
              })}
            </DropdownMenuContent>
          </DropdownMenu>

          {/* 3. Obsah & Taktika Dropdown */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className={
                  "h-8 gap-1 px-3 text-xs font-semibold transition-colors " +
                  (isContentActive
                    ? "bg-secondary text-primary shadow-xs"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground")
                }
              >
                <span>Obsah & Taktika</span>
                <ChevronDown className="size-3 opacity-60" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="start"
              className="w-80 p-2 bg-popover text-popover-foreground border-border shadow-lg"
            >
              <DropdownMenuLabel className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider px-2 py-1">
                Content Architektúra
              </DropdownMenuLabel>
              {CONTENT_TOOLS.map((item) => {
                const Icon = item.icon;
                const active = pathname === item.to;
                return (
                  <DropdownMenuItem key={item.to} asChild className="p-0">
                    <Link
                      to={item.to}
                      className={
                        "flex items-start gap-3 p-2 rounded-md transition-colors w-full cursor-pointer " +
                        (active ? "bg-secondary text-primary" : "hover:bg-muted text-foreground")
                      }
                    >
                      <div className="size-7 rounded-md bg-muted flex items-center justify-center shrink-0 mt-0.5">
                        <Icon className="size-3.5 text-foreground" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-xs font-semibold">{item.label}</div>
                        <div className="text-[11px] text-muted-foreground leading-tight truncate">
                          {item.desc}
                        </div>
                      </div>
                    </Link>
                  </DropdownMenuItem>
                );
              })}
            </DropdownMenuContent>
          </DropdownMenu>

          {/* 4. Agentúra & B2B Dropdown */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className={
                  "h-8 gap-1 px-3 text-xs font-semibold transition-colors " +
                  (isAgencyActive
                    ? "bg-secondary text-primary shadow-xs"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground")
                }
              >
                <span>Agentúra</span>
                <ChevronDown className="size-3 opacity-60" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="start"
              className="w-80 p-2 bg-popover text-popover-foreground border-border shadow-lg"
            >
              <DropdownMenuLabel className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider px-2 py-1">
                B2B Whitelabel & Reporty
              </DropdownMenuLabel>
              {AGENCY_TOOLS.map((item) => {
                const Icon = item.icon;
                const active = pathname === item.to;
                return (
                  <DropdownMenuItem key={item.to} asChild className="p-0">
                    <Link
                      to={item.to}
                      className={
                        "flex items-start gap-3 p-2 rounded-md transition-colors w-full cursor-pointer " +
                        (active ? "bg-secondary text-primary" : "hover:bg-muted text-foreground")
                      }
                    >
                      <div className="size-7 rounded-md bg-muted flex items-center justify-center shrink-0 mt-0.5">
                        <Icon className="size-3.5 text-foreground" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-xs font-semibold">{item.label}</div>
                        <div className="text-[11px] text-muted-foreground leading-tight truncate">
                          {item.desc}
                        </div>
                      </div>
                    </Link>
                  </DropdownMenuItem>
                );
              })}
            </DropdownMenuContent>
          </DropdownMenu>
        </nav>

        {/* ================= RIGHT CORNER: LOCALE + USER STATUS & PLAN PILL ================= */}
        <div className="flex items-center gap-2.5">
          <LocaleSwitch locale={locale} onSwitch={switchLocale} />
          {user ? (
            <div className="flex items-center gap-2">
              {/* Plan Badge */}
              <div className="hidden sm:inline-flex">
                <PlanBadge plan={userPlan} />
              </div>

              {/* Upgrade / Pricing CTA */}
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPaywallOpen(true)}
                className="h-8 gap-1.5 text-xs font-semibold border-border hover:bg-muted"
                title="Cenník a možnosti predplatného"
              >
                <Sparkles className="size-3.5 text-primary" />
                <span className="hidden md:inline">
                  {userPlan === "agency" ? "Cenník" : "Cenník / Upgrade"}
                </span>
                <span className="md:hidden">Upgrade</span>
              </Button>

              {/* User Dropdown */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 gap-1.5 px-2 hover:bg-muted"
                    aria-label="Používateľské menu"
                  >
                    <div className="size-6 rounded-full bg-primary/10 text-primary flex items-center justify-center text-[11px] font-bold">
                      {user.email?.charAt(0).toUpperCase() || "U"}
                    </div>
                    <span className="hidden xl:inline text-xs font-medium max-w-[120px] truncate text-foreground">
                      {user.email}
                    </span>
                    <ChevronDown className="size-3 text-muted-foreground" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  align="end"
                  className="w-56 p-2 bg-popover text-popover-foreground border-border shadow-lg"
                >
                  <div className="px-2 py-1.5 border-b border-border/60 mb-1">
                    <p className="text-xs font-semibold text-foreground truncate">{user.email}</p>
                    <div className="flex items-center justify-between gap-1 mt-1">
                      <span className="text-[11px] text-muted-foreground">Aktívny balík:</span>
                      <PlanBadge plan={userPlan} />
                    </div>
                  </div>

                  <DropdownMenuItem asChild>
                    <Link
                      to="/settings/agency"
                      className="flex items-center gap-2 cursor-pointer text-xs"
                    >
                      <Building2 className="size-3.5 text-muted-foreground" />
                      Whitelabel Agentúra
                    </Link>
                  </DropdownMenuItem>

                  <DropdownMenuItem
                    onClick={() => setPaywallOpen(true)}
                    className="flex items-center gap-2 cursor-pointer text-xs"
                  >
                    <Sparkles className="size-3.5 text-primary" />
                    Cenník a predplatné
                  </DropdownMenuItem>

                  <DropdownMenuSeparator className="my-1 border-border/60" />

                  <DropdownMenuItem
                    onClick={handleSignOut}
                    className="flex items-center gap-2 cursor-pointer text-xs text-destructive focus:text-destructive"
                  >
                    <LogOut className="size-3.5" />
                    Odhlásiť sa
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setPaywallOpen(true)}
                className="h-8 gap-1.5 text-xs text-muted-foreground hover:text-foreground"
              >
                <Sparkles className="size-3.5 text-primary" />
                Cenník
              </Button>
              <Button asChild size="sm" className="h-8 gap-1 text-xs font-semibold">
                <Link to="/login" search={{ redirect: "/" }}>
                  Prihlásiť <ArrowUpRight className="size-3" />
                </Link>
              </Button>
            </div>
          )}

          {/* ================= MOBILE / TABLET DRAWER TRIGGER ================= */}
          <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
            <SheetTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="size-9 lg:hidden"
                aria-label="Otvoriť navigáciu"
              >
                <Menu className="size-5" />
              </Button>
            </SheetTrigger>
            <SheetContent
              side="right"
              className="w-80 sm:w-96 p-0 bg-background border-border flex flex-col justify-between"
            >
              <div className="flex flex-col flex-1 overflow-y-auto">
                <SheetHeader className="p-5 border-b border-border/60 flex flex-row items-center justify-between text-left">
                  <div className="flex items-center gap-2.5">
                    <span className="brand-mark flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-sm">
                      <ChartNoAxesCombined className="size-4" />
                    </span>
                    <SheetTitle className="font-display text-lg font-bold">SEO4WEB</SheetTitle>
                  </div>
                </SheetHeader>

                {/* User Status in Drawer */}
                {user && (
                  <div className="p-4 bg-muted/40 border-b border-border/60 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-foreground truncate">{user.email}</p>
                      <div className="mt-1">
                        <PlanBadge plan={userPlan} />
                      </div>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setMobileOpen(false);
                        setPaywallOpen(true);
                      }}
                      className="h-7 text-xs gap-1"
                    >
                      <Sparkles className="size-3 text-primary" />
                      Upgrade
                    </Button>
                  </div>
                )}

                {/* Mobile Menu Sections */}
                <div className="p-4 space-y-5">
                  {/* Sekcia 1: SEO Nástroje */}
                  <div>
                    <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider px-2 mb-1.5">
                      SEO Nástroje
                    </div>
                    <div className="space-y-0.5">
                      {SEO_TOOLS.map((item) => {
                        const Icon = item.icon;
                        const active = pathname === item.to;
                        return (
                          <Link
                            key={item.to}
                            to={item.to}
                            onClick={() => setMobileOpen(false)}
                            className={
                              "flex items-center gap-3 px-3 py-2.5 rounded-lg text-xs font-medium transition-colors " +
                              (active
                                ? "bg-secondary text-primary font-semibold"
                                : "text-muted-foreground hover:bg-muted hover:text-foreground")
                            }
                          >
                            <Icon className="size-4 shrink-0" />
                            <span>{item.label}</span>
                          </Link>
                        );
                      })}
                    </div>
                  </div>

                  {/* Sekcia 2: Obsah & Taktika */}
                  <div>
                    <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider px-2 mb-1.5">
                      Obsah & Taktika
                    </div>
                    <div className="space-y-0.5">
                      {CONTENT_TOOLS.map((item) => {
                        const Icon = item.icon;
                        const active = pathname === item.to;
                        return (
                          <Link
                            key={item.to}
                            to={item.to}
                            onClick={() => setMobileOpen(false)}
                            className={
                              "flex items-center gap-3 px-3 py-2.5 rounded-lg text-xs font-medium transition-colors " +
                              (active
                                ? "bg-secondary text-primary font-semibold"
                                : "text-muted-foreground hover:bg-muted hover:text-foreground")
                            }
                          >
                            <Icon className="size-4 shrink-0" />
                            <span>{item.label}</span>
                          </Link>
                        );
                      })}
                    </div>
                  </div>

                  {/* Sekcia 3: Agentúra & B2B */}
                  <div>
                    <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider px-2 mb-1.5">
                      Agentúra & B2B
                    </div>
                    <div className="space-y-0.5">
                      {AGENCY_TOOLS.map((item) => {
                        const Icon = item.icon;
                        const active = pathname === item.to;
                        return (
                          <Link
                            key={item.to}
                            to={item.to}
                            onClick={() => setMobileOpen(false)}
                            className={
                              "flex items-center gap-3 px-3 py-2.5 rounded-lg text-xs font-medium transition-colors " +
                              (active
                                ? "bg-secondary text-primary font-semibold"
                                : "text-muted-foreground hover:bg-muted hover:text-foreground")
                            }
                          >
                            <Icon className="size-4 shrink-0" />
                            <span>{item.label}</span>
                          </Link>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </div>

              {/* Mobile Drawer Footer */}
              <div className="p-4 border-t border-border/60 bg-muted/20">
                {user ? (
                  <Button
                    variant="ghost"
                    onClick={handleSignOut}
                    className="w-full justify-start text-xs text-destructive hover:text-destructive hover:bg-destructive/10 gap-2"
                  >
                    <LogOut className="size-4" /> Odhlásiť sa
                  </Button>
                ) : (
                  <Button asChild className="w-full text-xs font-semibold gap-1.5">
                    <Link
                      to="/login"
                      search={{ redirect: "/" }}
                      onClick={() => setMobileOpen(false)}
                    >
                      Prihlásiť sa <ArrowUpRight className="size-3.5" />
                    </Link>
                  </Button>
                )}
              </div>
            </SheetContent>
          </Sheet>
        </div>
      </div>

      {/* Embedded Paywall Modal */}
      <PaywallModal open={paywallOpen} onOpenChange={setPaywallOpen} />
    </header>
  );
}

function LocaleSwitch({ locale, onSwitch }: { locale: Locale; onSwitch: (next: Locale) => void }) {
  return (
    <div className="flex items-center gap-0.5 text-xs" role="group" aria-label="Language">
      {(["sk", "en", "de"] as const).map((code) => (
        <button
          key={code}
          type="button"
          onClick={() => onSwitch(code)}
          className={
            "rounded px-1.5 py-0.5 uppercase " +
            (locale === code
              ? "font-semibold text-foreground bg-secondary"
              : "text-muted-foreground hover:text-foreground")
          }
          aria-current={locale === code ? "true" : undefined}
        >
          {code}
        </button>
      ))}
    </div>
  );
}
