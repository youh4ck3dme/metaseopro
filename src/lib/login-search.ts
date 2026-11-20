import { safeRedirect, saveAuthRedirect } from "@/lib/safe-auth-redirect";

export type LoginMode = "signin" | "signup";

export type LoginSearch = {
  redirect?: string;
  mode?: "signup";
};

/** Accepts only ?mode=signup; any other value falls back to sign-in. */
export function parseLoginMode(value: unknown): LoginMode {
  return value === "signup" ? "signup" : "signin";
}

export function parseLoginSearch(search: Record<string, unknown>): LoginSearch {
  // Only an explicit ?redirect= is kept; absent means "no preference" (do not overwrite a saved target).
  const raw = search.redirect;
  const redirect = typeof raw === "string" && raw !== "" ? safeRedirect(raw) : undefined;
  const base = redirect ? { redirect } : {};
  return parseLoginMode(search.mode) === "signup" ? { ...base, mode: "signup" } : base;
}

/**
 * Stores the explicit ?redirect= for after sign-in (sticky-redirect fix 46da7b7).
 * - explicit redirect: overwrites any older saved target;
 * - absent/empty (parseLoginSearch yields undefined): keeps the saved target (e.g. the landing audit).
 */
export function rememberLoginRedirect(redirect: string | undefined): void {
  if (redirect) saveAuthRedirect(redirect);
}
