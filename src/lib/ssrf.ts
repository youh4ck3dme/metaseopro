/**
 * SSRF Protection & URL Safety Validation
 * Protects server-side fetchers from requesting internal/private IP ranges,
 * cloud metadata endpoints (AWS/GCP/Azure), and loopback interfaces.
 * safeFetch additionally re-validates every redirect target (URL + DNS) and
 * strips credentials on cross-origin redirects.
 */

function normalizeHostname(hostname: string): string {
  return hostname.toLowerCase().trim().replace(/\.+$/, "");
}

/** True when an IP literal (v4 or v6) is loopback/private/link-local/CGNAT/reserved. */
export function isBlockedIp(ip: string): boolean {
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip);
  if (v4) {
    const a = Number(v4[1]);
    const b = Number(v4[2]);
    const c = Number(v4[3]);
    const d = Number(v4[4]);
    if (a > 255 || b > 255 || c > 255 || d > 255) return true;
    if (a === 127) return true; // Loopback (127.0.0.0/8)
    if (a === 10) return true; // Private class A (10.0.0.0/8)
    if (a === 172 && b >= 16 && b <= 31) return true; // Private class B (172.16.0.0/12)
    if (a === 192 && b === 168) return true; // Private class C (192.168.0.0/16)
    if (a === 169 && b === 254) return true; // Link-local / cloud metadata (169.254.0.0/16)
    if (a === 0 || a >= 224) return true; // "This network" / multicast / reserved
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT (100.64.0.0/10)
    if (a === 192 && b === 0 && c === 0) return true; // IETF protocol assignments (192.0.0.0/24)
    if (a === 198 && (b === 18 || b === 19)) return true; // Benchmarking (198.18.0.0/15)
    return false;
  }
  const v6 = ip.toLowerCase();
  if (v6 === "::" || v6 === "::1") return true; // Unspecified / loopback
  if (/^fe[89ab]/.test(v6)) return true; // Link-local fe80::/10
  if (/^f[cd]/.test(v6)) return true; // Unique local fc00::/7
  if (v6.startsWith("2001:db8:")) return true; // Documentation prefix
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(v6);
  if (mapped) return isBlockedIp(mapped[1]!); // IPv4-mapped IPv6
  return false;
}

export function isSafePublicUrl(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== "http:" && url.protocol !== "https:") return false;

    // userinfo (http://user:pass@host) is never allowed
    if (url.username || url.password) return false;

    // only default ports and explicit 80/443
    if (url.port && url.port !== "80" && url.port !== "443") return false;

    const host = normalizeHostname(url.hostname);

    // Zakáže localhost a interné domény
    if (
      host === "localhost" ||
      host.endsWith(".localhost") ||
      host.endsWith(".local") ||
      host.endsWith(".internal") ||
      host.endsWith(".lan") ||
      host.endsWith(".home") ||
      host.endsWith(".arpa")
    ) {
      return false;
    }

    // IP literály (v4 aj v6) posúdime cez isBlockedIp
    const bare = host.replace(/^\[/, "").replace(/\]$/, "");
    if (bare.includes(":") || /^\d{1,3}(\.\d{1,3}){3}$/.test(bare)) {
      return !isBlockedIp(bare);
    }

    // Musí obsahovať aspoň jednu bodku (verejná TLD)
    if (!host.includes(".")) return false;

    return true;
  } catch {
    return false;
  }
}

