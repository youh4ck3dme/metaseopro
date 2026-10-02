import { Link, useRouterState, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { Menu, X } from "lucide-react";
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
    <header className="px-6 py-6 md:py-10">
      <div className="mx-auto flex max-w-screen-xl items-center justify-between gap-4">
        <Link to="/" className="flex items-center gap-2" onClick={() => setOpen(false)}>
          <div className="flex size-8 items-center justify-center rounded-[6px] bg-neutral-900 text-neutral-50">
            <span className="text-xs font-semibold">P</span>
          </div>
          <span className="text-lg font-medium tracking-tight">Písmo</span>
        </Link>

        {/* Desktop nav */}
        <nav className="hidden lg:flex items-center gap-7">
          {NAV.map((item) => {
            const active = pathname === item.to;
            return (
              <Link
                key={item.to}
                to={item.to}
                className={
                  "text-sm transition-colors " +
                  (active
                    ? "text-neutral-900 font-medium"
                    : "text-neutral-500 hover:text-neutral-900")
                }
              >
                {item.label}
              </Link>
            );
          })}
          {user ? (
            <button
              onClick={handleSignOut}
              className="text-sm text-neutral-500 hover:text-neutral-900"
              title={user.email ?? undefined}
            >
              Odhlásiť
            </button>
          ) : (
            <Link
              to="/login"
              search={{ redirect: "/" }}
              className="rounded-[8px] bg-neutral-900 px-3 py-1.5 text-sm font-medium text-neutral-50 hover:bg-neutral-800"
            >
              Prihlásiť
            </Link>
          )}
        </nav>

        {/* Mobile toggle */}
        <button
          onClick={() => setOpen((v) => !v)}
          className="lg:hidden inline-flex size-9 items-center justify-center rounded-md text-neutral-700 hover:bg-neutral-100"
          aria-label="Otvoriť menu"
          aria-expanded={open}
        >
          {open ? <X className="size-5" /> : <Menu className="size-5" />}
        </button>
      </div>

      {/* Mobile menu */}
      {open && (
        <div className="lg:hidden mx-auto mt-3 max-w-screen-xl rounded-[12px] bg-white p-3 shadow-sm ring-1 ring-black/5">
          <nav className="flex flex-col">
            {NAV.map((item) => {
              const active = pathname === item.to;
              return (
                <Link
                  key={item.to}
                  to={item.to}
                  onClick={() => setOpen(false)}
                  className={
                    "rounded-md px-3 py-2.5 text-sm " +
                    (active
                      ? "bg-neutral-100 text-neutral-900 font-medium"
                      : "text-neutral-600 hover:bg-neutral-50")
                  }
                >
                  {item.label}
                </Link>
              );
            })}
            <div className="my-2 h-px bg-neutral-100" />
            {user ? (
              <button
                onClick={handleSignOut}
                className="rounded-md px-3 py-2.5 text-left text-sm text-neutral-600 hover:bg-neutral-50"
              >
                Odhlásiť ({user.email})
              </button>
            ) : (
              <Link
                to="/login"
                search={{ redirect: "/" }}
                onClick={() => setOpen(false)}
                className="rounded-md bg-neutral-900 px-3 py-2.5 text-center text-sm font-medium text-neutral-50"
              >
                Prihlásiť
              </Link>
            )}
          </nav>
        </div>
      )}
    </header>
  );
}
