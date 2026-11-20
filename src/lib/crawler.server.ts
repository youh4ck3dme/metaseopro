/**
 * Same-host multipage SEO crawler.
 * Every fetch goes through isSafePublicUrl and safeFetch (manual redirects,
 * re-checked after each hop). Robots Disallow is respected.
 */
import { checkRateLimit } from "@/lib/rate-limit.server";
import { SERP_LIMITS, textPixelWidth, validateJsonLd } from "@/lib/opportunity";
import { normalizeUrl } from "@/lib/raketa-schema";
import {
  isSafePublicUrl,
  safeFetch,
  createDohResolver,
  SsrfBlockedError,
  TooManyRedirectsError,
  type DnsResolver,
} from "@/lib/ssrf";

export const DEFAULT_PAGE_LIMIT = 25;
export const DEFAULT_CRAWL_TIMEOUT_MS = 30_000;
export const DEFAULT_REQUEST_TIMEOUT_MS = 10_000;
export const DEFAULT_MAX_BYTES = 1_000_000;
/** Hard caps so that no parser ever works on unbounded attacker-controlled input. */
export const MAX_ROBOTS_BYTES = 512 * 1024;
/** Cap on rules in groups that apply to our user agent (`*` and our product token). */
export const MAX_ROBOTS_RULES = 5_000;
/** Cap on the summed pattern length of applicable rules, bounds matching cost per URL. */
export const MAX_ROBOTS_PATTERN_CHARS = 64 * 1024;
/** Disallowed URLs skipped at dequeue between two yields to the event loop. */
export const ROBOTS_SKIP_YIELD_MS = 10;
/** Max robots-disallowed URLs skipped at dequeue per crawl, then PARTIAL_CRAWL. */
export const MAX_ROBOTS_SKIPS = 200;
/**
 * Max total time spent matching robots rules (enqueue + dequeue) per crawl (ms).
 * Wall-clock, so a slow or busy machine reaches it sooner; the crawler then
 * stops matching at enqueue and the dequeue check stays the safety net. The
 * clock is injectable (`CrawlOptions.now`) so tests do not depend on speed.
 */
export const MAX_ROBOTS_MATCH_MS = 150;
export const MAX_ROBOTS_PATTERN_LENGTH = 512;
const MAX_ROBOTS_PATH_LENGTH = 2_048;
const MAX_TITLE_SCAN = 2_000;
/** Frontier / link caps so one hostile page cannot blow up CPU or memory. */
export const MAX_LINKS_PER_PAGE = 500;
export const MAX_ANCHORS_SCANNED = 5_000;
export const MAX_QUEUED_URLS = 1_000;
export const MAX_RESULT_LINKS_PER_PAGE = 100;
export const CRAWLER_USER_AGENT = "Mozilla/5.0 (compatible; SEO4WEBBot/1.0)";

export type FindingSeverity = "critical" | "warning" | "info";

export type CrawlStepState =
  "BLOCKED: ROBOTS" | "BLOCKED: SSRF" | "NO_SITEMAP" | "TIMEOUT" | "PARTIAL_CRAWL";

export type CrawlFinding = {
  url: string;
  severity: FindingSeverity;
  code: string;
  message: string;
};

export type HreflangRef = { lang: string; href: string };

export type PageAudit = {
  url: string;
  status: number;
  title: string;
  titleLength: number;
  titlePixelWidth: number;
  description: string;
  descriptionLength: number;
  descriptionPixelWidth: number;
  h1Count: number;
  canonical: string | null;
  noindex: boolean;
  hreflang: HreflangRef[];
  og: Record<string, string>;
  twitter: Record<string, string>;
  jsonLdErrors: string[];
  imagesWithoutAlt: number;
  internalLinks: string[];
  brokenInternalLinks: string[];
  findings: CrawlFinding[];
};

export type CrawlResult = {
  startUrl: string;
  host: string;
  pages: PageAudit[];
  findings: CrawlFinding[];
  stepStates: CrawlStepState[];
  crawledCount: number;
  discoveredCount: number;
  /**
   * URLs found but not queued because robots.txt disallows them. Always
   * present (0 on early returns). A lower bound when
   * `robotsFilteredCountIsLowerBound` is true: once the matching budget is used
   * up, further URLs are no longer matched at enqueue (the dequeue check still
   * never fetches a disallowed URL).
   */
  robotsFilteredCount: number;
  /** True when the matching budget was exhausted, so robotsFilteredCount is "at least". */
  robotsFilteredCountIsLowerBound: boolean;
};

export type CrawlOptions = {
  pageLimit?: number;
  timeoutMs?: number;
  requestTimeoutMs?: number;
  maxBytes?: number;
  fetchFn?: typeof fetch;
  resolver?: DnsResolver;
  signal?: AbortSignal;
  userAgent?: string;
  /**
   * Clock (ms) that meters robots matching time. Tests inject a fake clock so
   * the MAX_ROBOTS_MATCH_MS budget is deterministic; defaults to performance.now.
   */
  now?: () => number;
};

/**
 * A robots rule compiled once at parse time: `pattern` is already
 * percent-normalized, `parts` is the pattern split on `*` (without the
 * trailing `$`), so matching a URL does no per-rule normalization.
 */
type RobotsRule = {
  allow: boolean;
  pattern: string;
  anchored: boolean;
  parts: string[];
  /** Pattern length without the trailing `$` (RFC 9309: longest match wins). */
  specificity: number;
};

function compileRobotsRule(allow: boolean, normalizedPattern: string): RobotsRule {
  const anchored = normalizedPattern.endsWith("$");
  const body = anchored ? normalizedPattern.slice(0, -1) : normalizedPattern;
  return {
    allow,
    pattern: normalizedPattern,
    anchored,
    parts: body.split("*"),
    specificity: body.length,
  };
}
type RobotsGroup = { agents: string[]; rules: RobotsRule[] };

export type ParsedRobots = {
  groups: RobotsGroup[];
  sitemaps: string[];
  /**
   * True when a cap (file size, rule count, pattern length) cut the file.
   * Fail-closed: isPathAllowed then denies everything.
   */
  truncated?: boolean;
};

class OffsiteRedirectError extends Error {
  constructor(
    readonly target: string,
    readonly reason: "OFFSITE" | "ROBOTS" = "OFFSITE",
  ) {
    super("Redirect target is not allowed");
    this.name = "OffsiteRedirectError";
  }
}

/** Thrown inside crawlSite to restart on the www/apex counterpart of the seed. */
class SeedRestart extends Error {
  constructor(readonly target: string) {
    super("Seed host switch");
    this.name = "SeedRestart";
  }
}

function stripWww(host: string): string {
  return normalizeHost(host).replace(/^www\./, "");
}

/** True when the hosts differ only by a leading "www." (apex <-> www). */
function isWwwSwap(a: string, b: string): boolean {
  try {
    const ha = normalizeHost(new URL(a).hostname);
    const hb = normalizeHost(new URL(b).hostname);
    return ha !== hb && stripWww(ha) === stripWww(hb);
  } catch {
    return false;
  }
}

type FetchOk = {
  ok: true;
  url: string;
  /** Final URL as reported by the response (trailing slash kept), for robots checks. */
  finalRaw: string;
  status: number;
  headers: Headers;
  body: string;
};
type FetchErr = {
  ok: false;
  url: string;
  status?: number;
  error: "SSRF" | "TIMEOUT" | "NETWORK" | "OFFSITE" | "ROBOTS_REDIRECT" | "REDIRECT_LOOP";
};
type FetchOutcome = FetchOk | FetchErr;

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}

function normalizeHost(hostname: string): string {
  return hostname.toLowerCase().trim().replace(/\.+$/, "");
}

function asciiLower(s: string): string {
  // Unlike String#toLowerCase this never changes the string length, so indexes
  // found in the lowered copy are valid in the original.
  return s.replace(/[A-Z]+/g, (m) => m.toLowerCase());
}

