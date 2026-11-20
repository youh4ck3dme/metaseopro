import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { isUnlimited, resolveViewerRole, type ViewerRole } from "./viewer-role.server";

/**
 * Server-computed viewer role for UI gating. There is deliberately no
 * validator and no client input: the role is derived only from the verified
 * token's user id (context.userId) and the user's subscription row.
 */
export const getViewerRole = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<ViewerRole> => {
    const identity = { id: context.userId };
    if (isUnlimited(identity)) return resolveViewerRole(identity, null);
    try {
      const { data, error } = await context.supabase
        .from("subscriptions")
        .select("plan, status, current_period_end")
        .eq("user_id", context.userId)
        .maybeSingle();
      if (error) throw error;
      return resolveViewerRole(identity, data);
    } catch {
      throw new Error("Stav účtu sa nepodarilo načítať. Skús ho obnoviť.");
    }
  });