export function assertSafePublicUrl(rawUrl: string): void {
  if (!rawUrl || typeof rawUrl !== "string") {
    throw new Error("Chýbajúca URL adresa.");
  }
  let parsed: URL;
  try {
    const hasScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(rawUrl);
    parsed = new URL(hasScheme ? rawUrl : `https://${rawUrl}`);
  } catch {
    throw new Error("Neplatný formát URL adresy.");
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Povolené sú iba protokoly http:// a https://.");
  }

  if (!isSafePublicUrl(parsed.toString())) {
    const host = normalizeHostname(parsed.hostname);
    if (
      host === "localhost" ||
      host.endsWith(".localhost") ||
      host.endsWith(".local") ||
      host.endsWith(".internal")
    ) {
      throw new Error("Nepovolená sieťová adresa (SSRF ochrana): lokálne adresy nie sú povolené.");
    }
    const bare = host.replace(/^\[/, "").replace(/\]$/, "");
    const ipMatch = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(bare);
    if (ipMatch) {
      const a = Number(ipMatch[1]);
      const b = Number(ipMatch[2]);
      if (a === 127) throw new Error("Nepovolená sieťová adresa: loopback IP (127.0.0.0/8).");
      if (a === 10) throw new Error("Nepovolená sieťová adresa: privátna sieť (10.0.0.0/8).");
      if (a === 172 && b >= 16 && b <= 31)
        throw new Error("Nepovolená sieťová adresa: privátna sieť (172.16.0.0/12).");
      if (a === 192 && b === 168)
        throw new Error("Nepovolená sieťová adresa: privátna sieť (192.168.0.0/16).");
      if (a === 169 && b === 254)
        throw new Error(
          "Nepovolená sieťová adresa: link-local / metadata service (169.254.0.0/16).",
        );
      if (a === 0) throw new Error("Nepovolená sieťová adresa: 0.0.0.0/8.");
    }
    if (parsed.port && parsed.port !== "80" && parsed.port !== "443") {
      throw new Error("Povolené sú iba porty 80 a 443.");
    }
    if (parsed.username || parsed.password) {
      throw new Error("URL adresa nesmie obsahovať prihlasovacie údaje (userinfo).");
    }
    throw new Error("Nepovolená sieťová adresa (SSRF ochrana).");
  }
}

export class SsrfBlockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SsrfBlockedError";
  }
}

export class TooManyRedirectsError extends Error {
  constructor(maxRedirects: number) {
    super(`Príliš veľa presmerovaní (max ${maxRedirects}).`);
    this.name = "TooManyRedirectsError";
  }
}

/** Injectable DNS resolver (production default: DNS-over-HTTPS). */
export interface DnsResolver {
  resolve(hostname: string, signal?: AbortSignal): Promise<string[]>;
}

/** Default resolver: DNS-over-HTTPS against cloudflare-dns.com, types A and AAAA. */
export function createDohResolver(fetchFn: typeof fetch = fetch): DnsResolver {
  return {
    async resolve(hostname: string, signal?: AbortSignal): Promise<string[]> {
      const name = normalizeHostname(hostname);
      const ips = new Set<string>();
      for (const qtype of [1, 28] as const) {
        const url = `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(name)}&type=${qtype === 1 ? "A" : "AAAA"}`;
        const res = await fetchFn(url, {
          signal,
          headers: { Accept: "application/dns-json" },
        });
        if (!res.ok) continue;
        const json = (await res.json()) as { Answer?: { type: number; data?: string }[] };
        for (const ans of json.Answer ?? []) {
          if (ans.type === qtype && typeof ans.data === "string") ips.add(ans.data);
        }
      }
      return [...ips];
    },
  };
}

/**
 * Resolves the hostname and rejects when ANY returned IP is non-public.
 * IP literals are checked directly without DNS.
 */