function isTagBoundary(ch: string | undefined): boolean {
  return ch === undefined || ch === ">" || ch === "/" || /\s/.test(ch);
}

type ScannedTag = {
  /** Lower-cased attribute names, first occurrence wins. */
  attrs: Map<string, string>;
  /** Index right after the closing ">" of the start tag. */
  end: number;
};

function isSpace(ch: string): boolean {
  return ch === " " || ch === "\t" || ch === "\n" || ch === "\r" || ch === "\f";
}

/**
 * Parses one start tag beginning at `from` (just after the tag name) with a
 * single forward pass. Returns null when the tag is never closed. No regex,
 * no backtracking: the cost is O(length of the tag).
 */
function parseStartTag(html: string, from: number): ScannedTag | null {
  const attrs = new Map<string, string>();
  const n = html.length;
  let i = from;
  for (;;) {
    while (i < n && (isSpace(html[i]!) || html[i] === "/")) i++;
    if (i >= n) return null;
    if (html[i] === ">") return { attrs, end: i + 1 };
    const nameStart = i;
    while (i < n && !isSpace(html[i]!) && html[i] !== "=" && html[i] !== ">" && html[i] !== "/") {
      i++;
    }
    const name = asciiLower(html.slice(nameStart, i));
    while (i < n && isSpace(html[i]!)) i++;
    let value = "";
    if (html[i] === "=") {
      i++;
      while (i < n && isSpace(html[i]!)) i++;
      const q = html[i];
      if (q === '"' || q === "'") {
        const close = html.indexOf(q, i + 1);
        if (close < 0) return null;
        value = html.slice(i + 1, close);
        i = close + 1;
      } else {
        const vs = i;
        while (i < n && !isSpace(html[i]!) && html[i] !== ">") i++;
        value = html.slice(vs, i);
      }
    }
    if (name && !attrs.has(name)) attrs.set(name, value);
  }
}

/**
 * Linear iteration over start tags named `tagName`. `lower` must be
 * asciiLower(html). The scan position always moves forward past the tag that
 * was just parsed, so the total cost is O(html.length).
 */
function* scanTags(
  html: string,
  lower: string,
  tagName: string,
): Generator<ScannedTag & { start: number }> {
  const needle = `<${tagName}`;
  let pos = 0;
  for (;;) {
    const at = lower.indexOf(needle, pos);
    if (at < 0) return;
    const after = at + needle.length;
    if (!isTagBoundary(lower[after])) {
      pos = after;
      continue;
    }
    const tag = parseStartTag(html, after);
    if (!tag) return;
    yield { ...tag, start: at };
    pos = tag.end;
  }
}

function isSameHost(a: string, b: string): boolean {
  try {
    return normalizeHost(new URL(a).hostname) === normalizeHost(new URL(b).hostname);
  } catch {
    return false;
  }
}

/**
 * Canonical form used for dedup: no fragment, no trailing slash. The URL that is
 * actually requested and checked against robots.txt is the form as written
 * (see `writtenCrawlUrl`), because RFC 9309 matches `/dir/` and `/dir`
 * differently.
 */
export function canonicalizeCrawlUrl(raw: string, base?: string): string | null {
  const url = parseCrawlUrl(raw, base);
  if (!url) return null;
  if (url.pathname.length > 1 && url.pathname.endsWith("/")) {
    url.pathname = url.pathname.slice(0, -1);
  }
  return url.toString();
}

