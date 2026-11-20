// Server-only guard for outbound CMS destinations (WordPress REST endpoints and
// custom webhooks). Content may only be sent to hosts the signed-in user has
// verified in Search Console. The check runs at save time and again at send
// time, because cms_connections rows are user-writable through RLS and a
// stored row must never be trusted as a destination on its own.
import type { VerifiedProperty } from "./gsc.server";
import { checkRateLimit } from "./rate-limit.server";
import { isSafePublicUrl } from "./safe-url";

export type CmsDestinationErrorCode =
  | "INVALID_URL"
  | "UNSAFE_URL"
  | "DESTINATION_NOT_VERIFIED"
  | "VERIFICATION_UNAVAILABLE"
  | "RATE_LIMITED";

const STATUS: Record<CmsDestinationErrorCode, number> = {
  INVALID_URL: 400,
  UNSAFE_URL: 400,
  DESTINATION_NOT_VERIFIED: 403,
  VERIFICATION_UNAVAILABLE: 503,
  RATE_LIMITED: 429,
};

const MESSAGES: Record<CmsDestinationErrorCode, string> = {
  INVALID_URL: "Neplatná URL adresa cieľa.",
  UNSAFE_URL: "Cieľová adresa nie je povolená (iba verejné http/https adresy).",
  DESTINATION_NOT_VERIFIED: "Odosielanie je povolené len na weby overené vo vašom Search Console.",
  VERIFICATION_UNAVAILABLE: "Overenie cieľového webu je dočasne nedostupné. Skúste to neskôr.",
  RATE_LIMITED: "Príliš veľa požiadaviek. Skúste to o chvíľu znova.",
};

export class CmsDestinationError extends Error {
  readonly code: CmsDestinationErrorCode;
  readonly status: number;
  readonly retryAfterSec?: number;

  constructor(code: CmsDestinationErrorCode, retryAfterSec?: number) {
    super(MESSAGES[code]);
    this.name = "CmsDestinationError";
    this.code = code;
    this.status = STATUS[code];
    this.retryAfterSec = retryAfterSec;
  }
}

export const CMS_SEND_RATE_LIMIT = { limit: 10, windowMs: 60_000 } as const;

/** Per-user limit for every action that makes the server contact a CMS destination. */
export function assertCmsSendRateLimit(action: "save" | "test" | "deploy", userId: string): void {
  const result = checkRateLimit(`cms-${action}:user:${userId}`, CMS_SEND_RATE_LIMIT);
  if (!result.ok) throw new CmsDestinationError("RATE_LIMITED", result.retryAfterSec);
}

function stripWww(host: string): string {
  return host
    .toLowerCase()
    .replace(/\.+$/, "")
    .replace(/^www\./, "");
}

/** Parses a destination URL (a bare domain is treated as https://) and returns its host. */
export function destinationHost(rawUrl: string): string {
  const trimmed = rawUrl.trim();
  if (!trimmed) throw new CmsDestinationError("INVALID_URL");
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    throw new CmsDestinationError("INVALID_URL");
  }
  if (!isSafePublicUrl(url.toString())) throw new CmsDestinationError("UNSAFE_URL");
  return stripWww(url.hostname);
}

/**
 * A verified host. Only a Search Console "sc-domain:" property covers its
 * subdomains; a URL-prefix property verifies exactly that host (www and the
 * bare domain are treated as one), never other subdomains.
 */
export interface VerifiedHost {
  host: string;
  subdomains: boolean;
}

/** Hosts a user has verified: "sc-domain:x" (with subdomains) and URL-prefix properties (exact host). */
export function verifiedDomains(props: VerifiedProperty[]): VerifiedHost[] {
  const out = new Map<string, boolean>();
  for (const p of props) {
    let host = "";
    let subdomains = false;
    if (p.siteUrl.startsWith("sc-domain:")) {
      host = p.siteUrl.slice("sc-domain:".length);
      subdomains = true;
    } else {
      try {
        host = new URL(p.siteUrl).hostname;
      } catch {
        host = "";
      }
    }
    const d = stripWww(host.trim());
    if (d) out.set(d, (out.get(d) ?? false) || subdomains);
  }
  return [...out].map(([host, subdomains]) => ({ host, subdomains }));
}

export function isHostVerified(host: string, domains: VerifiedHost[]): boolean {
  return domains.some((d) => host === d.host || (d.subdomains && host.endsWith(`.${d.host}`)));
}

type ListProps = (userId: string) => Promise<VerifiedProperty[]>;

/**
 * Throws unless every destination URL is a public http(s) URL whose host is
 * one of the user's verified Search Console properties. Fails closed when the
 * verified list cannot be loaded. Superadmin is resolved inside
 * listUserVerifiedProperties by user id only (no email is passed).
 */
export async function assertAllowedCmsDestination(
  userId: string,
  urls: string[],
  listProps: ListProps = async (id) =>
    (await import("./gsc.server")).listUserVerifiedProperties(id),
): Promise<void> {
  if (!userId) throw new CmsDestinationError("DESTINATION_NOT_VERIFIED");
  if (urls.length === 0) throw new CmsDestinationError("INVALID_URL");
  const hosts = urls.map(destinationHost);
  let props: VerifiedProperty[];
  try {
    props = await listProps(userId);
  } catch {
    throw new CmsDestinationError("VERIFICATION_UNAVAILABLE");
  }
  const domains = verifiedDomains(props);
  if (!hosts.every((host) => isHostVerified(host, domains))) {
    throw new CmsDestinationError("DESTINATION_NOT_VERIFIED");
  }
}
