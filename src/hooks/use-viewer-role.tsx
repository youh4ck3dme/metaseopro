import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useAuth } from "@/hooks/use-auth";
import { getViewerRole } from "@/lib/viewer-role.functions";
import type { ViewerPlan } from "@/lib/viewer-role.server";

type ViewerRoleCtx = {
  /** Server-computed. Defaults to false while loading, signed out or on any error. */
  isAdmin: boolean;
  plan: ViewerPlan | null;
  loading: boolean;
};

const DEFAULT_ROLE: ViewerRoleCtx = { isAdmin: false, plan: null, loading: false };

const Ctx = createContext<ViewerRoleCtx>(DEFAULT_ROLE);

/**
 * Display-only role state. The client never decides on its own: the value comes
 * from the getViewerRole server function, and every server gate re-checks it.
 */
export function ViewerRoleProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const fetchRole = useServerFn(getViewerRole);
  const [state, setState] = useState<{ userId: string; role: ViewerRoleCtx } | null>(null);
  const userId = user?.id ?? null;

  useEffect(() => {
    if (!userId) {
      setState(null);
      return;
    }
    let active = true;
    setState({ userId, role: { ...DEFAULT_ROLE, loading: true } });
    fetchRole()
      .then((role) => {
        if (active) {
          setState({
            userId,
            role: { isAdmin: role.isAdmin === true, plan: role.plan, loading: false },
          });
        }
      })
      .catch(() => {
        if (active) setState({ userId, role: DEFAULT_ROLE });
      });
    return () => {
      active = false;
    };
  }, [userId, fetchRole]);

  const value = state && state.userId === userId ? state.role : DEFAULT_ROLE;
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useViewerRole = () => useContext(Ctx);