function parseCrawlUrl(raw: string, base?: string): URL | null {
  let url: URL;
  try {
    url = base ? new URL(raw, base) : new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  url.hash = "";
  if (!url.pathname) url.pathname = "/";
  return url;
}

/** The URL as written (fragment dropped, trailing slash kept). */
function writtenCrawlUrl(raw: string, base?: string): string | null {
  return parseCrawlUrl(raw, base)?.toString() ?? null;
}

/**
 * Remembers, per canonical URL, the form it was first written in. The crawler
 * requests and robots-checks that form, so a link to `/dir/` is never turned
 * into `/dir` (which robots.txt may treat differently).
 */
function noteWritten(
  writtenForms: Map<string, string> | undefined,
  canonical: string,
  raw: string,
  base?: string,
): void {
  if (!writtenForms || writtenForms.has(canonical)) return;
  writtenForms.set(canonical, writtenCrawlUrl(raw, base) ?? canonical);
}

function pathAndQuery(raw: string): string {
  try {
    const url = new URL(raw);
    return `${url.pathname}${url.search}` || "/";
  } catch {
    return "/";
  }
}

function finding(
  url: string,
  severity: FindingSeverity,
  code: string,
  message: string,
): CrawlFinding {
  return { url, severity, code, message };
}

function addState(states: CrawlStepState[], state: CrawlStepState): void {
  if (!states.includes(state)) states.push(state);
}

/**
 * Parses robots.txt for `userAgent`: only rules of groups that apply to that
 * agent (`*` or its product token) are kept, so query the result with the same
 * agent.
 */
export function parseRobotsTxt(text: string, userAgent = "SEO4WEBBot"): ParsedRobots {
  const token = robotsProductToken(userAgent);
  const groups: RobotsGroup[] = [];
  const sitemaps: string[] = [];
  let current: RobotsGroup | null = null;
  // RFC 9309: consecutive User-agent lines form one group; a User-agent line
  // after any rule starts a new group. Blank lines carry no meaning.
  let lastWasAgent = false;
  let ruleCount = 0;
  let patternChars = 0;
  let truncated = false;

  if (text.length > MAX_ROBOTS_BYTES) truncated = true;
  const capped = text.length > MAX_ROBOTS_BYTES ? text.slice(0, MAX_ROBOTS_BYTES) : text;
  for (const rawLine of capped.split(/\r?\n/)) {
    const hash = rawLine.indexOf("#");
    const line = (hash >= 0 ? rawLine.slice(0, hash) : rawLine).trim();
    if (!line) continue;
    const idx = line.indexOf(":");
    if (idx < 0) continue;
    const field = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();

    if (field === "sitemap" && value) {
      sitemaps.push(value);
      continue;
    }
    if (field === "user-agent" && value) {
      if (!current || !lastWasAgent) {
        current = { agents: [value.toLowerCase()], rules: [] };
        groups.push(current);
      } else {
        current.agents.push(value.toLowerCase());
      }
      lastWasAgent = true;
      continue;
    }
    if ((field === "disallow" || field === "allow") && current) {
      lastWasAgent = false;
      // Only groups that apply to us count against the caps (a big file with
      // many rules for other bots must not block the crawl). Caps on groups
      // that DO apply stay fail-closed.
      const applies = current.agents.some((a) => a === "*" || robotsProductToken(a) === token);
      // Rules of groups that do not apply to us are never used by the crawler:
      // drop them without normalizing (no CPU spent on hostile non-ASCII
      // content in other bots' groups).
      if (!applies) continue;
      // Raw length first (bounds the work of normalizing), then the length
      // AFTER percent-normalization, which is what matching actually costs:
      // a non-ASCII character expands to 6 characters ("ž" -> "%C5%BE").
      const tooLong = value.length > MAX_ROBOTS_PATTERN_LENGTH;
      const normalized = tooLong ? "" : normalizePercent(value);
      const normalizedTooLong = normalized.length > MAX_ROBOTS_PATTERN_LENGTH;
      if (
        ruleCount >= MAX_ROBOTS_RULES ||
        tooLong ||
        normalizedTooLong ||
        patternChars + normalized.length > MAX_ROBOTS_PATTERN_CHARS
      ) {
        truncated = true;
        continue;
      }
      ruleCount += 1;
      patternChars += normalized.length;
      current.rules.push(compileRobotsRule(field === "allow", normalized));
    }
  }
  return { groups, sitemaps, truncated };
}

/**
 * Normalizes percent-encoding as RFC 9309 2.2.2 asks: unreserved characters are
 * decoded, other escapes upper-cased, non-ASCII characters UTF-8 encoded.
 */
function normalizePercent(input: string): string {
  let out = input;
  if (/[\u0080-\uffff]/.test(out)) {
    try {
      out = out.replace(/[\u0080-\uffff]+/g, (m) => encodeURIComponent(m));
    } catch {
      // lone surrogate: leave as is
    }
  }
  return out.replace(/%([0-9a-fA-F]{2})/g, (_m, hex: string) => {
    const code = parseInt(hex, 16);
    const ch = String.fromCharCode(code);
    return /[A-Za-z0-9\-._~]/.test(ch) ? ch : `%${hex.toUpperCase()}`;
  });
}

/**
 * RFC 9309 pattern match without a regex engine: `*` matches any run of
 * characters, a trailing `$` anchors the end, everything else is literal.
 * The pattern is split on `*` and the literal segments are located left to
 * right with indexOf, so there is no backtracking and no exponential case.
 */
function matchCompiledRule(rule: RobotsRule, target: string): boolean {
  const { parts, anchored } = rule;
  const first = parts[0]!;
  if (!target.startsWith(first)) return false;
  if (parts.length === 1) return anchored ? target === first : true;

  let pos = first.length;
  const last = parts[parts.length - 1]!;
  for (let i = 1; i < parts.length - 1; i++) {
    const seg = parts[i]!;
    if (!seg) continue;
    const at = target.indexOf(seg, pos);
    if (at < 0) return false;
    pos = at + seg.length;
  }
  if (anchored) {
    return target.length - last.length >= pos && target.endsWith(last);
  }
  return last === "" || target.indexOf(last, pos) >= 0;
}

function normalizeRobotsPath(path: string): string {
  return normalizePercent(
    path.length > MAX_ROBOTS_PATH_LENGTH ? path.slice(0, MAX_ROBOTS_PATH_LENGTH) : path,
  );
}

export function robotsPatternMatches(pattern: string, path: string): boolean {
  if (pattern.length > MAX_ROBOTS_PATTERN_LENGTH) return false;
  const normalized = normalizePercent(pattern);
  if (normalized.length > MAX_ROBOTS_PATTERN_LENGTH) return false;
  return matchCompiledRule(compileRobotsRule(true, normalized), normalizeRobotsPath(path));
}

/** Product token of a User-agent value: "SEO4WEBBot/1.0 (x)" -> "seo4webbot". */
function robotsProductToken(value: string): string {
  return value.toLowerCase().trim().split(/[\s/]/, 1)[0] ?? "";
}

export function isPathAllowed(robots: ParsedRobots, path: string, userAgent: string): boolean {
  // Fail-closed on capped robots files and on absurdly long paths.
  if (robots.truncated || path.length > MAX_ROBOTS_PATH_LENGTH) return false;
  const token = robotsProductToken(userAgent);
  const exact = robots.groups.filter((g) => g.agents.some((a) => robotsProductToken(a) === token));
  const wildcard = robots.groups.filter((g) => g.agents.includes("*"));
  const groups = exact.length > 0 ? exact : wildcard;
  if (groups.length === 0) return true;

  // Normalize the path once per URL; patterns were normalized at parse time.
  const target = normalizeRobotsPath(path);
  let best: { length: number; allow: boolean } | null = null;
  for (const group of groups) {
    for (const rule of group.rules) {
      if (rule.pattern === "") continue;
      if (!matchCompiledRule(rule, target)) continue;
      const length = rule.specificity;
      if (!best || length > best.length || (length === best.length && rule.allow && !best.allow)) {
        best = { length, allow: rule.allow };
      }
    }
  }
  return best ? best.allow : true;
}

export function parseSitemapLocs(xml: string): { locs: string[]; isIndex: boolean } {
  const lower = asciiLower(xml);
  const isIndex = lower.includes("<sitemapindex");
  const locs: string[] = [];
  let pos = 0;
  for (;;) {
    const at = lower.indexOf("<loc", pos);
    if (at < 0) break;
    const afterName = at + 4;
    if (!isTagBoundary(lower[afterName])) {
      pos = afterName;
      continue;
    }
    const gt = lower.indexOf(">", afterName);
    if (gt < 0) break;
    const close = lower.indexOf("</loc", gt + 1);
    if (close < 0) break;
    const inner = xml.slice(gt + 1, close);
    pos = close + 5;
    if (inner.includes("<")) continue;
    const loc = decodeEntities(inner.trim());
    if (loc) locs.push(loc);
  }
  return { locs, isIndex };
}

function extractMeta(html: string, name: string, lower = asciiLower(html)): string {
  const wanted = name.toLowerCase();
  for (const tag of scanTags(html, lower, "meta")) {
    const key = tag.attrs.get("name") ?? tag.attrs.get("property");
    if (key === undefined || key.trim().toLowerCase() !== wanted) continue;
    const content = tag.attrs.get("content");
    if (content === undefined) continue;
    return decodeEntities(content.trim());
  }
  return "";
}

function extractTitle(html: string, lower = asciiLower(html)): string {
  const [tag] = scanTags(html, lower, "title");
  if (!tag) return "";
  const close = lower.indexOf("</title", tag.end);
  if (close < 0) return "";
  const raw = html.slice(tag.end, Math.min(close, tag.end + MAX_TITLE_SCAN));
  // Strip nested tags with indexOf instead of /<[^>]+>/ (quadratic on "<<<<").
  let text = "";
  let i = 0;
  for (;;) {
    const lt = raw.indexOf("<", i);
    if (lt < 0) {
      text += raw.slice(i);
      break;
    }
    text += raw.slice(i, lt);
    const gt = raw.indexOf(">", lt + 1);
    if (gt < 0) {
      text += raw.slice(lt);
      break;
    }
    text += " ";
    i = gt + 1;
  }
  return decodeEntities(text.replace(/\s+/g, " ").trim());
}

function countH1(html: string, lower = asciiLower(html)): number {
  let count = 0;
  for (const _tag of scanTags(html, lower, "h1")) count += 1;
  return count;
}

function relTokens(rel: string | undefined): string[] {
  return (rel ?? "")
    .split(/\s+/)
    .filter(Boolean)
    .map((t) => t.toLowerCase());
}

function extractCanonical(html: string, lower = asciiLower(html)): string | null {
  for (const tag of scanTags(html, lower, "link")) {
    if (!relTokens(tag.attrs.get("rel")).includes("canonical")) continue;
    const href = tag.attrs.get("href");
    if (href && href.trim()) return decodeEntities(href.trim());
  }
  return null;
}

function extractHreflang(html: string, lower = asciiLower(html)): HreflangRef[] {
  const out: HreflangRef[] = [];
  for (const tag of scanTags(html, lower, "link")) {
    if (!relTokens(tag.attrs.get("rel")).includes("alternate")) continue;
    const lang = tag.attrs.get("hreflang");
    const href = tag.attrs.get("href");
    if (lang && lang.trim() && href && href.trim()) {
      out.push({ lang: lang.trim(), href: decodeEntities(href.trim()) });
    }
  }
  return out;
}

function extractNamedMetaPrefix(
  html: string,
  prefix: "og:" | "twitter:",
  lower = asciiLower(html),
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const tag of scanTags(html, lower, "meta")) {
    const key = (tag.attrs.get("name") ?? tag.attrs.get("property") ?? "").trim();
    const content = tag.attrs.get("content");
    if (!key || content === undefined) continue;
    if (key.toLowerCase().startsWith(prefix)) {
      out[key.toLowerCase()] = decodeEntities(content.trim());
    }
  }
  return out;
}

