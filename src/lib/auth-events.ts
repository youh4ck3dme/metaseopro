import { clearAuthRedirect } from "@/lib/safe-auth-redirect";

/**
 * Called for every Supabase auth state change. On sign-out the stored post-login
 * redirect is dropped, so a stale target cannot hijack the next sign-in in the same tab.
 */
export function handleAuthStateEvent(event: string): void {
  if (event === "SIGNED_OUT") clearAuthRedirect();
}
