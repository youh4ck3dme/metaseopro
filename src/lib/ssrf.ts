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

/**
 * Fully expands an IPv6 address into 8 x 16-bit groups.
 * Handles "::" compression, hex groups and trailing embedded IPv4
 * (e.g. "::ffff:7f00:1" or "::ffff:127.0.0.1"). Returns null when unparseable.
 */
function expandIpv6(ip: string): number[] | null {
  let s = ip.toLowerCase().replace(/^\[/, "").replace(/\]$/, "").trim();
  const v4tail = /(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(s);
  if (v4tail) {
    const a = Number(v4tail[1]);
    const b = Number(v4tail[2]);
    const c = Number(v4tail[3]);
    const d = Number(v4tail[4]);
    if (a > 255 || b > 255 || c > 255 || d > 255) return null;
    s = `${s.slice(0, v4tail.index)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  if (!s.includes(":")) return null;
  const halves = s.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 ? (halves[1] ? halves[1].split(":") : []) : [];
  if (halves.length === 1) {
    if (head.length !== 8) return null;
    return head.map((g) => parseInt(g, 16));
  }
  const missing = 8 - head.length - tail.length;
  if (missing < 0) return null;
  const groups = [...head, ...Array<string>(missing).fill("0"), ...tail];
  if (groups.length !== 8 || groups.some((g) => !/^[0-9a-f]{1,4}$/.test(g))) return null;
  return groups.map((g) => parseInt(g, 16));
}

function isBlockedIpv4(a: number, b: number, c: number, d: number): boolean {
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
  if (a === 192 && b === 0 && c === 2) return true; // TEST-NET-1 (192.0.2.0/24)
  if (a === 198 && b === 51 && c === 100) return true; // TEST-NET-2 (198.51.100.0/24)
  if (a === 203 && b === 0 && c === 113) return true; // TEST-NET-3 (203.0.113.0/24)
  return false;
}

/**
 * True when an IP literal (v4 or v6) is loopback/private/link-local/CGNAT/
 * reserved/TEST-NET. IPv6 is fully expanded; embedded IPv4 inside
 * ::ffff:0:0/96, ::/96, 64:ff9b::/96 (NAT64) and 2002::/16 (6to4) is extracted
 * and checked as IPv4. For IPv6 only global unicast 2000::/3 is allowed,
 * minus ff00::/8, fec0::/10 and 2001:db8::/32.
 */
export function isBlockedIp(ip: string): boolean {
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip);
  if (v4) {
    return isBlockedIpv4(Number(v4[1]), Number(v4[2]), Number(v4[3]), Number(v4[4]));
  }
  const groups = expandIpv6(ip);
  if (!groups) return true; // unparseable IPv6 is blocked
  const p = groups as [number, number, number, number, number, number, number, number];
  const lastV4 = `${(p[6] >> 8) & 0xff}.${p[6] & 0xff}.${(p[7] >> 8) & 0xff}.${p[7] & 0xff}`;
  // Embedded IPv4 extraction
  if (p.slice(0, 5).every((g) => g === 0) && p[5] === 0xffff) {
    return isBlockedIpv4(...(lastV4.split(".").map(Number) as [number, number, number, number])); // ::ffff:0:0/96
  }
  if (p.slice(0, 6).every((g) => g === 0)) {
    return isBlockedIpv4(...(lastV4.split(".").map(Number) as [number, number, number, number])); // ::/96
  }
  if (p[0] === 0x0064 && p[1] === 0xff9b && p.slice(2, 6).every((g) => g === 0)) {
    return isBlockedIpv4(...(lastV4.split(".").map(Number) as [number, number, number, number])); // 64:ff9b::/96 (NAT64)
  }
  if (p[0] === 0x2002) {
    const v4 = `${(p[1] >> 8) & 0xff}.${p[1] & 0xff}.${(p[2] >> 8) & 0xff}.${p[2] & 0xff}`; // 2002::/16 (6to4)
    return isBlockedIpv4(...(v4.split(".").map(Number) as [number, number, number, number]));
  }
  if (p[0] === 0 && p[1] === 0 && p[2] === 0 && p[3] === 0 && p[4] === 0 && p[5] === 0) {
    return true; // :: (unspecified) and ::1 (loopback) — anything in ::/96 not caught above
  }
  if ((p[0] & 0xff00) === 0xff00) return true; // ff00::/8 (multicast)
  if (p[0] >= 0xfec0 && p[0] <= 0xfeff) return true; // fec0::/10 (site-local, deprecated)
  if (p[0] === 0x2001 && p[1] === 0x0db8) return true; // 2001:db8::/32 (documentation)
  if (p[0] >= 0xfe80 && p[0] <= 0xfebf) return true; // fe80::/10 (link-local)
  if (p[0] >= 0xfc00 && p[0] <= 0xfdff) return true; // fc00::/7 (ULA)
  // Only global unicast 2000::/3 is allowed for IPv6
  return (p[0] & 0xe000) !== 0x2000;
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

const DOH_TIMEOUT_MS = 3_000;

/**
 * Default resolver: DNS-over-HTTPS against cloudflare-dns.com, types A and
 * AAAA, each query with its own timeout. Fail-closed: a non-OK HTTP status or
 * a DoH Status other than 0 (NOERROR) / 3 (NXDOMAIN) throws SsrfBlockedError,
 * even if the other query type returned a public IP.
 */
export function createDohResolver(
  fetchFn: typeof fetch = fetch,
  timeoutMs = DOH_TIMEOUT_MS,
): DnsResolver {
  return {
    async resolve(hostname: string, signal?: AbortSignal): Promise<string[]> {
      const name = normalizeHostname(hostname);
      const ips = new Set<string>();
      for (const qtype of [1, 28] as const) {
        const url = `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(name)}&type=${qtype === 1 ? "A" : "AAAA"}`;
        const combined = AbortSignal.any(
          [signal, AbortSignal.timeout(timeoutMs)].filter((s): s is AbortSignal => Boolean(s)),
        );
        const res = await fetchFn(url, {
          signal: combined,
          headers: { Accept: "application/dns-json" },
        });
        if (!res.ok) {
          throw new SsrfBlockedError(
            `DoH dotaz ${qtype === 1 ? "A" : "AAAA"} zlyhal (HTTP ${res.status}).`,
          );
        }
        const json = (await res.json()) as {
          Status?: number;
          Answer?: { type: number; data?: string }[];
        };
        const status = json.Status ?? 0;
        if (status !== 0 && status !== 3) {
          throw new SsrfBlockedError(
            `DoH dotaz ${qtype === 1 ? "A" : "AAAA"} vrátil Status ${status}.`,
          );
        }
        if (status === 3) continue; // NXDOMAIN — no records for this type
        for (const ans of json.Answer ?? []) {
          if (ans.type === qtype && typeof ans.data === "string") ips.add(ans.data);
        }
      }
      return [...ips];
    },
  };
}

/**
 * RESIDUAL RISK — TOCTOU / DNS rebinding:
 * The hostname is resolved via DNS before every HTTP hop, but between the DNS
 * answer and the actual TCP connection the record can change (rebinding).
 * On Cloudflare Workers the fetch API cannot pin a validated IP, so this
 * window cannot be fully closed here. Mitigations applied: every A/AAAA
 * record is validated (not just the first), DNS failure is fail-closed, and
 * every redirect hop is re-resolved. Full protection would require connecting
 * to the validated IP with the original Host header (or an egress proxy).
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
    if (err instanceof SsrfBlockedError) throw err;
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
const DEFAULT_TIMEOUT_MS = 10_000;

export interface SafeFetchOptions {
  maxRedirects?: number;
  timeoutMs?: number;
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
 *   Cookie and Proxy-Authorization headers are dropped;
 * - redirecting from https:// down to http:// is rejected;
 * - the body of a redirect response is cancelled.
 *
 * The whole operation is bounded by a default 10 s timeout combined with the
 * caller's signal via AbortSignal.any().
 */
export async function safeFetch(
  input: string,
  init: RequestInit = {},
  options: SafeFetchOptions = {},
): Promise<Response> {
  const maxRedirects = options.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const fetchFn = options.fetchFn ?? fetch;
  const resolver = options.resolver ?? createDohResolver(fetchFn);

  const signal = AbortSignal.any(
    [init.signal, AbortSignal.timeout(timeoutMs)].filter((s): s is AbortSignal => Boolean(s)),
  );

  let currentUrl = input;
  let currentInit: RequestInit = { ...init, redirect: "manual" };

  assertSafePublicUrlTyped(currentUrl);
  await assertResolvesToPublicIp(currentUrl, resolver, signal);

  for (let hop = 0; ; hop++) {
    const res = await fetchFn(currentUrl, { ...currentInit, signal });
    if (!REDIRECT_STATUSES.has(res.status)) {
      return res;
    }
    if (hop >= maxRedirects) {
      throw new TooManyRedirectsError(maxRedirects);
    }
    const location = res.headers.get("location");
    await res.body?.cancel().catch(() => undefined);
    if (!location) {
      throw new SsrfBlockedError("Presmerovanie bez hlavičky Location.");
    }
    let nextUrl: URL;
    try {
      nextUrl = new URL(location, currentUrl);
    } catch {
      throw new SsrfBlockedError("Neplatná hlavička Location pri presmerovaní.");
    }
    if (new URL(currentUrl).protocol === "https:" && nextUrl.protocol === "http:") {
      throw new SsrfBlockedError("Presmerovanie z https:// na http:// nie je povolené.");
    }
    const next = nextUrl.toString();
    assertSafePublicUrlTyped(next);
    await assertResolvesToPublicIp(next, resolver, signal);

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
