import { Link, useRouterState } from "@tanstack/react-router";

const NAV = [
  { to: "/", label: "Blog Writer" },
  { to: "/audit", label: "SEO Audit" },
] as const;

export function AppHeader() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  return (
    <header className="px-6 py-12">
      <div className="mx-auto flex max-w-screen-xl items-center justify-between">
        <Link to="/" className="flex items-center gap-2">
          <div className="flex size-8 items-center justify-center rounded-[6px] bg-neutral-900 text-neutral-50">
            <span className="text-xs font-semibold">P</span>
          </div>
          <span className="text-lg font-medium tracking-tight">Písmo</span>
        </Link>
        <nav className="flex gap-8">
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
        </nav>
      </div>
    </header>
  );
}
