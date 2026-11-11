import { Link, useRouterState, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Menu, X, ChartNoAxesCombined, LogOut, ArrowUpRight, ChevronDown, LayoutDashboard, Rocket, Activity, FileSearch, PenLine, CalendarDays, ListChecks, History, Building2, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";

const GROUPS = [
  { label: "Analytika", items: [
    { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
    { to: "/decay", label: "Decay Radar", icon: Activity },
    { to: "/audit", label: "SEO Audit", icon: FileSearch },
    { to: "/raketa", label: "SEO Raketa", icon: Rocket },
  ] },
  { label: "Obsah", items: [
    { to: "/", label: "Blog Writer · SERP Lab", icon: PenLine },
    { to: "/plan", label: "30-dňový plán", icon: CalendarDays },
    { to: "/brief", label: "SEO Brief", icon: ListChecks },
    { to: "/history", label: "História výstupov", icon: History },
  ] },
  { label: "Agentúra", items: [
    { to: "/settings/agency", label: "Branding a PDF reporty", icon: Building2 },
  ] },
] as const;

export function AppHeader() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [subscription, setSubscription] = useState<{ userId: string; label: string } | null>(null);
  useEffect(() => {
    if (!user) return;
    let active = true;
    const userId = user.id;
    void supabase.from("subscriptions").select("plan, status").eq("user_id", userId).maybeSingle().then(({ data, error }) => {
      if (!active) return;
      const labels: Record<string, string> = { free: "Free", pro: "Pro", agency: "Agency" };
      setSubscription({ userId, label: error ? "Balík nedostupný" : labels[data?.plan ?? "free"] ?? "Free" });
    });
    return () => { active = false; };
  }, [user?.id]);
  const plan = subscription?.userId === user?.id ? subscription?.label : null;
  const current = GROUPS.flatMap((g) => [...g.items]).find((item) => item.to === pathname);
  const handleSignOut = async () => {
    await signOut();
    setOpen(false);
    await navigate({ to: "/login", search: { redirect: "/" } });
  };
  const linkClass = (to: string) => "nav-item flex min-h-11 items-center gap-2 rounded-md px-3 py-2 text-sm font-medium " +
    (pathname === to ? "bg-secondary text-primary" : "text-muted-foreground hover:bg-muted hover:text-foreground");
  return (
    <header className="app-header mb-8 px-4 md:px-6">
      <div className="mx-auto flex min-h-20 max-w-screen-xl items-center justify-between gap-3">
        <Link to="/" className="flex shrink-0 items-center gap-2.5" onClick={() => setOpen(false)} aria-label="SEO4WEB — úvod">
          <span className="brand-mark flex size-9 items-center justify-center rounded-lg"><ChartNoAxesCombined className="size-5" /></span>
          <span className="font-display text-xl font-semibold text-foreground">SEO4WEB</span>
        </Link>
        <nav aria-label="Hlavná navigácia" className="hidden items-center gap-2 lg:flex">
          <Link to="/dashboard" className={linkClass("/dashboard")} aria-current={pathname === "/dashboard" ? "page" : undefined}><LayoutDashboard className="size-4" />Dashboard</Link>
          {GROUPS.map((group) => (
            <DropdownMenu key={group.label}>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" className={group.items.some((item) => item.to === pathname) ? "bg-secondary text-primary" : "text-muted-foreground"}>
                  {group.label}<ChevronDown className="size-3.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-64">
                <DropdownMenuLabel className="text-xs text-muted-foreground">{group.label}</DropdownMenuLabel>
                {group.items.map((item) => (
                  <DropdownMenuItem asChild key={item.to}>
                    <Link to={item.to} className={linkClass(item.to)} aria-current={pathname === item.to ? "page" : undefined}><item.icon className="size-4" />{item.label}</Link>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          ))}
        </nav>
        <div className="flex shrink-0 items-center gap-1.5">
          {user ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" aria-label="Účet a aktuálny balík" className="gap-2 px-2.5"><UserRound className="size-4" /><span className="text-xs">{plan ?? "…"}</span><ChevronDown className="hidden size-3 sm:block" /></Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-64">
                <DropdownMenuLabel className="truncate">{user.email ?? "Môj účet"}</DropdownMenuLabel>
                <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">Aktuálny balík: {plan ?? "Načítavam"}</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild><Link to="/settings/agency"><Building2 />Nastavenia agentúry</Link></DropdownMenuItem>
                <DropdownMenuItem onSelect={() => void handleSignOut()}><LogOut />Odhlásiť</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <Button asChild size="sm" className="hidden sm:inline-flex"><Link to="/login" search={{ redirect: pathname }}>Prihlásiť<ArrowUpRight /></Link></Button>
          )}
          <Button variant="ghost" size="icon" className="h-11 w-11 lg:hidden" onClick={() => setOpen((v) => !v)} aria-label={open ? "Zavrieť menu" : "Otvoriť menu"} aria-expanded={open} aria-controls="mobile-nav">{open ? <X /> : <Menu />}</Button>
        </div>
      </div>
      {open && (
        <nav id="mobile-nav" aria-label="Mobilná navigácia" className="mx-auto max-h-[calc(100dvh-5rem)] max-w-screen-xl overflow-y-auto border-t border-border py-3 lg:hidden">
          <div className="grid gap-4 sm:grid-cols-3">
            {GROUPS.map((group) => (
              <div key={group.label}>
                <p className="px-3 pb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{group.label}</p>
                {group.items.map((item) => <Link key={item.to} to={item.to} onClick={() => setOpen(false)} aria-current={pathname === item.to ? "page" : undefined} className={linkClass(item.to)}><item.icon className="size-4 shrink-0" />{item.label}</Link>)}
              </div>
            ))}
          </div>
          {!user && <Button asChild className="mt-3 w-full"><Link to="/login" search={{ redirect: pathname }} onClick={() => setOpen(false)}>Prihlásiť<ArrowUpRight /></Link></Button>}
        </nav>
      )}
      {current && <div className="mx-auto flex max-w-screen-xl items-center gap-2 border-t border-border/60 py-2 text-xs text-muted-foreground"><current.icon className="size-3.5" /><span>{current.label}</span></div>}
    </header>
  );
}