function extractJsonLdBlocks(html: string, lower = asciiLower(html)): string[] {
  const blocks: string[] = [];
  let pos = 0;
  for (;;) {
    const at = lower.indexOf("<script", pos);
    if (at < 0) break;
    if (!isTagBoundary(lower[at + 7])) {
      pos = at + 7;
      continue;
    }
    const tag = parseStartTag(html, at + 7);
    if (!tag) break;
    const close = lower.indexOf("</script", tag.end);
    if (close < 0) break;
    pos = close + 8;
    if ((tag.attrs.get("type") ?? "").trim().toLowerCase() !== "application/ld+json") continue;
    const body = html.slice(tag.end, close).trim();
    if (body) blocks.push(body);
  }
  return blocks;
}

function countImagesWithoutAlt(html: string, lower = asciiLower(html)): number {
  let count = 0;
  for (const tag of scanTags(html, lower, "img")) {
    const alt = tag.attrs.get("alt");
    if (alt === undefined || alt.trim() === "") count += 1;
  }
  return count;
}

function extractInternalLinks(
  html: string,
  pageUrl: string,
  startUrl: string,
  lower = asciiLower(html),
  writtenForms?: Map<string, string>,
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  let scanned = 0;
  for (const tag of scanTags(html, lower, "a")) {
    if (out.length >= MAX_LINKS_PER_PAGE || ++scanned > MAX_ANCHORS_SCANNED) break;
    const hrefRaw = tag.attrs.get("href");
    if (!hrefRaw) continue;
    const raw = decodeEntities(hrefRaw.trim());
    if (!raw || raw.startsWith("#")) continue;
    const low = raw.toLowerCase();
    if (
      low.startsWith("mailto:") ||
      low.startsWith("tel:") ||
      low.startsWith("javascript:") ||
      low.startsWith("data:")
    ) {
      continue;
    }
    const abs = canonicalizeCrawlUrl(raw, pageUrl);
    if (!abs || !isSameHost(abs, startUrl) || !isSafePublicUrl(abs)) continue;
    if (seen.has(abs)) continue;
    seen.add(abs);
    noteWritten(writtenForms, abs, raw, pageUrl);
    out.push(abs);
  }
  return out;
}

function hasNoindex(html: string, headers: Headers, lower = asciiLower(html)): boolean {
  const header = headers.get("x-robots-tag") ?? "";
  if (/\bnoindex\b/i.test(header)) return true;
  for (const name of ["robots", "googlebot"]) {
    const content = extractMeta(html, name, lower);
    if (/\bnoindex\b/i.test(content)) return true;
  }
  return false;
}

async function readCappedBody(
  res: Response,
  maxBytes: number,
  signal?: AbortSignal,
): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) {
    // A Response without a stream has no body to read; never buffer it with
    // res.text() (unbounded).
    return "";
  }
  const decoder = new TextDecoder();
  let body = "";
  let received = 0;
  try {
    for (;;) {
      if (signal?.aborted) break;
      const { done, value } = await reader.read();
      if (done) break;
      const remaining = maxBytes - received;
      if (remaining <= 0) {
        void reader.cancel().catch(() => undefined);
        break;
      }
      const chunk = value.byteLength > remaining ? value.slice(0, remaining) : value;
      received += chunk.byteLength;
      body += decoder.decode(chunk, { stream: true });
      if (value.byteLength > remaining) {
        void reader.cancel().catch(() => undefined);
        break;
      }
    }
  } finally {
    body += decoder.decode();
  }
  return body;
}

async function fetchDocument(
  rawUrl: string,
  options: {
    fetchFn?: typeof fetch;
    resolver?: DnsResolver;
    signal?: AbortSignal;
    timeoutMs: number;
    maxBytes: number;
    userAgent: string;
    accept: string;
    /**
     * Checked BEFORE every redirect hop is requested. When it returns false the
     * request is never sent and the outcome is { error: "OFFSITE" } or
     * { error: "ROBOTS_REDIRECT" }. `rawUrl` keeps the path as requested
     * (with its trailing slash), `url` is the canonical form.
     */
    allowRedirectTo?: (url: string, rawUrl: string) => true | "OFFSITE" | "ROBOTS";
  },
): Promise<FetchOutcome> {
  // Requested as written (trailing slash kept); only the fragment is dropped.
  const url = writtenCrawlUrl(rawUrl) ?? rawUrl;
  if (!isSafePublicUrl(url)) {
    return { ok: false, url, error: "SSRF" };
  }

  let lastUrl = url;
  let requestCount = 0;
  const trackedFetch: typeof fetch = (input, init) => {
    const requested =
      typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    requestCount += 1;
    if (requestCount > 1 && options.allowRedirectTo) {
      const canonical = canonicalizeCrawlUrl(requested) ?? requested;
      const verdict = options.allowRedirectTo(canonical, requested);
      if (verdict !== true) throw new OffsiteRedirectError(canonical, verdict);
    }
    lastUrl = requested;
    const fetchFn = options.fetchFn ?? fetch;
    return fetchFn(input, init);
  };

  const controller = new AbortController();
  const onAbort = () => controller.abort();
  options.signal?.addEventListener("abort", onAbort, { once: true });

  try {
    const res = await safeFetch(
      url,
      {
        signal: controller.signal,
        headers: {
          "User-Agent": options.userAgent,
          Accept: options.accept,
        },
      },
      {
        fetchFn: trackedFetch,
        // Built from the untracked fetch so DoH lookups never overwrite
        // lastUrl (the URL reported in findings).
        resolver: options.resolver ?? createDohResolver(options.fetchFn ?? fetch),
        timeoutMs: options.timeoutMs,
      },
    );

    const finalUrl = canonicalizeCrawlUrl(res.url || lastUrl) ?? lastUrl;
    if (!isSafePublicUrl(finalUrl)) {
      return { ok: false, url: finalUrl, error: "SSRF" };
    }

    const body = await readCappedBody(res, options.maxBytes, options.signal);
    return {
      ok: true,
      url: finalUrl,
      finalRaw: res.url || lastUrl,
      status: res.status,
      headers: res.headers,
      body,
    };
  } catch (err) {
    if (err instanceof OffsiteRedirectError) {
      return {
        ok: false,
        url: err.target,
        error: err.reason === "ROBOTS" ? "ROBOTS_REDIRECT" : "OFFSITE",
      };
    }
    if (err instanceof TooManyRedirectsError) {
      return { ok: false, url: lastUrl, error: "REDIRECT_LOOP" };
    }
    if (err instanceof SsrfBlockedError) {
      return { ok: false, url: lastUrl, error: "SSRF" };
    }
    const aborted =
      options.signal?.aborted ||
      (err instanceof Error && (err.name === "AbortError" || err.name === "TimeoutError"));
    return { ok: false, url: lastUrl, error: aborted ? "TIMEOUT" : "NETWORK" };
  } finally {
    options.signal?.removeEventListener("abort", onAbort);
  }
}

function looksLikeXml(body: string, contentType: string, url: string): boolean {
  const ct = contentType.toLowerCase();
  if (ct.includes("xml") || ct.includes("text/plain"))
    return /<(\?xml|urlset|sitemapindex)\b/i.test(body);
  if (!ct || ct.includes("octet-stream")) {
    return /<(\?xml|urlset|sitemapindex)\b/i.test(body) || /\.xml(\?|$)/i.test(url);
  }
  return /<(\?xml|urlset|sitemapindex)\b/i.test(body);
}

