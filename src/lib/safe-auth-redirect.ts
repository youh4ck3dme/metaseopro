/**
 * Safe auth redirect helpers (AUD OAuth fix).
 * - appOrigin(): current app origin, with the published Lovable app as the server fallback.
 * - safeRedirect(): only relative same-origin paths — blocks open redirects.
 * - sessionStorage-backed post-login redirect (survives the OAuth broker round-trip).
 * No tokens are ever read from or written to the URL.
 */

export const DEFAULT_APP_ORIGIN = "https://seo4web.lovable.app";
const REDIRECT_STORAGE_KEY = "seo4web:auth-redirect";
const DEFAULT_REDIRECT = "/dashboard";

export function appOrigin(): string {
  if (typeof window !== "undefined") {
    const origin = window.location?.origin;
    if (origin && origin !== "null") return origin;
  }
  return DEFAULT_APP_ORIGIN;
}

/**
 * Returns a safe relative same-origin path, or DEFAULT_REDIRECT.
 * Rejects protocol-relative, absolute, backslash, scheme and userinfo tricks,
 * and any /login path (avoids redirect loops).
 */
export function safeRedirect(candidate: unknown): string {
  if (typeof candidate !== "string") return DEFAULT_REDIRECT;
  const path = candidate.trim();
  if (!path.startsWith("/")) return DEFAULT_REDIRECT;
  if (path.startsWith("//")) return DEFAULT_REDIRECT;
  if (path.startsWith("/login")) return DEFAULT_REDIRECT;
  if (path.includes("\\")) return DEFAULT_REDIRECT;
  if (path.includes("://")) return DEFAULT_REDIRECT;
  if (path.includes("@")) return DEFAULT_REDIRECT;
  return path;
}

export function saveAuthRedirect(path: string): void {
  try {
    if (typeof window !== "undefined" && window.sessionStorage) {
      window.sessionStorage.setItem(REDIRECT_STORAGE_KEY, safeRedirect(path));
    }
  } catch {
    // storage unavailable (private mode) — redirect falls back to default
  }
}

export function peekAuthRedirect(): string | null {
  try {
    if (typeof window !== "undefined" && window.sessionStorage) {
      const raw = window.sessionStorage.getItem(REDIRECT_STORAGE_KEY);
      return raw ? safeRedirect(raw) : null;
    }
  } catch {
    // ignore
  }
  return null;
}

export function clearAuthRedirect(): void {
  try {
    if (typeof window !== "undefined" && window.sessionStorage) {
      window.sessionStorage.removeItem(REDIRECT_STORAGE_KEY);
    }
  } catch {
    // ignore
  }
}

/** Reads and clears the stored post-login redirect; falls back to DEFAULT_REDIRECT. */
export function consumeAuthRedirect(): string {
  const stored = peekAuthRedirect();
  if (stored) clearAuthRedirect();
  return stored ?? DEFAULT_REDIRECT;
}

/** OAuth/email callbacks use the current app origin, or the published app during SSR. */
export function authCallbackUrl(): string {
  return `${appOrigin()}/login`;
}

/** True when the URL carries an OAuth error (e.g. ?error=access_denied). */
export function hasAuthErrorInUrl(search: string): boolean {
  try {
    const params = new URLSearchParams(search);
    return params.has("error") || params.has("error_description");
  } catch {
    return false;
  }
}
