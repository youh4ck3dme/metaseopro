import { Link, useRouterState, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { Menu, X, ChartNoAxesCombined, LogOut, ArrowUpRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/use-auth";

const NAV = [
  { to: "/dashboard", label: "Dashboard" },
  { to: "/raketa", label: "SEO Raketa" },
  { to: "/decay", label: "Decay Radar" },
  { to: "/", label: "Blog Writer" },
  { to: "/audit", label: "SEO Audit" },
  { to: "/plan", label: "Content Plan" },
  { to: "/brief", label: "SEO Brief" },
  { to: "/history", label: "História" },
] as const;

export function AppHeader() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const handleSignOut = async () => {
    await signOut();
    setOpen(false);
    navigate({ to: "/login", search: { redirect: "/" } });
  };
  return (
    <header className="app-header mb-8 px-4 md:px-6">
      <div className="mx-auto flex min-h-20 max-w-screen-xl items-center justify-between gap-4">
        <Link to="/" className="flex shrink-0 items-center gap-2.5" onClick={() => setOpen(false)} aria-label="SEO4WEB — úvod">
          <span className="brand-mark flex size-9 items-center justify-center rounded-lg"><ChartNoAxesCombined className="size-5" /></span>
          <span className="font-display text-xl font-semibold text-foreground">SEO4WEB</span>
        </Link>
        <nav aria-label="Hlavná navigácia" className="hidden xl:flex items-center gap-0.5">
          {NAV.map((item) => (
            <Link key={item.to} to={item.to} aria-current={pathname === item.to ? "page" : undefined}
              className={"nav-item rounded-md px-2.5 py-3 text-[13px] font-medium " + (pathname === item.to ? "bg-secondary text-primary" : "text-muted-foreground hover:bg-muted hover:text-foreground")}>
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="flex items-center gap-2">
          {user ? <Button variant="ghost" size="icon" onClick={handleSignOut} title="Odhlásiť" aria-label="Odhlásiť" className="hidden xl:inline-flex"><LogOut /></Button> :
            <Button asChild size="sm" className="hidden sm:inline-flex"><Link to="/login" search={{ redirect: "/" }}>Prihlásiť <ArrowUpRight /></Link></Button>}
          <Button variant="ghost" size="icon" className="xl:hidden" onClick={() => setOpen((v) => !v)} aria-label={open ? "Zavrieť menu" : "Otvoriť menu"} aria-expanded={open} aria-controls="mobile-nav">
            {open ? <X /> : <Menu />}
          </Button>
        </div>
      </div>
      {open && (
        <nav id="mobile-nav" aria-label="Mobilná navigácia" className="mx-auto grid max-w-screen-xl gap-1 border-t border-border py-3 sm:grid-cols-2 xl:hidden">
          {NAV.map((item) => <Link key={item.to} to={item.to} onClick={() => setOpen(false)} aria-current={pathname === item.to ? "page" : undefined}
            className={"rounded-md px-3 py-3 text-sm font-medium " + (pathname === item.to ? "bg-secondary text-primary" : "text-muted-foreground hover:bg-muted")}>{item.label}</Link>)}
          {user ? <Button variant="ghost" className="justify-start" onClick={handleSignOut}><LogOut /> Odhlásiť</Button> :
            <Button asChild><Link to="/login" search={{ redirect: "/" }} onClick={() => setOpen(false)}>Prihlásiť <ArrowUpRight /></Link></Button>}
        </nav>
      )}
    </header>
  );
}