async function discoverSitemaps(
  startUrl: string,
  robotsSitemaps: string[],
  fetchOpts: Parameters<typeof fetchDocument>[1],
  signal: AbortSignal,
  stepStates: CrawlStepState[],
  findings: CrawlFinding[],
  writtenForms?: Map<string, string>,
): Promise<string[]> {
  const origin = new URL(startUrl).origin;
  const candidates: string[] = [];
  const seen = new Set<string>();
  const push = (raw: string, base?: string) => {
    const abs = canonicalizeCrawlUrl(raw, base);
    if (!abs || seen.has(abs)) return;
    if (!isSameHost(abs, startUrl) || !isSafePublicUrl(abs)) return;
    seen.add(abs);
    candidates.push(abs);
  };

  for (const loc of robotsSitemaps) push(loc, startUrl);
  push(`${origin}/sitemap.xml`);
  push(`${origin}/sitemap_index.xml`);

  const pageUrls: string[] = [];
  const pageSeen = new Set<string>();
  const collectPage = (raw: string) => {
    const abs = canonicalizeCrawlUrl(raw, startUrl);
    if (!abs || pageSeen.has(abs)) return;
    if (!isSameHost(abs, startUrl) || !isSafePublicUrl(abs)) return;
    pageSeen.add(abs);
    noteWritten(writtenForms, abs, raw, startUrl);
    pageUrls.push(abs);
  };

  const indexQueue = [...candidates];
  const visitedSitemaps = new Set<string>();
  const maxSitemaps = 10;
  const maxUrls = 1000;

  while (indexQueue.length > 0 && visitedSitemaps.size < maxSitemaps && !signal.aborted) {
    const sitemapUrl = indexQueue.shift()!;
    if (visitedSitemaps.has(sitemapUrl)) continue;
    visitedSitemaps.add(sitemapUrl);

    const result = await fetchDocument(sitemapUrl, fetchOpts);
    if (!result.ok) {
      if (result.error === "SSRF") {
        addState(stepStates, "BLOCKED: SSRF");
        findings.push(
          finding(
            result.url,
            "critical",
            "SSRF_BLOCKED",
            "Sitemap URL nie je povolená (SSRF ochrana).",
          ),
        );
      }
      continue;
    }
    if (result.status >= 400) continue;
    const ct = result.headers.get("content-type") ?? "";
    if (!looksLikeXml(result.body, ct, result.url)) continue;

    const parsed = parseSitemapLocs(result.body);
    if (parsed.isIndex) {
      for (const loc of parsed.locs) {
        if (indexQueue.length + visitedSitemaps.size >= maxSitemaps) break;
        const abs = canonicalizeCrawlUrl(loc, result.url);
        if (
          abs &&
          isSameHost(abs, startUrl) &&
          isSafePublicUrl(abs) &&
          !visitedSitemaps.has(abs) &&
          !indexQueue.includes(abs)
        ) {
          indexQueue.push(abs);
        }
      }
    } else {
      for (const loc of parsed.locs) {
        if (pageUrls.length >= maxUrls) break;
        collectPage(loc);
      }
    }
  }

  return pageUrls;
}

function auditPageHtml(
  pageUrl: string,
  startUrl: string,
  status: number,
  headers: Headers,
  html: string,
  writtenForms?: Map<string, string>,
): PageAudit {
  const lower = asciiLower(html);
  const title = extractTitle(html, lower);
  const description = extractMeta(html, "description", lower);
  const titlePixel = title ? textPixelWidth(title) : 0;
  const descPixel = description ? textPixelWidth(description) : 0;
  const h1Count = countH1(html, lower);
  const canonicalRaw = extractCanonical(html, lower);
  const canonical = canonicalRaw ? canonicalizeCrawlUrl(canonicalRaw, pageUrl) : null;
  const noindex = hasNoindex(html, headers, lower);
  const hreflang = extractHreflang(html, lower);
  const og = extractNamedMetaPrefix(html, "og:", lower);
  const twitter = extractNamedMetaPrefix(html, "twitter:", lower);
  const jsonLdErrors: string[] = [];
  const blocks = extractJsonLdBlocks(html, lower);
  if (blocks.length === 0) {
    jsonLdErrors.push("Chýba JSON-LD.");
  } else {
    for (const block of blocks) {
      try {
        const parsed: unknown = JSON.parse(block);
        jsonLdErrors.push(...validateJsonLd(parsed));
      } catch {
        jsonLdErrors.push("JSON-LD sa nepodarilo spracovať.");
      }
    }
  }
  const imagesWithoutAlt = countImagesWithoutAlt(html, lower);
  const internalLinks = extractInternalLinks(html, pageUrl, startUrl, lower, writtenForms);
  const findings: CrawlFinding[] = [];

  if (status >= 400) {
    findings.push(
      finding(pageUrl, "critical", "HTTP_STATUS", `Stránka vrátila HTTP stav ${status}.`),
    );
  }

  if (!title) {
    findings.push(finding(pageUrl, "critical", "TITLE_MISSING", "Chýba title tag."));
  } else {
    if (title.length < 15) {
      findings.push(
        finding(pageUrl, "warning", "TITLE_SHORT", "Title je príliš krátky (menej ako 15 znakov)."),
      );
    }
    if (title.length > 60) {
      findings.push(
        finding(pageUrl, "warning", "TITLE_LONG", "Title je príliš dlhý (viac ako 60 znakov)."),
      );
    }
    if (titlePixel > SERP_LIMITS.desktopTitle) {
      findings.push(
        finding(
          pageUrl,
          "warning",
          "TITLE_PIXEL",
          `Title presahuje ${SERP_LIMITS.desktopTitle} px v SERP (${Math.round(titlePixel)} px).`,
        ),
      );
    }
  }

  if (!description) {
    findings.push(finding(pageUrl, "warning", "DESCRIPTION_MISSING", "Chýba meta description."));
  } else {
    if (description.length < 70) {
      findings.push(
        finding(
          pageUrl,
          "warning",
          "DESCRIPTION_SHORT",
          "Meta description je príliš krátka (menej ako 70 znakov).",
        ),
      );
    }
    if (description.length > 160) {
      findings.push(
        finding(
          pageUrl,
          "warning",
          "DESCRIPTION_LONG",
          "Meta description je príliš dlhá (viac ako 160 znakov).",
        ),
      );
    }
    if (descPixel > SERP_LIMITS.desktopDesc) {
      findings.push(
        finding(
          pageUrl,
          "warning",
          "DESCRIPTION_PIXEL",
          `Meta description presahuje ${SERP_LIMITS.desktopDesc} px v SERP (${Math.round(descPixel)} px).`,
        ),
      );
    }
  }

  if (h1Count === 0) {
    findings.push(finding(pageUrl, "warning", "H1_MISSING", "Chýba H1 nadpis."));
  } else if (h1Count > 1) {
    findings.push(finding(pageUrl, "warning", "H1_MULTIPLE", `Stránka má ${h1Count} H1 nadpisov.`));
  }

  if (!canonicalRaw) {
    findings.push(finding(pageUrl, "warning", "CANONICAL_MISSING", "Chýba canonical odkaz."));
  } else if (!canonical) {
    findings.push(finding(pageUrl, "warning", "CANONICAL_INVALID", "Canonical URL je neplatná."));
  } else if (!isSameHost(canonical, startUrl)) {
    findings.push(
      finding(pageUrl, "warning", "CANONICAL_HOST", "Canonical ukazuje na inú doménu."),
    );
  }

  if (noindex) {
    findings.push(
      finding(pageUrl, "warning", "NOINDEX", "Stránka má noindex a nebude indexovaná."),
    );
  }

  for (const ref of hreflang) {
    const abs = canonicalizeCrawlUrl(ref.href, pageUrl);
    if (!abs) {
      findings.push(
        finding(
          pageUrl,
          "warning",
          "HREFLANG_INVALID",
          `Neplatný hreflang href pre jazyk „${ref.lang}“.`,
        ),
      );
    }
  }

  if (!og["og:title"]) {
    findings.push(finding(pageUrl, "warning", "OG_TITLE_MISSING", "Chýba og:title."));
  }
  if (!og["og:description"]) {
    findings.push(finding(pageUrl, "warning", "OG_DESCRIPTION_MISSING", "Chýba og:description."));
  }
  if (!og["og:image"]) {
    findings.push(finding(pageUrl, "warning", "OG_IMAGE_MISSING", "Chýba og:image."));
  }
  if (!og["og:url"]) {
    findings.push(finding(pageUrl, "warning", "OG_URL_MISSING", "Chýba og:url."));
  }
  if (!twitter["twitter:card"]) {
    findings.push(finding(pageUrl, "warning", "TWITTER_CARD_MISSING", "Chýba twitter:card."));
  }

  if (blocks.length === 0) {
    findings.push(finding(pageUrl, "info", "JSON_LD_MISSING", "Chýba JSON-LD."));
  } else {
    for (const err of jsonLdErrors) {
      const code = err === "JSON-LD sa nepodarilo spracovať." ? "JSON_LD_INVALID" : "JSON_LD_ERROR";
      findings.push(finding(pageUrl, "warning", code, err));
    }
  }

  if (imagesWithoutAlt > 0) {
    findings.push(
      finding(
        pageUrl,
        "warning",
        "IMAGE_ALT_MISSING",
        `${imagesWithoutAlt} ${imagesWithoutAlt === 1 ? "obrázok nemá" : "obrázkov nemá"} atribút alt.`,
      ),
    );
  }

  return {
    url: pageUrl,
    status,
    title,
    titleLength: title.length,
    titlePixelWidth: titlePixel,
    description,
    descriptionLength: description.length,
    descriptionPixelWidth: descPixel,
    h1Count,
    canonical: canonical ?? canonicalRaw,
    noindex,
    hreflang,
    og,
    twitter,
    jsonLdErrors,
    imagesWithoutAlt,
    internalLinks,
    brokenInternalLinks: [],
    findings,
  };
}