async function assertResolvesToPublicIp(
  rawUrl: string,
  resolver: DnsResolver,
  signal?: AbortSignal,
): Promise<void> {
  const host = normalizeHostname(new URL(rawUrl).hostname);
  const bare = host.replace(/^\[/, "").replace(/\]$/, "");
  if (bare.includes(":") || /^\d{1,3}(\.\d{1,3}){3}$/.test(bare)) {
    if (isBlockedIp(bare)) {
      throw new SsrfBlockedError("IP adresa cieľa je blokovaná (SSRF ochrana).");
    }
    return;
  }
  let ips: string[];
  try {
    ips = await resolver.resolve(host, signal);
  } catch (err) {
    throw new SsrfBlockedError(
      `DNS rezolúcia zlyhala (fail-closed): ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  if (ips.length === 0) {
    throw new SsrfBlockedError(`DNS: doména ${host} nemá žiadnu A/AAAA záznam.`);
  }
  for (const ip of ips) {
    if (isBlockedIp(ip)) {
      throw new SsrfBlockedError(
        `DNS: doména ${host} vedie na blokovanú IP adresu (SSRF ochrana).`,
      );
    }
  }
}

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const DEFAULT_MAX_REDIRECTS = 5;

export interface SafeFetchOptions {
  maxRedirects?: number;
  fetchFn?: typeof fetch;
  resolver?: DnsResolver;
}

function assertSafePublicUrlTyped(rawUrl: string): void {
  try {
    assertSafePublicUrl(rawUrl);
  } catch (err) {
    throw new SsrfBlockedError(err instanceof Error ? err.message : String(err));
  }
}

/**
 * fetch() wrapper that never trusts redirects: every request goes out with
 * redirect: "manual". Each Location header is resolved relative to the current
 * URL and re-validated (URL rules + DNS resolution) before the next hop, so a
 * 302 to an internal/private address is rejected instead of followed.
 *
 * Redirect semantics:
 * - 303 always switches to GET without body and without Content-* headers;
 * - 301/302 with a POST also switch to GET without body and Content-* headers;
 * - 307/308 preserve method and body;
 * - on a cross-origin redirect (scheme+host+port change) the Authorization,
 *   Cookie and Proxy-Authorization headers are dropped.
 */
export async function safeFetch(
  input: string,
  init: RequestInit = {},
  options: SafeFetchOptions = {},
): Promise<Response> {
  const maxRedirects = options.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
  const fetchFn = options.fetchFn ?? fetch;
  const resolver = options.resolver ?? createDohResolver(fetchFn);

  let currentUrl = input;
  let currentInit: RequestInit = { ...init, redirect: "manual" };

  assertSafePublicUrlTyped(currentUrl);
  await assertResolvesToPublicIp(currentUrl, resolver, currentInit.signal ?? undefined);

  for (let hop = 0; ; hop++) {
    const res = await fetchFn(currentUrl, currentInit);
    if (!REDIRECT_STATUSES.has(res.status)) {
      return res;
    }
    if (hop >= maxRedirects) {
      throw new TooManyRedirectsError(maxRedirects);
    }
    const location = res.headers.get("location");
    if (!location) {
      throw new SsrfBlockedError("Presmerovanie bez hlavičky Location.");
    }
    let nextUrl: URL;
    try {
      nextUrl = new URL(location, currentUrl);
    } catch {
      throw new SsrfBlockedError("Neplatná hlavička Location pri presmerovaní.");
    }
    const next = nextUrl.toString();
    assertSafePublicUrlTyped(next);
    await assertResolvesToPublicIp(next, resolver, currentInit.signal ?? undefined);

    const crossOrigin = nextUrl.origin !== new URL(currentUrl).origin;
    const method = (currentInit.method ?? "GET").toUpperCase();
    const switchToGet =
      res.status === 303 || ((res.status === 301 || res.status === 302) && method === "POST");

    if (crossOrigin || switchToGet) {
      const headers = new Headers(currentInit.headers);
      if (crossOrigin) {
        headers.delete("authorization");
        headers.delete("cookie");
        headers.delete("proxy-authorization");
      }
      if (switchToGet) {
        for (const key of [...headers.keys()]) {
          if (key.toLowerCase().startsWith("content-")) headers.delete(key);
        }
        currentInit = { ...currentInit, method: "GET", body: undefined, headers };
      } else {
        currentInit = { ...currentInit, headers };
      }
    }
    currentUrl = next;
  }
}
