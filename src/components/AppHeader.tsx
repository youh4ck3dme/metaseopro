import { Link, useRouterState, useNavigate } from "@tanstack/react-router";
import { useAuth } from "@/hooks/use-auth";

const NAV = [
  { to: "/", label: "Blog Writer" },
  { to: "/audit", label: "SEO Audit" },
  { to: "/plan", label: "Content Plan" },
] as const;

export function AppHeader() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { user, signOut } = useAuth();
  const navigate = useNavigate();

  return (
    <header className="px-6 py-12">
      <div className="mx-auto flex max-w-screen-xl items-center justify-between">
        <Link to="/" className="flex items-center gap-2">
          <div className="flex size-8 items-center justify-center rounded-[6px] bg-neutral-900 text-neutral-50">
            <span className="text-xs font-semibold">P</span>
          </div>
          <span className="text-lg font-medium tracking-tight">Písmo</span>
        </Link>
        <nav className="flex items-center gap-8">
          {NAV.map((item) => {
            const active = pathname === item.to;
            return (
              <Link
                key={item.to}
                to={item.to}
                className={
                  "text-sm transition-colors " +
                  (active ? "text-neutral-900 font-medium" : "text-neutral-500 hover:text-neutral-900")
                }
              >
                {item.label}
              </Link>
            );
          })}
          {user ? (
            <button
              onClick={async () => {
                await signOut();
                navigate({ to: "/login" });
              }}
              className="text-sm text-neutral-500 hover:text-neutral-900"
              title={user.email ?? undefined}
            >
              Odhlásiť
            </button>
          ) : (
            <Link to="/login" className="text-sm text-neutral-500 hover:text-neutral-900">
              Prihlásiť
            </Link>
          )}
        </nav>
      </div>
    </header>
  );
}