function emptyErrorPage(url: string, status: number, message: string, code: string): PageAudit {
  return {
    url,
    status,
    title: "",
    titleLength: 0,
    titlePixelWidth: 0,
    description: "",
    descriptionLength: 0,
    descriptionPixelWidth: 0,
    h1Count: 0,
    canonical: null,
    noindex: false,
    hreflang: [],
    og: {},
    twitter: {},
    jsonLdErrors: [],
    imagesWithoutAlt: 0,
    internalLinks: [],
    brokenInternalLinks: [],
    findings: [finding(url, "critical", code, message)],
  };
}

const NO_ROBOTS_FILTER = { robotsFilteredCount: 0, robotsFilteredCountIsLowerBound: false };

export async function crawlSite(
  rawStartUrl: string,
  options: CrawlOptions = {},
): Promise<CrawlResult> {
  return crawlSiteInner(rawStartUrl, options, true);
}

async function crawlSiteInner(
  rawStartUrl: string,
  options: CrawlOptions,
  allowSeedSwap: boolean,
): Promise<CrawlResult> {
  const startedAt = Date.now();
  let restartTarget: string | null = null;
  const botName = (options.userAgent ?? CRAWLER_USER_AGENT).includes("SEO4WEBBot")
    ? "SEO4WEBBot"
    : (options.userAgent ?? CRAWLER_USER_AGENT);
  const pageLimit = Math.min(
    Math.max(options.pageLimit ?? DEFAULT_PAGE_LIMIT, 1),
    DEFAULT_PAGE_LIMIT,
  );
  const timeoutMs = options.timeoutMs ?? DEFAULT_CRAWL_TIMEOUT_MS;
  const requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const userAgent = options.userAgent ?? CRAWLER_USER_AGENT;
  const stepStates: CrawlStepState[] = [];
  const findings: CrawlFinding[] = [];
  const pages: PageAudit[] = [];

  const normalized = normalizeUrl(rawStartUrl) ?? canonicalizeCrawlUrl(rawStartUrl);
  if (!normalized) {
    const invalid = finding(rawStartUrl, "critical", "INVALID_URL", "Neplatná URL adresa.");
    return {
      startUrl: rawStartUrl,
      host: "",
      pages: [],
      findings: [invalid],
      stepStates: [],
      crawledCount: 0,
      discoveredCount: 0,
      ...NO_ROBOTS_FILTER,
    };
  }

  if (!isSafePublicUrl(normalized)) {
    addState(stepStates, "BLOCKED: SSRF");
    findings.push(
      finding(normalized, "critical", "SSRF_BLOCKED", "URL nie je povolená (SSRF ochrana)."),
    );
    return {
      startUrl: normalized,
      host: "",
      pages: [],
      findings,
      stepStates,
      crawledCount: 0,
      discoveredCount: 0,
      ...NO_ROBOTS_FILTER,
    };
  }

  // Canonical URL -> the form it was written in (fetched and robots-checked as written).
  const writtenForms = new Map<string, string>();
  const startUrl = canonicalizeCrawlUrl(normalized) ?? normalized;
  noteWritten(writtenForms, startUrl, normalized);
  const host = normalizeHost(new URL(startUrl).hostname);
  const origin = new URL(startUrl).origin;

  const crawlController = new AbortController();
  const timer = setTimeout(() => crawlController.abort(), timeoutMs);
  const onParentAbort = () => crawlController.abort();
  options.signal?.addEventListener("abort", onParentAbort, { once: true });

  const fetchOpts = {
    fetchFn: options.fetchFn,
    resolver: options.resolver,
    signal: crawlController.signal,
    timeoutMs: requestTimeoutMs,
    maxBytes,
    userAgent,
    accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  };
  // Pages and sitemaps: a redirect hop is requested only if it stays on the
  // start host (checked before the request is sent). robots.txt may follow
  // redirects like RFC 9309 allows.
  const sitemapOpts = {
    ...fetchOpts,
    allowRedirectTo: (target: string) =>
      (isSameHost(target, startUrl) ? true : "OFFSITE") as true | "OFFSITE",
  };
  // Pages additionally need robots.txt to allow every redirect hop (the rules
  // are known once robots.txt is parsed, see `robotsRef`).
  let robotsRef: ParsedRobots | null = null;
  const pageOpts = {
    ...fetchOpts,
    allowRedirectTo: (target: string, rawUrl: string): true | "OFFSITE" | "ROBOTS" => {
      if (!isSameHost(target, startUrl)) return "OFFSITE";
      if (robotsRef && !isPathAllowed(robotsRef, pathAndQuery(rawUrl), botName)) return "ROBOTS";
      return true;
    },
  };

  let discoveredCount = 0;
  let robotsFilteredCount = 0;
  let robotsFilteredCountIsLowerBound = false;

  try {
    const robotsResult = await fetchDocument(`${origin}/robots.txt`, {
      ...fetchOpts,
      accept: "text/plain,text/*;q=0.8,*/*;q=0.1",
    });

    // apex <-> www switch of the seed host: restart there (robots.txt of the
    // final host is then fetched first, nothing else was requested yet).
    if (
      allowSeedSwap &&
      robotsResult.ok &&
      isWwwSwap(robotsResult.url, startUrl) &&
      isSafePublicUrl(robotsResult.url)
    ) {
      throw new SeedRestart(`${new URL(robotsResult.url).origin}${pathAndQuery(startUrl)}`);
    }

    let robots: ParsedRobots = { groups: [], sitemaps: [] };
    if (!robotsResult.ok) {
      if (robotsResult.error === "SSRF") {
        addState(stepStates, "BLOCKED: SSRF");
        findings.push(
          finding(
            robotsResult.url,
            "critical",
            "SSRF_BLOCKED",
            "robots.txt nie je povolený (SSRF ochrana).",
          ),
        );
        return {
          startUrl,
          host,
          pages,
          findings,
          stepStates,
          crawledCount: 0,
          discoveredCount: 0,
          ...NO_ROBOTS_FILTER,
        };
      }
      // RFC 9309 2.3.1.4: robots.txt unreachable (network error / timeout)
      // => assume complete disallow.
      if (robotsResult.error === "TIMEOUT") addState(stepStates, "TIMEOUT");
      addState(stepStates, "BLOCKED: ROBOTS");
      findings.push(
        finding(
          robotsResult.url,
          "critical",
          "ROBOTS_UNAVAILABLE",
          "robots.txt sa nepodarilo načítať, crawl sa zastavil (RFC 9309).",
        ),
      );
      return {
        startUrl,
        host,
        pages,
        findings,
        stepStates,
        crawledCount: 0,
        discoveredCount: 0,
        ...NO_ROBOTS_FILTER,
      };
    } else if (robotsResult.status >= 500 || robotsResult.status === 429) {
      // RFC 9309 2.3.1.4: server error => assume complete disallow. 429 is
      // treated like 5xx (fail-closed, as major crawlers do).
      addState(stepStates, "BLOCKED: ROBOTS");
      findings.push(
        finding(
          robotsResult.url,
          "critical",
          "ROBOTS_UNAVAILABLE",
          `robots.txt vrátil HTTP ${robotsResult.status}, crawl sa zastavil (RFC 9309).`,
        ),
      );
      return {
        startUrl,
        host,
        pages,
        findings,
        stepStates,
        crawledCount: 0,
        discoveredCount: 0,
        ...NO_ROBOTS_FILTER,
      };
    } else if (robotsResult.status < 400) {
      robots = parseRobotsTxt(robotsResult.body, botName);
    }
    robotsRef = robots;

    // Robots is evaluated on the URL exactly as written (including a trailing
    // slash), which is also the form that is requested.
    const requestUrl = (url: string): string => writtenForms.get(url) ?? url;
    const pathAllowed = (url: string): boolean =>
      isPathAllowed(robots, pathAndQuery(requestUrl(url)), botName);

    if (!pathAllowed(startUrl)) {
      addState(stepStates, "BLOCKED: ROBOTS");
      findings.push(
        robots.truncated
          ? finding(
              startUrl,
              "critical",
              "ROBOTS_TOO_LARGE",
              "robots.txt presahuje limity parsera, crawl sa zastavil (fail-closed).",
            )
          : finding(
              startUrl,
              "critical",
              "ROBOTS_DISALLOW",
              "robots.txt zakazuje prehľadávanie tejto URL.",
            ),
      );
      return {
        startUrl,
        host,
        pages,
        findings,
        stepStates,
        crawledCount: 0,
        discoveredCount: 0,
        ...NO_ROBOTS_FILTER,
      };
    }

    const sitemapUrls = await discoverSitemaps(
      startUrl,
      robots.sitemaps,
      sitemapOpts,
      crawlController.signal,
      stepStates,
      findings,
      writtenForms,
    );
    if (sitemapUrls.length === 0) {
      addState(stepStates, "NO_SITEMAP");
    }

    let skippedByRobots = 0;
    let robotsMatchMs = 0;
    const clock = options.now ?? (() => performance.now());
    let lastYieldAt = clock();
    /** Time-based yield: hand the event loop back every ~ROBOTS_SKIP_YIELD_MS of sync work. */
    const yieldIfBusy = async (): Promise<void> => {
      if (clock() - lastYieldAt >= ROBOTS_SKIP_YIELD_MS) {
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
        lastYieldAt = clock();
      }
    };
    const disallowedSeen = new Set<string>();
    /** Runs a robots check and adds its time to the shared matching budget. */
    const timedPathAllowed = (url: string): boolean => {
      const t0 = clock();
      const allowed = pathAllowed(url);
      robotsMatchMs += clock() - t0;
      return allowed;
    };
    /** robots.txt check with the shared matching-time budget (see MAX_ROBOTS_MATCH_MS). */
    const robotsAllows = (url: string): boolean => {
      // Budget used up: stop matching here, the dequeue check decides.
      if (robotsMatchMs >= MAX_ROBOTS_MATCH_MS) {
        robotsFilteredCountIsLowerBound = true;
        return true;
      }
      return timedPathAllowed(url);
    };
    const queue: string[] = [];
    const queued = new Set<string>();
    const enqueue = (url: string) => {
      if (queued.has(url)) return;
      if (!isSameHost(url, startUrl) || !isSafePublicUrl(url)) return;
      // Disallowed URLs never enter the frontier (so they cannot crowd out
      // allowed ones); they are only counted. The dequeue check stays as a
      // safety net for URLs queued once the matching-time budget is used up.
      if (disallowedSeen.has(url)) return;
      if (!robotsAllows(url)) {
        disallowedSeen.add(url);
        robotsFilteredCount += 1;
        return;
      }
      if (queued.size >= MAX_QUEUED_URLS) {
        addState(stepStates, "PARTIAL_CRAWL");
        return;
      }
      queued.add(url);
      queue.push(url);
    };

    enqueue(startUrl);
    for (const url of sitemapUrls) {
      enqueue(url);
      await yieldIfBusy();
    }
    discoveredCount = queued.size;

    const statusByUrl = new Map<string, number>();
    const inbound = new Map<string, Set<string>>();
    const rememberLink = (from: string, to: string) => {
      let set = inbound.get(to);
      if (!set) {
        set = new Set();
        inbound.set(to, set);
      }
      set.add(from);
    };

    while (queue.length > 0) {
      if (crawlController.signal.aborted) {
        addState(stepStates, "TIMEOUT");
        if (pages.length > 0 || queue.length > 0) addState(stepStates, "PARTIAL_CRAWL");
        break;
      }
      if (pages.length >= pageLimit) {
        addState(stepStates, "PARTIAL_CRAWL");
        break;
      }

      const url = queue.shift()!;
      // Safety net (not budget-limited): never fetch a disallowed URL.
      if (!timedPathAllowed(url)) {
        // Skipping disallowed URLs is synchronous CPU work: yield regularly so
        // a hostile frontier cannot block the event loop (timers, other crawls).
        skippedByRobots += 1;
        if (skippedByRobots >= MAX_ROBOTS_SKIPS || robotsMatchMs >= MAX_ROBOTS_MATCH_MS) {
          // Skip budget exhausted: stop instead of burning CPU on a hostile frontier.
          addState(stepStates, "PARTIAL_CRAWL");
          findings.push(
            finding(
              startUrl,
              "info",
              "ROBOTS_SKIP_LIMIT",
              `Príliš veľa URL zakázaných v robots.txt (limit ${MAX_ROBOTS_SKIPS} preskočení alebo ${MAX_ROBOTS_MATCH_MS} ms porovnávania pravidiel); crawl sa zastavil. Doteraz auditované stránky zostávajú platné.`,
            ),
          );
          break;
        }
        // Time-based yield: give the event loop back at least every ~10 ms of
        // synchronous matching work.
        await yieldIfBusy();
        continue;
      }
      const result = await fetchDocument(requestUrl(url), pageOpts);
      if (crawlController.signal.aborted && result.ok === false && result.error === "TIMEOUT") {
        addState(stepStates, "TIMEOUT");
        enqueueFront(queue, url);
        if (pages.length > 0 || queue.length > 0) addState(stepStates, "PARTIAL_CRAWL");
        break;
      }

      if (!result.ok) {
        if (result.error === "OFFSITE") {
          if (allowSeedSwap && url === startUrl && isWwwSwap(result.url, startUrl)) {
            throw new SeedRestart(result.url);
          }
          const off = emptyErrorPage(
            url,
            0,
            `Presmerované na iný host (${result.url}); nebolo nasledované ani auditované.`,
            "REDIRECT_OFFSITE",
          );
          for (const f of off.findings) f.severity = "warning";
          pages.push(off);
          continue;
        }
        if (result.error === "REDIRECT_LOOP") {
          const loop = emptyErrorPage(
            url,
            0,
            "Príliš veľa presmerovaní (možná slučka presmerovaní); stránka nebola načítaná.",
            "REDIRECT_LOOP",
          );
          pages.push(loop);
          statusByUrl.set(url, 0);
          continue;
        }
        if (result.error === "ROBOTS_REDIRECT") {
          // A redirect hop leads to a URL robots.txt disallows: it was never requested.
          if (url === startUrl) addState(stepStates, "BLOCKED: ROBOTS");
          const blocked = emptyErrorPage(
            url,
            0,
            `Presmerovanie vedie na URL zakázanú v robots.txt (${result.url}); nebola stiahnutá ani auditovaná.`,
            "REDIRECT_DISALLOWED",
          );
          for (const f of blocked.findings) f.severity = "info";
          pages.push(blocked);
          continue;
        }
        if (result.error === "SSRF") {
          addState(stepStates, "BLOCKED: SSRF");
          const page = emptyErrorPage(
            result.url,
            0,
            "URL nie je povolená (SSRF ochrana).",
            "SSRF_BLOCKED",
          );
          pages.push(page);
          statusByUrl.set(url, 0);
          statusByUrl.set(result.url, 0);
          continue;
        }
        if (result.error === "TIMEOUT") {
          addState(stepStates, "TIMEOUT");
          addState(stepStates, "PARTIAL_CRAWL");
          break;
        }
        const page = emptyErrorPage(url, 0, "Stránku sa nepodarilo načítať.", "FETCH_FAILED");
        pages.push(page);
        statusByUrl.set(url, 0);
        continue;
      }

      if (!isSameHost(result.url, startUrl)) {
        // Do not audit another host's content under this URL.
        const off = emptyErrorPage(
          url,
          result.status,
          `Presmerované na iný host (${result.url}); obsah sa neauditoval. Spusti crawl na cieľovej URL.`,
          "REDIRECT_OFFSITE",
        );
        for (const f of off.findings) f.severity = "warning";
        pages.push(off);
        continue;
      }
      const pageUrl = result.url;
      // Defense in depth: the final URL must be allowed too (hops were checked
      // on their raw form before they were requested).
      if (pageUrl !== url && !isPathAllowed(robots, pathAndQuery(result.finalRaw), botName)) {
        if (url === startUrl) addState(stepStates, "BLOCKED: ROBOTS");
        const blocked = emptyErrorPage(
          url,
          result.status,
          `Presmerovanie vedie na URL zakázanú v robots.txt (${pageUrl}); obsah sa neauditoval.`,
          "REDIRECT_DISALLOWED",
        );
        for (const f of blocked.findings) f.severity = "info";
        pages.push(blocked);
        continue;
      }
      if (!isSafePublicUrl(pageUrl)) {
        addState(stepStates, "BLOCKED: SSRF");
        pages.push(
          emptyErrorPage(pageUrl, 0, "URL nie je povolená (SSRF ochrana).", "SSRF_BLOCKED"),
        );
        continue;
      }

      const audit = auditPageHtml(
        pageUrl,
        startUrl,
        result.status,
        result.headers,
        result.body,
        writtenForms,
      );
      pages.push(audit);
      statusByUrl.set(url, result.status);
      statusByUrl.set(pageUrl, result.status);

      if (result.status < 400) {
        for (const link of audit.internalLinks) {
          rememberLink(pageUrl, link);
          if (!queued.has(link)) {
            enqueue(link);
            await yieldIfBusy();
            discoveredCount = queued.size;
          }
        }
      }
    }

    if (queue.length > 0 && !stepStates.includes("TIMEOUT") && pages.length >= pageLimit) {
      addState(stepStates, "PARTIAL_CRAWL");
    }

    attachBrokenLinks(pages, statusByUrl, inbound);
  } catch (err) {
    if (err instanceof SeedRestart) restartTarget = err.target;
    else throw err;
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", onParentAbort);
  }

  if (restartTarget) {
    // The seed lives on its www/apex counterpart: crawl there, once.
    const remaining = Math.max(1_000, timeoutMs - (Date.now() - startedAt));
    const restarted = await crawlSiteInner(
      restartTarget,
      { ...options, timeoutMs: remaining },
      false,
    );
    restarted.findings.unshift(
      finding(
        startUrl,
        "info",
        "SEED_HOST_CHANGED",
        `Štartovacia adresa presmerovala na ${restarted.host || restartTarget}; crawl pokračuje tam.`,
      ),
    );
    return restarted;
  }

  for (const page of pages) {
    // Keep the response small: the full list is only needed during the crawl.
    page.internalLinks = page.internalLinks.slice(0, MAX_RESULT_LINKS_PER_PAGE);
    findings.push(...page.findings);
  }

  return {
    startUrl,
    host,
    pages,
    findings,
    stepStates,
    crawledCount: pages.length,
    discoveredCount,
    robotsFilteredCount,
    robotsFilteredCountIsLowerBound,
  };
}

