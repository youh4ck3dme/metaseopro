/**
 * Client-side domain parsing for the landing hero and audit prefill.
 * Accepts a bare hostname or an http(s) URL and returns a normalized hostname
 * (lowercase, no trailing dot, www. stripped to match the audit parser).
 */
const DOMAIN_RE = /^([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}$/i;

export const DOMAIN_INPUT_EMPTY_ERROR = "Zadajte doménu.";
export const DOMAIN_INPUT_INVALID_ERROR = "Zadajte platnú doménu, napríklad example.sk.";

export function parseDomainInput(raw: string): string | null {
  const trimmed = (raw ?? "").trim();
  if (!trimmed || /\s/.test(trimmed)) return null;

  let candidate = trimmed;
  if (candidate.startsWith("//")) {
    candidate = `https:${candidate}`;
  } else if (!/^[a-z][a-z0-9+.-]*:/i.test(candidate)) {
    candidate = `https://${candidate}`;
  }

  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return null;
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") return null;

  const host = url.hostname
    .toLowerCase()
    .replace(/\.$/, "")
    .replace(/^www\./, "");
  if (host.length > 253) return null;
  if (!DOMAIN_RE.test(host)) return null;
  return host;
}

export function domainInputError(raw: string): string | null {
  if (!(raw ?? "").trim()) return DOMAIN_INPUT_EMPTY_ERROR;
  return parseDomainInput(raw) ? null : DOMAIN_INPUT_INVALID_ERROR;
}

/**
 * Login redirect target for /audit (Bora #19 P3-5/P3-6). Built only from the normalized
 * `domain` query value, so '@', '://' and unrelated query params can never make
 * safeRedirect fall back to /dashboard and lose the audit page. Anything unusable → "/audit".
 */
export function auditLoginRedirect(rawDomain: string | null | undefined): string {
  const normalized = rawDomain ? parseDomainInput(rawDomain) : null;
  return normalized ? `/audit?domain=${encodeURIComponent(normalized)}` : "/audit";
}
