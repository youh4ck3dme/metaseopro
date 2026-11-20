import { saveAuthRedirect } from "@/lib/safe-auth-redirect";

/**
 * Decides where the landing-page domain form goes (#19 P3-1).
 * - signed in: straight to the audit; no auth redirect is stored (it would never be
 *   consumed and would hijack the next sign-in in the same tab);
 * - signed out: store the audit target and open sign-up;
 * - auth still loading: do nothing and store nothing.
 * Returns the href to navigate to, or null.
 */
export function startAuditEntry(options: {
  normalizedDomain: string;
  signedIn: boolean;
  loading: boolean;
}): string | null {
  const auditPath = `/audit?domain=${encodeURIComponent(options.normalizedDomain)}`;
  if (options.signedIn) return auditPath;
  if (options.loading) return null;
  saveAuthRedirect(auditPath);
  return "/login?mode=signup";
}