function enqueueFront(queue: string[], url: string): void {
  if (!queue.includes(url)) queue.unshift(url);
}

function attachBrokenLinks(
  pages: PageAudit[],
  statusByUrl: Map<string, number>,
  inbound: Map<string, Set<string>>,
): void {
  const byUrl = new Map(pages.map((p) => [p.url, p]));
  for (const [target, sources] of inbound) {
    const status = statusByUrl.get(target);
    const broken = status !== undefined && (status === 0 || status >= 400);
    if (!broken) continue;
    for (const source of sources) {
      const page = byUrl.get(source);
      if (!page) continue;
      if (!page.brokenInternalLinks.includes(target)) {
        page.brokenInternalLinks.push(target);
        page.findings.push(
          finding(source, "critical", "BROKEN_INTERNAL_LINK", `Neplatný interný odkaz: ${target}`),
        );
      }
    }
  }
}

export const CRAWL_RATE_LIMIT = { limit: 3, windowMs: 60_000 } as const;
export const MAX_CONCURRENT_CRAWLS_PER_USER = 1;
export const MAX_CONCURRENT_CRAWLS_GLOBAL = 4;

const activeCrawlsByUser = new Map<string, number>();
let activeCrawlsGlobal = 0;

export type CrawlSlot =
  { ok: true; release: () => void } | { ok: false; reason: "user" | "global" };

/** In-memory concurrency gate with the reason for a refusal. */
export function tryAcquireCrawlSlot(userId: string): CrawlSlot {
  const mine = activeCrawlsByUser.get(userId) ?? 0;
  if (mine >= MAX_CONCURRENT_CRAWLS_PER_USER) return { ok: false, reason: "user" };
  if (activeCrawlsGlobal >= MAX_CONCURRENT_CRAWLS_GLOBAL) return { ok: false, reason: "global" };
  activeCrawlsByUser.set(userId, mine + 1);
  activeCrawlsGlobal += 1;
  let released = false;
  return {
    ok: true,
    release: () => {
      if (released) return;
      released = true;
      activeCrawlsGlobal -= 1;
      const left = (activeCrawlsByUser.get(userId) ?? 1) - 1;
      if (left <= 0) activeCrawlsByUser.delete(userId);
      else activeCrawlsByUser.set(userId, left);
    },
  };
}

/** In-memory concurrency gate. Returns a release function, or null when full. */
export function acquireCrawlSlot(userId: string): (() => void) | null {
  const slot = tryAcquireCrawlSlot(userId);
  return slot.ok ? slot.release : null;
}

/** Rate limit + concurrency limit around crawlSite for one authenticated user. */
export async function runCrawlForUser(
  userId: string,
  input: { url: string; pageLimit?: number },
  crawl: typeof crawlSite = crawlSite,
): Promise<CrawlResult> {
  // Slot first: a refused concurrent attempt must not burn a rate-limit token.
  const slot = tryAcquireCrawlSlot(userId);
  if (!slot.ok) {
    throw new Error(
      slot.reason === "user"
        ? "Crawl už beží. Počkaj, kým skončí."
        : "Server je vyťažený. Skús to o chvíľu.",
    );
  }
  try {
    const rl = checkRateLimit(`crawl:${userId}`, CRAWL_RATE_LIMIT);
    if (!rl.ok) {
      throw new Error(`Príliš veľa požiadaviek. Skús to o ${rl.retryAfterSec}s.`);
    }
    return await crawl(input.url, { pageLimit: input.pageLimit });
  } finally {
    slot.release();
  }
}
