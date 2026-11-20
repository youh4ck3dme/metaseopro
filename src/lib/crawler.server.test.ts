import { afterEach, describe, expect, it, vi } from "vitest";
import { SERP_LIMITS, textPixelWidth } from "@/lib/opportunity";
import {
  acquireCrawlSlot,
  canonicalizeCrawlUrl,
  crawlSite,
  CRAWL_RATE_LIMIT,
  DEFAULT_PAGE_LIMIT,
  MAX_QUEUED_URLS,
  MAX_ROBOTS_RULES,
  MAX_ROBOTS_MATCH_MS,
  MAX_ROBOTS_SKIPS,
  MAX_RESULT_LINKS_PER_PAGE,
  isPathAllowed,
  parseRobotsTxt,
  parseSitemapLocs,
  robotsPatternMatches,
  runCrawlForUser,
  type CrawlResult,
} from "@/lib/crawler.server";
import type { DnsResolver } from "@/lib/ssrf";

// Wall-clock perf tests assert < 10 s internally; vitest's 5 s default timeout
// would cut them off first on a slow or loaded runner (P3-r).
const PERF_TEST_TIMEOUT_MS = 30_000;

const publicResolver: DnsResolver = {
  resolve: async () => ["93.184.216.34"],
};

function html({
  title = "SEO služby pre firmy na Slovensku",
  description = "Kompletné SEO služby a technický audit pre firmy na Slovensku s merateľnými výsledkami pre rast webu.",
  h1 = "<h1>SEO služby</h1>",
  extras = "",
  body = "<p>Obsah stránky s dostatočným textom pre bežnú kontrolu.</p>",
}: {
  title?: string;
  description?: string;
  h1?: string;
  extras?: string;
  body?: string;
} = {}): string {
  return `<!DOCTYPE html><html><head>
    <title>${title}</title>
    ${description ? `<meta name="description" content="${description}">` : ""}
    <link rel="canonical" href="https://mojweb.sk/">
    <meta property="og:title" content="${title}">
    <meta property="og:description" content="${description}">
    <meta property="og:image" content="https://mojweb.sk/og.png">
    <meta property="og:url" content="https://mojweb.sk/">
    <meta name="twitter:card" content="summary_large_image">
    <script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"Organization","name":"Mojweb"}]}</script>
  </head><body>${h1}${body}${extras}</body></html>`;
}

function xmlSitemap(locs: string[]): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
  <urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
    ${locs.map((loc) => `<url><loc>${loc}</loc></url>`).join("\n")}
  </urlset>`;
}

function xmlIndex(locs: string[]): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
  <sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
    ${locs.map((loc) => `<sitemap><loc>${loc}</loc></sitemap>`).join("\n")}
  </sitemapindex>`;
}

function ok(body: string, contentType = "text/html; charset=utf-8", status = 200): Response {
  return new Response(body, { status, headers: { "content-type": contentType } });
}

function redirect(location: string, status = 302): Response {
  return new Response(null, { status, headers: { location } });
}

type MockHandler = (url: string, init?: RequestInit) => Response | Promise<Response>;

function mockFetch(routes: Record<string, Response | MockHandler>): typeof fetch {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url =
      typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const exact = routes[url];
    if (typeof exact === "function") return exact(url, init);
    if (exact) return exact.clone();
    const withoutSlash = url.endsWith("/") ? url.slice(0, -1) : `${url}/`;
    const alt = routes[withoutSlash];
    if (typeof alt === "function") return alt(url, init);
    if (alt) return alt.clone();
    return new Response("not found", { status: 404, headers: { "content-type": "text/plain" } });
  }) as unknown as typeof fetch;
}

async function crawl(
  url: string,
  routes: Record<string, Response | MockHandler>,
  opts: Record<string, unknown> = {},
) {
  return crawlSite(url, {
    fetchFn: mockFetch(routes),
    resolver: publicResolver,
    pageLimit: 10,
    timeoutMs: 5_000,
    ...opts,
  });
}

describe("robots and sitemap parsers", () => {
  it("parses User-agent groups, Allow/Disallow and Sitemap", () => {
    const robots = parseRobotsTxt(`
User-agent: *
Disallow: /admin
Allow: /admin/public
Sitemap: https://mojweb.sk/sitemap.xml

User-agent: SEO4WEBBot
Disallow: /private
`);
    expect(robots.sitemaps).toEqual(["https://mojweb.sk/sitemap.xml"]);
    expect(isPathAllowed(robots, "/admin/secret", "SEO4WEBBot")).toBe(true);
    expect(isPathAllowed(robots, "/private", "SEO4WEBBot")).toBe(false);
    expect(isPathAllowed(robots, "/admin/secret", "OtherBot")).toBe(false);
    expect(isPathAllowed(robots, "/admin/public", "OtherBot")).toBe(true);
  });

  it("treats a missing matching rule as allowed", () => {
    const robots = parseRobotsTxt("User-agent: *\nDisallow: /tmp\n");
    expect(isPathAllowed(robots, "/about", "*")).toBe(true);
  });

  it("parses urlset and sitemap index loc entries", () => {
    const pages = parseSitemapLocs(xmlSitemap(["https://mojweb.sk/a", "https://mojweb.sk/b"]));
    expect(pages.isIndex).toBe(false);
    expect(pages.locs).toEqual(["https://mojweb.sk/a", "https://mojweb.sk/b"]);
    const index = parseSitemapLocs(xmlIndex(["https://mojweb.sk/sitemap-pages.xml"]));
    expect(index.isIndex).toBe(true);
    expect(index.locs).toEqual(["https://mojweb.sk/sitemap-pages.xml"]);
  });

  it("canonicalizes crawl URLs without fragments and trailing slashes", () => {
    expect(canonicalizeCrawlUrl("https://mojweb.sk/about/#top")).toBe("https://mojweb.sk/about");
    expect(canonicalizeCrawlUrl("/kontakt", "https://mojweb.sk/")).toBe(
      "https://mojweb.sk/kontakt",
    );
  });
});

describe("crawlSite discovery and limits", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("discovers pages from robots.txt sitemap and crawls same-host URLs", async () => {
    const result = await crawl("https://mojweb.sk/", {
      "https://mojweb.sk/robots.txt": ok(
        "User-agent: *\nAllow: /\nSitemap: https://mojweb.sk/sitemap.xml\n",
        "text/plain",
      ),
      "https://mojweb.sk/sitemap.xml": ok(
        xmlSitemap(["https://mojweb.sk/", "https://mojweb.sk/o-nas"]),
        "application/xml",
      ),
      "https://mojweb.sk/sitemap_index.xml": ok("nope", "text/html", 404),
      "https://mojweb.sk/": ok(html({ extras: '<a href="/o-nas">O nás</a>' })),
      "https://mojweb.sk/o-nas": ok(
        html({ title: "O nás – SEO služby pre firmy na webe", extras: '<a href="/">Domov</a>' }),
      ),
    });

    expect(result.stepStates).not.toContain("NO_SITEMAP");
    expect(result.stepStates).not.toContain("BLOCKED: ROBOTS");
    expect(result.crawledCount).toBe(2);
    expect(result.pages.map((p) => p.url).sort()).toEqual([
      "https://mojweb.sk/",
      "https://mojweb.sk/o-nas",
    ]);
  });

  it("follows a sitemap index and then the nested urlset", async () => {
    const result = await crawl("https://mojweb.sk/", {
      "https://mojweb.sk/robots.txt": ok("User-agent: *\nDisallow:\n", "text/plain"),
      "https://mojweb.sk/sitemap.xml": ok(
        xmlIndex(["https://mojweb.sk/sitemaps/pages.xml"]),
        "application/xml",
      ),
      "https://mojweb.sk/sitemap_index.xml": ok("missing", "text/plain", 404),
      "https://mojweb.sk/sitemaps/pages.xml": ok(
        xmlSitemap(["https://mojweb.sk/", "https://mojweb.sk/blog"]),
        "application/xml",
      ),
      "https://mojweb.sk/": ok(html()),
      "https://mojweb.sk/blog": ok(html({ title: "Blog o SEO pre slovenské firmy a eshopy" })),
    });

    expect(result.pages.some((p) => p.url === "https://mojweb.sk/blog")).toBe(true);
    expect(result.stepStates).not.toContain("NO_SITEMAP");
  });

  it("falls back to the homepage and internal links when no sitemap exists", async () => {
    const result = await crawl("https://mojweb.sk/", {
      "https://mojweb.sk/robots.txt": ok("User-agent: *\nAllow: /\n", "text/plain"),
      "https://mojweb.sk/sitemap.xml": ok("not xml", "text/html", 404),
      "https://mojweb.sk/sitemap_index.xml": ok("not xml", "text/html", 404),
      "https://mojweb.sk/": ok(
        html({ extras: '<a href="/kontakt">Kontakt</a><a href="https://cudziweb.sk/x">Von</a>' }),
      ),
      "https://mojweb.sk/kontakt": ok(
        html({ title: "Kontaktujte našu SEO agentúru na Slovensku" }),
      ),
      "https://cudziweb.sk/x": ok(html({ title: "Cudzí web by sa nemal prehľadávať teraz" })),
    });

    expect(result.stepStates).toContain("NO_SITEMAP");
    expect(result.pages.map((p) => p.url).sort()).toEqual([
      "https://mojweb.sk/",
      "https://mojweb.sk/kontakt",
    ]);
    expect(result.pages.some((p) => p.url.includes("cudziweb"))).toBe(false);
  });

  it("respects robots Disallow and does not fetch blocked paths", async () => {
    const fetchFn = mockFetch({
      "https://mojweb.sk/robots.txt": ok("User-agent: *\nDisallow: /tajne\n", "text/plain"),
      "https://mojweb.sk/sitemap.xml": ok("no", "text/html", 404),
      "https://mojweb.sk/sitemap_index.xml": ok("no", "text/html", 404),
      "https://mojweb.sk/": ok(html({ extras: '<a href="/tajne">Tajné</a><a href="/ok">OK</a>' })),
      "https://mojweb.sk/ok": ok(html({ title: "Verejná podstránka so správnou dĺžkou title" })),
      "https://mojweb.sk/tajne": ok(html({ title: "Toto sa nesmie stiahnuť z disallowed path" })),
    });
    const result = await crawlSite("https://mojweb.sk/", {
      fetchFn,
      resolver: publicResolver,
      pageLimit: 10,
      timeoutMs: 5_000,
    });
    const requested = (fetchFn as unknown as { mock: { calls: unknown[][] } }).mock.calls.map((c) =>
      String(c[0]),
    );
    expect(requested.some((u) => u.includes("/tajne"))).toBe(false);
    expect(result.pages.some((p) => p.url.endsWith("/tajne"))).toBe(false);
    expect(result.pages.some((p) => p.url.endsWith("/ok"))).toBe(true);
  });

  it("returns BLOCKED: ROBOTS when the start URL is disallowed", async () => {
    const fetchFn = mockFetch({
      "https://mojweb.sk/robots.txt": ok("User-agent: *\nDisallow: /\n", "text/plain"),
      "https://mojweb.sk/": ok(html()),
    });
    const result = await crawlSite("https://mojweb.sk/", {
      fetchFn,
      resolver: publicResolver,
      timeoutMs: 5_000,
    });
    expect(result.stepStates).toContain("BLOCKED: ROBOTS");
    expect(result.crawledCount).toBe(0);
    const requested = (fetchFn as unknown as { mock: { calls: unknown[][] } }).mock.calls.map((c) =>
      String(c[0]),
    );
    expect(requested.some((u) => u === "https://mojweb.sk/" || u === "https://mojweb.sk")).toBe(
      false,
    );
  });

  it("marks PARTIAL_CRAWL when the page limit is hit with remaining URLs", async () => {
    const result = await crawl(
      "https://mojweb.sk/",
      {
        "https://mojweb.sk/robots.txt": ok("User-agent: *\nAllow: /\n", "text/plain"),
        "https://mojweb.sk/sitemap.xml": ok(
          xmlSitemap(["https://mojweb.sk/", "https://mojweb.sk/a", "https://mojweb.sk/b"]),
          "application/xml",
        ),
        "https://mojweb.sk/sitemap_index.xml": ok("no", "text/html", 404),
        "https://mojweb.sk/": ok(html({ extras: '<a href="/a">A</a><a href="/b">B</a>' })),
        "https://mojweb.sk/a": ok(html({ title: "Stránka A s dosť dlhým titulkom pre test" })),
        "https://mojweb.sk/b": ok(html({ title: "Stránka B s dosť dlhým titulkom pre test" })),
      },
      { pageLimit: 1 },
    );
    expect(result.crawledCount).toBe(1);
    expect(result.discoveredCount).toBeGreaterThan(1);
    expect(result.stepStates).toContain("PARTIAL_CRAWL");
  });

  it("defaults the page limit to 25", async () => {
    expect(DEFAULT_PAGE_LIMIT).toBe(25);
    const routes: Record<string, Response> = {
      "https://mojweb.sk/robots.txt": ok("User-agent: *\nAllow: /\n", "text/plain"),
      "https://mojweb.sk/sitemap.xml": ok("no", "text/html", 404),
      "https://mojweb.sk/sitemap_index.xml": ok("no", "text/html", 404),
    };
    const extras = Array.from({ length: 30 }, (_, i) => `<a href="/p${i}">P${i}</a>`).join("");
    routes["https://mojweb.sk/"] = ok(html({ extras }));
    for (let i = 0; i < 30; i++) {
      routes[`https://mojweb.sk/p${i}`] = ok(
        html({ title: `Podstránka číslo ${i} s dlhším titulkom` }),
      );
    }
    const result = await crawlSite("https://mojweb.sk/", {
      fetchFn: mockFetch(routes),
      resolver: publicResolver,
      timeoutMs: 10_000,
    });
    expect(result.crawledCount).toBe(25);
    expect(result.stepStates).toContain("PARTIAL_CRAWL");
  });

  it("marks TIMEOUT and PARTIAL_CRAWL when the overall budget is exceeded", async () => {
    const hang: MockHandler = async (_url, init) => {
      const signal = init?.signal;
      await new Promise<never>((_, reject) => {
        if (signal?.aborted) {
          reject(new DOMException("Aborted", "AbortError"));
          return;
        }
        signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), {
          once: true,
        });
      });
      return ok(html());
    };
    const result = await crawlSite("https://mojweb.sk/", {
      fetchFn: mockFetch({
        "https://mojweb.sk/robots.txt": ok("User-agent: *\nAllow: /\n", "text/plain"),
        "https://mojweb.sk/sitemap.xml": ok("no", "text/html", 404),
        "https://mojweb.sk/sitemap_index.xml": ok("no", "text/html", 404),
        "https://mojweb.sk/": hang,
      }),
      resolver: publicResolver,
      timeoutMs: 40,
      requestTimeoutMs: 5_000,
    });
    expect(result.stepStates).toContain("TIMEOUT");
  });
});

describe("crawlSite SSRF protection", () => {
  it("blocks private IPs and localhost without fetching them", async () => {
    const fetchFn = vi.fn(async () => ok(html())) as unknown as typeof fetch;
    for (const url of [
      "http://127.0.0.1/",
      "http://localhost/",
      "http://10.1.2.3/admin",
      "http://192.168.0.5/",
    ]) {
      const result = await crawlSite(url, { fetchFn, resolver: publicResolver, timeoutMs: 2_000 });
      expect(result.stepStates, url).toContain("BLOCKED: SSRF");
      expect(result.crawledCount, url).toBe(0);
      expect(
        result.findings.some((f) => f.code === "SSRF_BLOCKED"),
        url,
      ).toBe(true);
    }
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("blocks a redirect to a private IP and records BLOCKED: SSRF", async () => {
    const fetchFn = mockFetch({
      "https://mojweb.sk/robots.txt": () => redirect("http://10.0.0.1/robots.txt"),
      "https://mojweb.sk/": ok(html()),
    });
    const result = await crawlSite("https://mojweb.sk/", {
      fetchFn,
      resolver: publicResolver,
      timeoutMs: 5_000,
    });
    expect(result.stepStates).toContain("BLOCKED: SSRF");
    expect(result.crawledCount).toBe(0);
    const requested = (fetchFn as unknown as { mock: { calls: unknown[][] } }).mock.calls.map((c) =>
      String(c[0]),
    );
    expect(requested.some((u) => u.includes("10.0.0.1"))).toBe(false);
  });

  it("blocks a page-level redirect to a loopback address", async () => {
    const result = await crawl("https://mojweb.sk/", {
      "https://mojweb.sk/robots.txt": ok("User-agent: *\nAllow: /\n", "text/plain"),
      "https://mojweb.sk/sitemap.xml": ok("no", "text/html", 404),
      "https://mojweb.sk/sitemap_index.xml": ok("no", "text/html", 404),
      "https://mojweb.sk/": () => redirect("http://127.0.0.1/secret"),
    });
    expect(result.stepStates).toContain("BLOCKED: SSRF");
    expect(result.findings.some((f) => f.code === "SSRF_BLOCKED")).toBe(true);
  });
});

describe("crawlSite per-page checks", () => {
  it("reports title and description length and pixel-width issues", async () => {
    const longTitle = "M".repeat(80);
    const longDesc = "M".repeat(200);
    expect(textPixelWidth(longTitle)).toBeGreaterThan(SERP_LIMITS.desktopTitle);
    expect(textPixelWidth(longDesc)).toBeGreaterThan(SERP_LIMITS.desktopDesc);

    const result = await crawl("https://mojweb.sk/", {
      "https://mojweb.sk/robots.txt": ok("User-agent: *\nAllow: /\n", "text/plain"),
      "https://mojweb.sk/sitemap.xml": ok("no", "text/html", 404),
      "https://mojweb.sk/sitemap_index.xml": ok("no", "text/html", 404),
      "https://mojweb.sk/": ok(html({ title: longTitle, description: longDesc })),
    });
    const codes = result.pages[0]!.findings.map((f) => f.code);
    expect(codes).toContain("TITLE_LONG");
    expect(codes).toContain("TITLE_PIXEL");
    expect(codes).toContain("DESCRIPTION_LONG");
    expect(codes).toContain("DESCRIPTION_PIXEL");
    expect(result.pages[0]!.titleLength).toBe(80);
    expect(result.pages[0]!.titlePixelWidth).toBe(textPixelWidth(longTitle));
    expect(result.pages[0]!.descriptionPixelWidth).toBe(textPixelWidth(longDesc));
  });

  it("reports missing title, missing description, H1 count, canonical, noindex and hreflang", async () => {
    const page = `<!DOCTYPE html><html><head>
      <meta name="robots" content="noindex,follow">
      <link rel="alternate" hreflang="sk" href="https://mojweb.sk/">
      <link rel="alternate" hreflang="en" href="javascript:alert(1)">
    </head><body>
      <h1>Jeden</h1><h1>Dva</h1>
    </body></html>`;
    const result = await crawl("https://mojweb.sk/", {
      "https://mojweb.sk/robots.txt": ok("User-agent: *\nAllow: /\n", "text/plain"),
      "https://mojweb.sk/sitemap.xml": ok("no", "text/html", 404),
      "https://mojweb.sk/sitemap_index.xml": ok("no", "text/html", 404),
      "https://mojweb.sk/": ok(page),
    });
    const codes = result.pages[0]!.findings.map((f) => f.code);
    expect(codes).toContain("TITLE_MISSING");
    expect(codes).toContain("DESCRIPTION_MISSING");
    expect(codes).toContain("H1_MULTIPLE");
    expect(result.pages[0]!.h1Count).toBe(2);
    expect(codes).toContain("CANONICAL_MISSING");
    expect(result.pages[0]!.noindex).toBe(true);
    expect(codes).toContain("NOINDEX");
    expect(codes).toContain("HREFLANG_INVALID");
    expect(result.pages[0]!.hreflang).toEqual([
      { lang: "sk", href: "https://mojweb.sk/" },
      { lang: "en", href: "javascript:alert(1)" },
    ]);
  });

  it("reports missing OG and Twitter tags and JSON-LD issues via validateJsonLd", async () => {
    const page = `<!DOCTYPE html><html><head>
      <title>SEO služby pre slovenské firmy a weby</title>
      <meta name="description" content="Kompletné SEO služby a technický audit pre firmy na Slovensku s merateľnými výsledkami pre rast webu.">
      <script type="application/ld+json">{"@type":"Organization","name":"Mojweb","aggregateRating":{"ratingValue":5}}</script>
      <script type="application/ld+json">{not-json</script>
    </head><body><h1>SEO</h1></body></html>`;
    const result = await crawl("https://mojweb.sk/", {
      "https://mojweb.sk/robots.txt": ok("User-agent: *\nAllow: /\n", "text/plain"),
      "https://mojweb.sk/sitemap.xml": ok("no", "text/html", 404),
      "https://mojweb.sk/sitemap_index.xml": ok("no", "text/html", 404),
      "https://mojweb.sk/": ok(page),
    });
    const codes = result.pages[0]!.findings.map((f) => f.code);
    expect(codes).toContain("OG_TITLE_MISSING");
    expect(codes).toContain("OG_DESCRIPTION_MISSING");
    expect(codes).toContain("OG_IMAGE_MISSING");
    expect(codes).toContain("OG_URL_MISSING");
    expect(codes).toContain("TWITTER_CARD_MISSING");
    expect(codes).toContain("JSON_LD_INVALID");
    expect(codes).toContain("JSON_LD_ERROR");
    expect(result.pages[0]!.jsonLdErrors.some((e) => e.includes("aggregateRating"))).toBe(true);
    expect(result.pages[0]!.jsonLdErrors.some((e) => e.includes("@graph"))).toBe(true);
  });

  it("counts images without alt and flags broken internal links", async () => {
    const result = await crawl("https://mojweb.sk/", {
      "https://mojweb.sk/robots.txt": ok("User-agent: *\nAllow: /\n", "text/plain"),
      "https://mojweb.sk/sitemap.xml": ok("no", "text/html", 404),
      "https://mojweb.sk/sitemap_index.xml": ok("no", "text/html", 404),
      "https://mojweb.sk/": ok(
        html({
          extras:
            '<img src="/a.png"><img src="/b.png" alt=""><img src="/c.png" alt="Logo"><a href="/chyba">Chyba</a>',
        }),
      ),
      "https://mojweb.sk/chyba": new Response("gone", {
        status: 404,
        headers: { "content-type": "text/html" },
      }),
    });
    const home = result.pages.find((p) => p.url === "https://mojweb.sk/")!;
    expect(home.imagesWithoutAlt).toBe(2);
    expect(home.findings.some((f) => f.code === "IMAGE_ALT_MISSING")).toBe(true);
    const brokenPage = result.pages.find((p) => p.url === "https://mojweb.sk/chyba");
    expect(brokenPage?.status).toBe(404);
    expect(home.brokenInternalLinks).toContain("https://mojweb.sk/chyba");
    expect(home.findings.some((f) => f.code === "BROKEN_INTERNAL_LINK")).toBe(true);
    expect(home.findings.find((f) => f.code === "BROKEN_INTERNAL_LINK")?.severity).toBe("critical");
  });

  it("aborts the body download at maxBytes and ignores content past the cap", async () => {
    const chunk = new TextEncoder().encode("A".repeat(1_000));
    const head = new TextEncoder().encode(
      "<!DOCTYPE html><html><head><meta charset=utf-8></head><body><h1>SEO</h1>",
    );
    let pulled = 0;
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (pulled === 0) controller.enqueue(head);
        else if (pulled < 200) controller.enqueue(chunk);
        else {
          // The title sits far past the 3 000 byte cap.
          controller.enqueue(new TextEncoder().encode("<title>Neskorý title tag je tu</title>"));
          controller.close();
        }
        pulled += 1;
      },
      cancel() {
        cancelled = true;
      },
    });
    const result = await crawl(
      "https://mojweb.sk/",
      {
        "https://mojweb.sk/robots.txt": ok("User-agent: *\nAllow: /\n", "text/plain"),
        "https://mojweb.sk/sitemap.xml": ok("no", "text/html", 404),
        "https://mojweb.sk/sitemap_index.xml": ok("no", "text/html", 404),
        "https://mojweb.sk/": () =>
          new Response(stream, { status: 200, headers: { "content-type": "text/html" } }),
      },
      { maxBytes: 3_000 },
    );
    expect(result.crawledCount).toBe(1);
    const page = result.pages[0]!;
    expect(page.status).toBe(200);
    // The title after the cap was never read, so it must be reported missing.
    expect(page.title).toBe("");
    expect(page.findings.some((f) => f.code === "TITLE_MISSING")).toBe(true);
    // The reader stopped early (a handful of pulls, not all 200) and cancelled the stream.
    expect(pulled).toBeLessThanOrEqual(6);
    expect(cancelled).toBe(true);
  });
});

const robotsOk = ok("User-agent: *\nAllow: /\n", "text/plain");
const noSitemaps = {
  "https://mojweb.sk/sitemap.xml": () => ok("no", "text/html", 404),
  "https://mojweb.sk/sitemap_index.xml": () => ok("no", "text/html", 404),
};

function fetchedUrls(fetchFn: typeof fetch): string[] {
  return (fetchFn as unknown as { mock: { calls: unknown[][] } }).mock.calls.map((c) =>
    String(c[0]),
  );
}

describe("review fixes: sitemap index host and SSRF filtering (P2-1)", () => {
  it("does not fetch nested sitemaps on a foreign host, a private IP or a bad scheme", async () => {
    const fetchFn = mockFetch({
      "https://mojweb.sk/robots.txt": robotsOk,
      "https://mojweb.sk/sitemap.xml": ok(
        xmlIndex([
          "https://victim.example.com/api/delete?id=1",
          "http://10.0.0.5/sitemap.xml",
          "http://[::ffff:127.0.0.1]/sitemap.xml",
          "ftp://mojweb.sk/sitemap.xml",
          "https://mojweb.sk/sitemap-pages.xml",
        ]),
        "application/xml",
      ),
      "https://mojweb.sk/sitemap-pages.xml": ok(
        xmlSitemap(["https://mojweb.sk/o-nas"]),
        "application/xml",
      ),
      "https://mojweb.sk/": ok(html()),
      "https://mojweb.sk/o-nas": ok(html()),
    });
    const result = await crawlSite("https://mojweb.sk/", {
      fetchFn,
      resolver: publicResolver,
      timeoutMs: 5_000,
    });
    const urls = fetchedUrls(fetchFn);
    expect(urls.some((u) => u.includes("victim.example.com"))).toBe(false);
    expect(urls.some((u) => u.includes("10.0.0.5"))).toBe(false);
    expect(urls.some((u) => u.includes("127.0.0.1"))).toBe(false);
    expect(urls.some((u) => u.startsWith("ftp:"))).toBe(false);
    expect(urls).toContain("https://mojweb.sk/sitemap-pages.xml");
    expect(result.pages.map((p) => p.url)).toContain("https://mojweb.sk/o-nas");
  });

  it("does not queue a sitemap loc that points to an internal IP inside a urlset", async () => {
    const fetchFn = mockFetch({
      "https://mojweb.sk/robots.txt": robotsOk,
      "https://mojweb.sk/sitemap.xml": ok(
        xmlSitemap(["http://169.254.169.254/latest/meta-data", "https://other.example.org/x"]),
        "application/xml",
      ),
      "https://mojweb.sk/": ok(html()),
    });
    await crawlSite("https://mojweb.sk/", { fetchFn, resolver: publicResolver, timeoutMs: 5_000 });
    const urls = fetchedUrls(fetchFn);
    expect(urls.some((u) => u.includes("169.254.169.254"))).toBe(false);
    expect(urls.some((u) => u.includes("other.example.org"))).toBe(false);
  });
});

describe("review fixes: more SSRF cases (P3-7)", () => {
  it("sends no request when the host resolves to a private IP via DNS", async () => {
    const fetchFn = vi.fn(async () => ok(html())) as unknown as typeof fetch;
    const result = await crawlSite("https://mojweb.sk/", {
      fetchFn,
      resolver: { resolve: async () => ["10.0.0.5"] },
      timeoutMs: 2_000,
    });
    expect(fetchFn).not.toHaveBeenCalled();
    expect(result.stepStates).toContain("BLOCKED: SSRF");
    expect(result.crawledCount).toBe(0);
  });

  it("blocks a redirect to an IPv4-mapped IPv6 loopback address", async () => {
    for (const target of ["http://[::ffff:127.0.0.1]/x", "http://[::ffff:7f00:1]/x"]) {
      const fetchFn = mockFetch({
        "https://mojweb.sk/robots.txt": robotsOk,
        ...noSitemaps,
        "https://mojweb.sk/": () => redirect(target),
      });
      const result = await crawlSite("https://mojweb.sk/", {
        fetchFn,
        resolver: publicResolver,
        timeoutMs: 5_000,
      });
      expect(result.stepStates, target).toContain("BLOCKED: SSRF");
      expect(fetchedUrls(fetchFn).some((u) => u.includes("127.0.0.1") || u.includes("7f00"))).toBe(
        false,
      );
    }
  });

  it("blocks a redirect to the cloud metadata address", async () => {
    const fetchFn = mockFetch({
      "https://mojweb.sk/robots.txt": robotsOk,
      ...noSitemaps,
      "https://mojweb.sk/": () => redirect("http://169.254.169.254/latest/meta-data"),
    });
    const result = await crawlSite("https://mojweb.sk/", {
      fetchFn,
      resolver: publicResolver,
      timeoutMs: 5_000,
    });
    expect(result.stepStates).toContain("BLOCKED: SSRF");
    expect(fetchedUrls(fetchFn).some((u) => u.includes("169.254.169.254"))).toBe(false);
  });

  it("does not follow internal links with userinfo, ports or private hosts", async () => {
    const fetchFn = mockFetch({
      "https://mojweb.sk/robots.txt": robotsOk,
      ...noSitemaps,
      "https://mojweb.sk/": ok(
        html({
          extras:
            '<a href="http://u:p@mojweb.sk/x">a</a><a href="http://10.0.0.1/">b</a><a href="https://mojweb.sk:8080/c">c</a><a href="/ok">ok</a>',
        }),
      ),
      "https://mojweb.sk/ok": ok(html()),
    });
    await crawlSite("https://mojweb.sk/", { fetchFn, resolver: publicResolver, timeoutMs: 5_000 });
    const urls = fetchedUrls(fetchFn);
    expect(urls.some((u) => u.includes("10.0.0.1"))).toBe(false);
    expect(urls.some((u) => u.includes("u:p@"))).toBe(false);
    expect(urls.some((u) => u.includes(":8080"))).toBe(false);
    expect(urls).toContain("https://mojweb.sk/ok");
  });

  it("does not report the DoH endpoint as the URL of a failed lookup", async () => {
    const result = await crawlSite("https://mojweb.sk/", {
      // No resolver: the default DoH resolver uses this fetch, which answers 404.
      fetchFn: mockFetch({}),
      timeoutMs: 2_000,
    });
    expect(result.stepStates).toContain("BLOCKED: SSRF");
    for (const f of result.findings) expect(f.url).not.toContain("cloudflare-dns.com");
  });
});

describe("review fixes: robots.txt availability and grouping (P3-1, P3-2, P3-3)", () => {
  it("treats robots.txt 5xx as complete disallow and fetches no page", async () => {
    for (const status of [500, 503]) {
      const fetchFn = mockFetch({
        "https://mojweb.sk/robots.txt": ok("down", "text/plain", status),
        "https://mojweb.sk/": ok(html()),
      });
      const result = await crawlSite("https://mojweb.sk/", {
        fetchFn,
        resolver: publicResolver,
        timeoutMs: 5_000,
      });
      expect(result.stepStates, String(status)).toContain("BLOCKED: ROBOTS");
      expect(result.crawledCount).toBe(0);
      expect(result.findings.some((f) => f.code === "ROBOTS_UNAVAILABLE")).toBe(true);
      expect(fetchedUrls(fetchFn)).toEqual(["https://mojweb.sk/robots.txt"]);
    }
  });

  it("treats a robots.txt network error as complete disallow", async () => {
    const fetchFn = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).endsWith("/robots.txt")) throw new TypeError("network down");
      return ok(html());
    }) as unknown as typeof fetch;
    const result = await crawlSite("https://mojweb.sk/", {
      fetchFn,
      resolver: publicResolver,
      timeoutMs: 5_000,
    });
    expect(result.stepStates).toContain("BLOCKED: ROBOTS");
    expect(result.crawledCount).toBe(0);
  });

  it("still allows crawling when robots.txt is 404", async () => {
    const result = await crawl("https://mojweb.sk/", {
      "https://mojweb.sk/robots.txt": ok("nope", "text/plain", 404),
      ...noSitemaps,
      "https://mojweb.sk/": ok(html()),
    });
    expect(result.stepStates).not.toContain("BLOCKED: ROBOTS");
    expect(result.crawledCount).toBe(1);
  });

  it("starts a new group at User-agent after a rule, even without a blank line", () => {
    const robots = parseRobotsTxt("User-agent: *\nAllow: /\nUser-agent: SEO4WEBBot\nDisallow: /\n");
    expect(robots.groups).toHaveLength(2);
    expect(isPathAllowed(robots, "/x", "SEO4WEBBot")).toBe(false);
    expect(isPathAllowed(robots, "/x", "OtherBot")).toBe(true);
  });

  it("keeps consecutive User-agent lines in one group even across blank lines", () => {
    const robots = parseRobotsTxt("User-agent: OtherBot\n\nUser-agent: SEO4WEBBot\nDisallow: /\n");
    expect(robots.groups).toHaveLength(1);
    expect(isPathAllowed(robots, "/x", "SEO4WEBBot")).toBe(false);
  });

  it("matches the product token, ignoring a version suffix on either side", () => {
    const robots = parseRobotsTxt("User-agent: SEO4WEBBot/1.0\nDisallow: /\n");
    expect(isPathAllowed(robots, "/x", "SEO4WEBBot")).toBe(false);
    expect(isPathAllowed(robots, "/x", "SEO4WEBBot/2.0")).toBe(false);
    expect(isPathAllowed(robots, "/x", "OtherBot")).toBe(true);
  });
});

describe("review fixes: robots wildcard matcher (P2-2)", () => {
  it("supports * and $ per RFC 9309", () => {
    expect(robotsPatternMatches("/private", "/private/a")).toBe(true);
    expect(robotsPatternMatches("/private", "/pub")).toBe(false);
    expect(robotsPatternMatches("/*.pdf$", "/a/b.pdf")).toBe(true);
    expect(robotsPatternMatches("/*.pdf$", "/a/b.pdf?x=1")).toBe(false);
    expect(robotsPatternMatches("/a*b*c", "/a-b-c-d")).toBe(true);
    expect(robotsPatternMatches("/a*b*c", "/a-c-b")).toBe(false);
    expect(robotsPatternMatches("/fish$", "/fish")).toBe(true);
    expect(robotsPatternMatches("/fish$", "/fish/")).toBe(false);
    expect(robotsPatternMatches("/*", "/anything")).toBe(true);
    expect(robotsPatternMatches("/a*$", "/abc")).toBe(true);
    expect(robotsPatternMatches("/a.b+c", "/a.b+c")).toBe(true);
    expect(robotsPatternMatches("/a.b", "/axb")).toBe(false);
  });

  it("applies the longest matching rule, Allow winning ties", () => {
    const robots = parseRobotsTxt("User-agent: *\nDisallow: /*.pdf$\nAllow: /public/*.pdf$\n");
    expect(isPathAllowed(robots, "/x/a.pdf", "Bot")).toBe(false);
    expect(isPathAllowed(robots, "/public/a.pdf", "Bot")).toBe(true);
  });
});

describe("review fixes: ReDoS inputs finish quickly (P2-2)", () => {
  // Generous upper bounds: they only catch blow-ups (seconds), never normal speed.
  const BUDGET_MS = 5_000;

  function timed<T>(fn: () => T): { value: T; ms: number } {
    const t = performance.now();
    const value = fn();
    return { value, ms: performance.now() - t };
  }

  it("pathological robots patterns do not backtrack", () => {
    const pattern = `/${"*a".repeat(8)} b`;
    const path = `/${"a".repeat(2_000)}`;
    const { value, ms } = timed(() => robotsPatternMatches(pattern, path));
    expect(value).toBe(false);
    expect(ms).toBeLessThan(BUDGET_MS);

    const robots = parseRobotsTxt(`User-agent: *\nDisallow: ${pattern}\n`);
    const parsed = timed(() => isPathAllowed(robots, path, "SEO4WEBBot"));
    expect(parsed.value).toBe(true);
    expect(parsed.ms).toBeLessThan(BUDGET_MS);
  });

  it("caps robots.txt rule count and pattern length", () => {
    const many = Array.from({ length: 8_000 }, (_, i) => `Disallow: /p${i}`).join("\n");
    const robots = parseRobotsTxt(`User-agent: *\n${many}\nDisallow: /${"a".repeat(5_000)}\n`);
    expect(robots.truncated).toBe(true);
    expect(robots.groups[0]!.rules.length).toBeLessThanOrEqual(MAX_ROBOTS_RULES);
    expect(robots.groups[0]!.rules.every((r) => r.pattern.length <= 512)).toBe(true);
  });

  it("sitemap <loc> parsing is linear on whitespace and unterminated input", () => {
    const inputs = [
      `<urlset><loc>a${" ".repeat(1_000_000)}`,
      `<urlset>${"<loc>".repeat(100_000)}`,
      `<urlset>${"<loc ".repeat(100_000)}`,
      `<urlset><loc>${"<".repeat(500_000)}</loc>`,
    ];
    for (const xml of inputs) {
      const { ms } = timed(() => parseSitemapLocs(xml));
      expect(ms).toBeLessThan(BUDGET_MS);
    }
  });

  it(
    "HTML extraction is linear on unterminated and nested tag soup",
    { timeout: PERF_TEST_TIMEOUT_MS },
    async () => {
      const inputs = [
        "<meta ".repeat(150_000),
        "<a <link <img ".repeat(60_000),
        `<meta name="description" content="${"x".repeat(900_000)}`,
        `<title>${"<".repeat(900_000)}`,
        `<script type="application/ld+json">${"{".repeat(900_000)}`,
        `<meta ${'a="'.repeat(200_000)}`,
        "<h1 ".repeat(200_000),
      ];
      for (const [i, body] of inputs.entries()) {
        const t = performance.now();
        const result = await crawl("https://mojweb.sk/", {
          "https://mojweb.sk/robots.txt": robotsOk,
          ...noSitemaps,
          "https://mojweb.sk/": ok(body),
        });
        const ms = performance.now() - t;
        expect(result.crawledCount, `input ${i}`).toBe(1);
        expect(ms, `input ${i}`).toBeLessThan(10_000);
      }
    },
  );
});

describe("review fixes: offsite redirect (P3-4)", () => {
  it("records REDIRECT_OFFSITE and does not audit the foreign host's content", async () => {
    const result = await crawl("https://mojweb.sk/", {
      "https://mojweb.sk/robots.txt": robotsOk,
      ...noSitemaps,
      "https://mojweb.sk/": () => redirect("https://iny-host.example.org/"),
      "https://iny-host.example.org/": ok(html({ title: "Cudzí obsah ktorý nepatrí sem" })),
    });
    const page = result.pages[0]!;
    expect(page.findings.some((f) => f.code === "REDIRECT_OFFSITE")).toBe(true);
    expect(page.title).toBe("");
    expect(result.findings.find((f) => f.code === "REDIRECT_OFFSITE")?.severity).toBe("warning");
  });
});

describe("review fixes: crawlSiteFn rate and concurrency limits (P2-3)", () => {
  const fakeResult: CrawlResult = {
    startUrl: "https://mojweb.sk/",
    host: "mojweb.sk",
    pages: [],
    findings: [],
    stepStates: [],
    crawledCount: 0,
    discoveredCount: 0,
    robotsFilteredCount: 0,
    robotsFilteredCountIsLowerBound: false,
  };

  it("rejects the call after the per-user rate limit is used up", async () => {
    const crawlFn = vi.fn(async () => fakeResult) as unknown as typeof crawlSite;
    const user = `rate-user-${Math.random()}`;
    for (let i = 0; i < CRAWL_RATE_LIMIT.limit; i++) {
      await runCrawlForUser(user, { url: "https://mojweb.sk/" }, crawlFn);
    }
    await expect(runCrawlForUser(user, { url: "https://mojweb.sk/" }, crawlFn)).rejects.toThrow(
      /Príliš veľa požiadaviek/,
    );
    expect(crawlFn).toHaveBeenCalledTimes(CRAWL_RATE_LIMIT.limit);
    // Another user is unaffected.
    await runCrawlForUser(`other-${user}`, { url: "https://mojweb.sk/" }, crawlFn);
  });

  it("allows only one concurrent crawl per user and frees the slot afterwards", async () => {
    const user = `conc-user-${Math.random()}`;
    let finish!: (r: CrawlResult) => void;
    const crawlFn = vi.fn(
      () => new Promise<CrawlResult>((resolve) => (finish = resolve)),
    ) as unknown as typeof crawlSite;
    const first = runCrawlForUser(user, { url: "https://mojweb.sk/" }, crawlFn);
    await expect(runCrawlForUser(user, { url: "https://mojweb.sk/" }, crawlFn)).rejects.toThrow(
      /Crawl už beží/,
    );
    finish(fakeResult);
    await first;
    const second = runCrawlForUser(user, { url: "https://mojweb.sk/" }, crawlFn);
    finish(fakeResult);
    await second;
  });

  it("releases the slot when the crawl throws, and caps global concurrency", async () => {
    const user = `err-user-${Math.random()}`;
    const failing = vi.fn(async () => {
      throw new Error("boom");
    }) as unknown as typeof crawlSite;
    await expect(runCrawlForUser(user, { url: "https://mojweb.sk/" }, failing)).rejects.toThrow(
      "boom",
    );
    const release = acquireCrawlSlot(user);
    expect(release).not.toBeNull();
    release!();
    release!(); // idempotent

    const held = ["g1", "g2", "g3", "g4"].map((u) => acquireCrawlSlot(`${user}-${u}`));
    expect(held.every((r) => r !== null)).toBe(true);
    expect(acquireCrawlSlot(`${user}-g5`)).toBeNull();
    for (const r of held) r!();
    const again = acquireCrawlSlot(`${user}-g5`);
    expect(again).not.toBeNull();
    again!();
  });
});

describe("review fixes round 2: link and frontier caps (P2-A)", () => {
  it(
    "keeps a 1 MB page with 60k links and 1000 robots rules fast and bounded",
    { timeout: PERF_TEST_TIMEOUT_MS },
    async () => {
      const rules = Array.from({ length: 1_000 }, () => "Disallow: /*a*a*a*a*b").join("\n");
      const links = Array.from({ length: 60_000 }, (_, i) => `<a href="/p${i}">x</a>`).join("");
      const t = performance.now();
      const result = await crawl(
        "https://mojweb.sk/",
        {
          "https://mojweb.sk/robots.txt": ok(`User-agent: *\n${rules}\n`, "text/plain"),
          ...noSitemaps,
          "https://mojweb.sk/": ok(
            `<html><head><title>Veľa odkazov na stránke</title></head><body>${links}</body></html>`,
          ),
        },
        { maxBytes: 1_000_000, pageLimit: 3 },
      );
      const ms = performance.now() - t;
      expect(ms).toBeLessThan(10_000);
      expect(result.discoveredCount).toBeLessThanOrEqual(MAX_QUEUED_URLS);
      expect(result.pages[0]!.internalLinks.length).toBeLessThanOrEqual(MAX_RESULT_LINKS_PER_PAGE);
      expect(result.stepStates).toContain("PARTIAL_CRAWL");
    },
  );

  it("caps the frontier at MAX_QUEUED_URLS", async () => {
    const fetchFn = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/robots.txt")) return robotsOk.clone();
      if (url.includes("sitemap")) return ok("no", "text/html", 404);
      const base = new URL(url).pathname.replace(/\W/g, "") || "h";
      const links = Array.from({ length: 500 }, (_, i) => `<a href="/${base}-${i}">x</a>`).join("");
      return ok(html({ extras: links }));
    }) as unknown as typeof fetch;
    const result = await crawlSite("https://mojweb.sk/", {
      fetchFn,
      resolver: publicResolver,
      timeoutMs: 5_000,
      pageLimit: 10,
    });
    expect(result.discoveredCount).toBe(MAX_QUEUED_URLS);
    expect(result.stepStates).toContain("PARTIAL_CRAWL");
  });

  it("checks robots when a URL is dequeued, so disallowed links are never fetched", async () => {
    const fetchFn = mockFetch({
      "https://mojweb.sk/robots.txt": ok("User-agent: *\nDisallow: /tajne\n", "text/plain"),
      ...noSitemaps,
      "https://mojweb.sk/": ok(
        html({ extras: '<a href="/tajne/a">a</a><a href="/verejne">b</a>' }),
      ),
      "https://mojweb.sk/verejne": ok(html()),
    });
    await crawlSite("https://mojweb.sk/", { fetchFn, resolver: publicResolver, timeoutMs: 5_000 });
    const urls = fetchedUrls(fetchFn);
    expect(urls.some((u) => u.includes("/tajne"))).toBe(false);
    expect(urls).toContain("https://mojweb.sk/verejne");
  });
});

describe("review fixes round 2: redirects never reach foreign hosts (P2-B)", () => {
  it("sends 0 requests to a foreign host when pages redirect there", async () => {
    const links = Array.from({ length: 30 }, (_, i) => `<a href="/r${i}">r</a>`).join("");
    const routes: Record<string, Response | MockHandler> = {
      "https://mojweb.sk/robots.txt": robotsOk,
      "https://mojweb.sk/sitemap.xml": () => redirect("https://victim.example.com/api/x?s=1"),
      "https://mojweb.sk/sitemap_index.xml": () => redirect("https://victim.example.com/api/x?s=2"),
      "https://mojweb.sk/": ok(html({ extras: links })),
    };
    for (let i = 0; i < 30; i++) {
      routes[`https://mojweb.sk/r${i}`] = () => redirect(`https://victim.example.com/api/x?i=${i}`);
    }
    const fetchFn = mockFetch(routes);
    const result = await crawlSite("https://mojweb.sk/", {
      fetchFn,
      resolver: publicResolver,
      timeoutMs: 5_000,
      pageLimit: 25,
    });
    expect(fetchedUrls(fetchFn).filter((u) => u.includes("victim.example.com"))).toHaveLength(0);
    expect(result.findings.some((f) => f.code === "REDIRECT_OFFSITE")).toBe(true);
  });

  it("still follows same-host redirects (http->https, path moves)", async () => {
    const result = await crawl("https://mojweb.sk/", {
      "https://mojweb.sk/robots.txt": robotsOk,
      ...noSitemaps,
      "https://mojweb.sk/": ok(html({ extras: '<a href="/stare">s</a>' })),
      "https://mojweb.sk/stare": () => redirect("https://mojweb.sk/nove", 301),
      "https://mojweb.sk/nove": ok(html()),
    });
    expect(result.pages.map((p) => p.url)).toContain("https://mojweb.sk/nove");
    expect(result.findings.some((f) => f.code === "REDIRECT_OFFSITE")).toBe(false);
  });
});

describe("review fixes round 2: apex <-> www seed (P2-C)", () => {
  const wwwRoutes = (extra: Record<string, Response | MockHandler> = {}) => ({
    "https://www.mojweb.sk/robots.txt": ok(
      "User-agent: *\nAllow: /\nSitemap: https://www.mojweb.sk/sitemap.xml\n",
      "text/plain",
    ),
    "https://www.mojweb.sk/sitemap.xml": ok(
      xmlSitemap(["https://www.mojweb.sk/", "https://www.mojweb.sk/o-nas"]),
      "application/xml",
    ),
    "https://www.mojweb.sk/": ok(html()),
    "https://www.mojweb.sk/o-nas": ok(html()),
    ...extra,
  });

  it("accepts apex -> www (robots.txt also redirected) as the new start host", async () => {
    const result = await crawl("https://mojweb.sk/", {
      "https://mojweb.sk/robots.txt": () => redirect("https://www.mojweb.sk/robots.txt", 301),
      ...wwwRoutes(),
    });
    expect(result.host).toBe("www.mojweb.sk");
    expect(result.startUrl).toBe("https://www.mojweb.sk/");
    expect(result.crawledCount).toBeGreaterThanOrEqual(2);
    expect(result.stepStates).not.toContain("NO_SITEMAP");
    expect(result.findings.some((f) => f.code === "REDIRECT_OFFSITE")).toBe(false);
    expect(result.findings.some((f) => f.code === "SEED_HOST_CHANGED")).toBe(true);
  });

  it("accepts apex -> www when only the seed page redirects", async () => {
    const result = await crawl("https://mojweb.sk/", {
      "https://mojweb.sk/robots.txt": ok("nope", "text/plain", 404),
      ...noSitemaps,
      "https://mojweb.sk/": () => redirect("https://www.mojweb.sk/", 301),
      ...wwwRoutes(),
    });
    expect(result.host).toBe("www.mojweb.sk");
    expect(result.crawledCount).toBeGreaterThanOrEqual(2);
    expect(result.findings.some((f) => f.code === "REDIRECT_OFFSITE")).toBe(false);
  });

  it("accepts www -> apex too, but only once (no redirect loop)", async () => {
    const fetchFn = mockFetch({
      "https://www.mojweb.sk/robots.txt": () => redirect("https://mojweb.sk/robots.txt", 301),
      "https://mojweb.sk/robots.txt": () => redirect("https://www.mojweb.sk/robots.txt", 301),
    });
    const result = await crawlSite("https://www.mojweb.sk/", {
      fetchFn,
      resolver: publicResolver,
      timeoutMs: 5_000,
    });
    expect(result).toBeDefined();
    expect(fetchedUrls(fetchFn).length).toBeLessThan(40);
  });

  it("keeps other offsite redirects as REDIRECT_OFFSITE", async () => {
    const result = await crawl("https://mojweb.sk/", {
      "https://mojweb.sk/robots.txt": robotsOk,
      ...noSitemaps,
      "https://mojweb.sk/": () => redirect("https://mojweb.example.org/"),
      "https://mojweb.example.org/": ok(html()),
    });
    expect(result.host).toBe("mojweb.sk");
    expect(result.findings.some((f) => f.code === "REDIRECT_OFFSITE")).toBe(true);
    expect(result.findings.some((f) => f.code === "SEED_HOST_CHANGED")).toBe(false);
  });
});

describe("review fixes round 2: robots caps fail closed, 429, percent-encoding (P3)", () => {
  async function blockedBy(robotsBody: string | Response) {
    const result = await crawl("https://mojweb.sk/", {
      "https://mojweb.sk/robots.txt":
        typeof robotsBody === "string" ? ok(robotsBody, "text/plain") : robotsBody,
      "https://mojweb.sk/": ok(html()),
    });
    return result;
  }

  it("blocks when robots.txt has more rules than the cap", async () => {
    const rules = Array.from({ length: 6_000 }, (_, i) => `Disallow: /p${i}`).join("\n");
    const result = await blockedBy(`User-agent: *\n${rules}\n`);
    expect(result.stepStates).toContain("BLOCKED: ROBOTS");
    expect(result.findings.some((f) => f.code === "ROBOTS_TOO_LARGE")).toBe(true);
    expect(result.crawledCount).toBe(0);
  });

  it("blocks when a pattern is longer than the cap or the file is oversized", async () => {
    expect(parseRobotsTxt(`User-agent: *\nDisallow: /${"a".repeat(600)}\n`).truncated).toBe(true);
    expect(parseRobotsTxt(`User-agent: *\n${"#".repeat(600_000)}\n`).truncated).toBe(true);
    expect(parseRobotsTxt("User-agent: *\nDisallow: /x\n").truncated).toBe(false);
    const robots = parseRobotsTxt(`User-agent: *\nDisallow: /${"a".repeat(600)}\n`);
    expect(isPathAllowed(robots, "/ok", "SEO4WEBBot")).toBe(false);
  });

  it("denies paths longer than the matcher cap", () => {
    const robots = parseRobotsTxt("User-agent: *\nDisallow: /*.pdf$\n");
    expect(isPathAllowed(robots, `/${"a".repeat(3_000)}.pdf`, "SEO4WEBBot")).toBe(false);
    expect(isPathAllowed(robots, "/a.html", "SEO4WEBBot")).toBe(true);
  });

  it("treats robots.txt 429 like 5xx (full disallow)", async () => {
    const result = await blockedBy(ok("slow down", "text/plain", 429));
    expect(result.stepStates).toContain("BLOCKED: ROBOTS");
    expect(result.crawledCount).toBe(0);
  });

  it("normalizes percent-encoding on both sides (RFC 9309 2.2.2)", () => {
    expect(robotsPatternMatches("/%7Euser", "/~user")).toBe(true);
    expect(robotsPatternMatches("/~user", "/%7euser")).toBe(true);
    expect(robotsPatternMatches("/%e2%82%ac", "/%E2%82%AC")).toBe(true);
    expect(robotsPatternMatches("/€", "/%E2%82%AC")).toBe(true);
    expect(robotsPatternMatches("/a%2Fb", "/a/b")).toBe(false);
  });
});

describe("review fixes round 2: body without stream (P3-a)", () => {
  it("never calls res.text() on a streamless response", async () => {
    const res = new Response(null, { status: 200, headers: { "content-type": "text/html" } });
    const text = vi.fn(async () => "<title>x</title>");
    (res as unknown as { text: typeof text }).text = text;
    const result = await crawl("https://mojweb.sk/", {
      "https://mojweb.sk/robots.txt": robotsOk,
      ...noSitemaps,
      "https://mojweb.sk/": () => res,
    });
    expect(text).not.toHaveBeenCalled();
    expect(result.pages[0]!.findings.some((f) => f.code === "TITLE_MISSING")).toBe(true);
  });
});

describe("review fixes round 2: concurrency messages and rate token (P3-e)", () => {
  const fake: CrawlResult = {
    startUrl: "https://mojweb.sk/",
    host: "mojweb.sk",
    pages: [],
    findings: [],
    stepStates: [],
    crawledCount: 0,
    discoveredCount: 0,
    robotsFilteredCount: 0,
    robotsFilteredCountIsLowerBound: false,
  };

  it("refused concurrent attempts do not burn rate-limit tokens", async () => {
    const user = `tok-user-${Math.random()}`;
    let finish!: (r: CrawlResult) => void;
    const slow = vi.fn(
      () => new Promise<CrawlResult>((r) => (finish = r)),
    ) as unknown as typeof crawlSite;
    const first = runCrawlForUser(user, { url: "https://mojweb.sk/" }, slow);
    for (let i = 0; i < 5; i++) {
      await expect(runCrawlForUser(user, { url: "https://mojweb.sk/" }, slow)).rejects.toThrow(
        "Crawl už beží",
      );
    }
    finish(fake);
    await first;
    const quick = vi.fn(async () => fake) as unknown as typeof crawlSite;
    // 1 token used so far; the remaining ones must still be available.
    for (let i = 0; i < CRAWL_RATE_LIMIT.limit - 1; i++) {
      await runCrawlForUser(user, { url: "https://mojweb.sk/" }, quick);
    }
    await expect(runCrawlForUser(user, { url: "https://mojweb.sk/" }, quick)).rejects.toThrow(
      /Príliš veľa požiadaviek/,
    );
  });

  it("uses a different message when the global capacity is full", async () => {
    const user = `glob-user-${Math.random()}`;
    const held = ["a", "b", "c", "d"].map((x) => acquireCrawlSlot(`${user}-${x}`));
    const quick = vi.fn(async () => fake) as unknown as typeof crawlSite;
    await expect(runCrawlForUser(user, { url: "https://mojweb.sk/" }, quick)).rejects.toThrow(
      "Server je vyťažený",
    );
    for (const r of held) r!();
  });
});

describe("review fixes round 3: robots caps per applicable group (P3-i)", () => {
  const bigOther = Array.from({ length: 6_000 }, (_, i) => `Disallow: /other/${i}`).join("\n");

  it("does not count rules of other user-agent groups against the cap", async () => {
    const robots = `User-agent: Googlebot\n${bigOther}\n\nUser-agent: AhrefsBot\nDisallow: /\n\nUser-agent: *\nDisallow: /admin\n`;
    const parsed = parseRobotsTxt(robots);
    expect(parsed.truncated).toBe(false);
    const result = await crawl("https://mojweb.sk/", {
      "https://mojweb.sk/robots.txt": ok(robots, "text/plain"),
      ...noSitemaps,
      "https://mojweb.sk/": ok(html()),
    });
    expect(result.stepStates).not.toContain("BLOCKED: ROBOTS");
    expect(result.crawledCount).toBe(1);
    // Rules of groups that do not apply to us are dropped at parse time.
    expect(parsed.groups.flatMap((g) => g.rules)).toHaveLength(1);
  });

  it("still fails closed when our own group exceeds the cap", () => {
    expect(parseRobotsTxt(`User-agent: SEO4WEBBot\n${bigOther}\n`).truncated).toBe(true);
    expect(
      parseRobotsTxt(`User-agent: Googlebot\nUser-agent: SEO4WEBBot\n${bigOther}\n`).truncated,
    ).toBe(true);
  });

  it("caps the summed pattern length of applicable rules, not of other groups", () => {
    const heavy = Array.from({ length: 200 }, (_, i) => `Disallow: /${i}${"a".repeat(480)}`).join(
      "\n",
    );
    expect(parseRobotsTxt(`User-agent: *\n${heavy}\n`).truncated).toBe(true);
    expect(parseRobotsTxt(`User-agent: Googlebot\n${heavy}\n`).truncated).toBe(false);
  });

  it("ignores over-long patterns in other groups but not in ours", () => {
    const long = `Disallow: /${"a".repeat(600)}`;
    expect(parseRobotsTxt(`User-agent: Googlebot\n${long}\n`).truncated).toBe(false);
    expect(parseRobotsTxt(`User-agent: *\n${long}\n`).truncated).toBe(true);
  });
});

describe("review fixes round 3+4: robots-disallowed frontier (P2-A', P2-A'')", () => {
  /** Routes for a crawl whose sitemap lists `count` long URLs that robots disallows. */
  function frontierRoutes(robots: string, count: number, prefix = "/z/") {
    const tail = "a".repeat(900);
    const urls = Array.from({ length: count }, (_, i) => `https://mojweb.sk${prefix}${i}/${tail}`);
    return {
      "https://mojweb.sk/robots.txt": ok(robots, "text/plain"),
      "https://mojweb.sk/sitemap.xml": ok(xmlSitemap(urls), "application/xml"),
      "https://mojweb.sk/sitemap_index.xml": ok("no", "text/html", 404),
      "https://mojweb.sk/": ok(html()),
    } as Record<string, Response | MockHandler>;
  }

  const rulesOf = (n: number, shape: (i: number) => string) =>
    Array.from({ length: n }, (_, i) => `Disallow: ${shape(i)}`).join("\n");

  // Shapes with 1000 applicable rules (ASCII, Slovak diacritics, percent-encoded)
  // plus a rule that really disallows the frontier.
  const shapes: Array<[string, (i: number) => string]> = [
    ["ASCII wildcard rules", (i) => `/*a*a*a*a*a*b${i}`],
    ["Slovak diacritics prefix rules", (i) => `/ľščťžýáíé-${i}-xyz`],
    ["Slovak diacritics wildcard rules", (i) => `/*ž*š*č*ť*ľ*ž*b${i}`],
    ["percent-encoded rules", (i) => `/%C4%BE%C5%A1%C4%8D-${i}-*%C5%BE*b`],
  ];

  for (const [name, shape] of shapes) {
    it(
      `1000 disallowed URLs + 1000 ${name} are all filtered (deterministic clock)`,
      { timeout: PERF_TEST_TIMEOUT_MS },
      async () => {
        const robots = `User-agent: *\n${rulesOf(1_000, shape)}\nDisallow: /z\n`;
        expect(parseRobotsTxt(robots).truncated).toBe(false);
        const routes = frontierRoutes(robots, 1_000);
        const fetchFn = mockFetch(routes);
        const t = performance.now();
        const result = await crawlSite("https://mojweb.sk/", {
          fetchFn,
          resolver: publicResolver,
          timeoutMs: 30_000,
          pageLimit: 5,
          // Fake clock: the matching budget cannot run out on a slow machine.
          now: () => 0,
        });
        const ms = performance.now() - t;
        expect(ms).toBeLessThan(10_000);
        expect(result.crawledCount).toBe(1);
        // Disallowed URLs are filtered at enqueue: counted, never queued or fetched.
        expect(result.robotsFilteredCount).toBe(1_000);
        expect(result.robotsFilteredCountIsLowerBound).toBe(false);
        expect(result.discoveredCount).toBe(1);
        expect(fetchedUrls(fetchFn).some((u) => u.includes("/z/"))).toBe(false);
      },
    );
  }

  it("filters disallowed URLs at enqueue: no skips, no PARTIAL_CRAWL, nothing fetched", async () => {
    const fetchFn = mockFetch(frontierRoutes("User-agent: *\nDisallow: /z\n", 600));
    const result = await crawlSite("https://mojweb.sk/", {
      fetchFn,
      resolver: publicResolver,
      timeoutMs: 30_000,
      pageLimit: 5,
      now: () => 0,
    });
    expect(result.stepStates).not.toContain("PARTIAL_CRAWL");
    expect(result.findings.some((f) => f.code === "ROBOTS_SKIP_LIMIT")).toBe(false);
    expect(result.robotsFilteredCount).toBe(600);
    expect(fetchedUrls(fetchFn).some((u) => u.includes("/z/"))).toBe(false);
    expect(MAX_ROBOTS_SKIPS).toBeLessThanOrEqual(200);
  });

  it("does not stop for a few disallowed URLs", async () => {
    const result = await crawl("https://mojweb.sk/", {
      "https://mojweb.sk/robots.txt": ok("User-agent: *\nDisallow: /tajne\n", "text/plain"),
      ...noSitemaps,
      "https://mojweb.sk/": ok(
        html({ extras: '<a href="/tajne/1">a</a><a href="/tajne/2">b</a><a href="/ok">c</a>' }),
      ),
      "https://mojweb.sk/ok": ok(html()),
    });
    expect(result.pages.map((p) => p.url)).toContain("https://mojweb.sk/ok");
    expect(result.findings.some((f) => f.code === "ROBOTS_SKIP_LIMIT")).toBe(false);
  });

  it("yields to the event loop (time-based) while filtering a large frontier", async () => {
    const routes = frontierRoutes("User-agent: *\nDisallow: /z\n", 1_000);
    const timeoutSpy = vi.spyOn(globalThis, "setTimeout");
    let crawlDone = false;
    let timerFiredDuringCrawl = false;
    setTimeout(() => {
      timerFiredDuringCrawl = !crawlDone;
    }, 0);
    // Fake clock: every reading advances 0.04 ms, so a yield is due about every
    // 250 readings regardless of machine speed, and the 150 ms budget (3750
    // checks) is never exhausted by 1000 URLs.
    let tick = 0;
    await crawl("https://mojweb.sk/", routes, { pageLimit: 5, now: () => (tick += 0.04) });
    crawlDone = true;
    const yields = timeoutSpy.mock.calls.filter((c) => c[1] === 0).length;
    timeoutSpy.mockRestore();
    expect(yields).toBeGreaterThanOrEqual(5);
    expect(timerFiredDuringCrawl).toBe(true);
  });

  it("bounds total robots matching time; the dequeue check stays the safety net", async () => {
    // Fake clock: every robots check "takes" 1 ms, so the 150 ms budget is used
    // up after exactly 150 checks on any machine.
    let tick = 0;
    const robots = "User-agent: *\nDisallow: /z\n";
    const fetchFn = mockFetch(frontierRoutes(robots, 1_000));
    const result = await crawlSite("https://mojweb.sk/", {
      fetchFn,
      resolver: publicResolver,
      timeoutMs: 30_000,
      pageLimit: 5,
      now: () => tick++,
    });
    expect(MAX_ROBOTS_MATCH_MS).toBeLessThanOrEqual(200);
    // Seed + 149 sitemap URLs were matched at enqueue; the rest were queued unmatched.
    expect(result.robotsFilteredCount).toBe(MAX_ROBOTS_MATCH_MS - 1);
    expect(result.robotsFilteredCountIsLowerBound).toBe(true);
    expect(result.stepStates).toContain("PARTIAL_CRAWL");
    // Safety net: after the budget is used up, the dequeue check still never fetches a disallowed URL.
    expect(fetchedUrls(fetchFn).some((u) => u.includes("/z/"))).toBe(false);
    const limit = result.findings.find((f) => f.code === "ROBOTS_SKIP_LIMIT");
    expect(limit?.message).toContain("Doteraz auditované stránky zostávajú platné");
  });
});

describe("review fixes round 4: robots patterns normalized once at parse time (P2-A'')", () => {
  it("stores the percent-normalized pattern", () => {
    const robots = parseRobotsTxt("User-agent: *\nDisallow: /ž/%7e*\n");
    expect(robots.groups[0]!.rules[0]!.pattern).toBe("/%C5%BE/~*");
  });

  it("computes the length caps on the normalized pattern", () => {
    // 100 x "ž" = 101 raw chars (under 512) but 601 after normalization.
    const long = `Disallow: /${"ž".repeat(100)}`;
    expect(parseRobotsTxt(`User-agent: *\n${long}\n`).truncated).toBe(true);
    expect(parseRobotsTxt(`User-agent: Googlebot\n${long}\n`).truncated).toBe(false);
    // The attack shape from review: 254 x "ž" no longer slips through the caps.
    const attack = rulesOf254();
    expect(parseRobotsTxt(`User-agent: *\n${attack}\n`).truncated).toBe(true);
  });

  it("computes the summed cap on normalized lengths", () => {
    // 800 rules, 16 raw chars (12.8 KB) but ~86 normalized chars each (> 64 KiB).
    const many = Array.from(
      { length: 800 },
      (_, i) => `Disallow: /${"ž".repeat(14)}${i % 10}`,
    ).join("\n");
    expect(parseRobotsTxt(`User-agent: *\n${many}\n`).truncated).toBe(true);
  });

  it("still matches raw, percent-encoded and normalized forms equivalently", () => {
    const robots = parseRobotsTxt("User-agent: *\nDisallow: /žena\nDisallow: /%7Euser\n");
    expect(isPathAllowed(robots, "/%C5%BEena/x", "SEO4WEBBot")).toBe(false);
    expect(isPathAllowed(robots, "/žena", "SEO4WEBBot")).toBe(false);
    expect(isPathAllowed(robots, "/~user", "SEO4WEBBot")).toBe(false);
    expect(isPathAllowed(robots, "/other", "SEO4WEBBot")).toBe(true);
  });

  it("matches 1000 URLs against 1000 non-ASCII rules quickly (matcher only)", () => {
    const rules = Array.from({ length: 1_000 }, (_, i) => `Disallow: /ľščťžýáíé-${i}-xyz`).join(
      "\n",
    );
    const robots = parseRobotsTxt(`User-agent: *\n${rules}\n`);
    const paths = Array.from({ length: 1_000 }, (_, i) => `/y/${i}/${"ž".repeat(300)}`);
    const t = performance.now();
    for (const p of paths) isPathAllowed(robots, p, "SEO4WEBBot");
    expect(performance.now() - t).toBeLessThan(5_000);
  });
});

function rulesOf254(): string {
  return `Disallow: /*${"ž".repeat(254)}`;
}

describe("review fixes round 5: faceted e-shop (P3-l)", () => {
  // Each page links to 5 allowed product/category pages and 100 facet URLs
  // that robots.txt disallows (?color= / ?sort=).
  function facetedShop() {
    const fetchFn = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      if (url.pathname === "/robots.txt") {
        return ok("User-agent: *\nDisallow: /*?color=\nDisallow: /*?sort=\n", "text/plain");
      }
      if (url.pathname.includes("sitemap")) return ok("no", "text/html", 404);
      const id = url.pathname === "/" ? 0 : Number(url.pathname.split("/").pop());
      const children = [1, 2, 3, 4, 5].map((k) => `/produkt/${id * 5 + k}`);
      const facets = Array.from(
        { length: 100 },
        (_, j) => `${url.pathname}?color=c${j}&sort=s${j}`,
      );
      const links = [...facets, ...children].map((h) => `<a href="${h}">l</a>`).join("");
      return ok(html({ extras: links }));
    }) as unknown as typeof fetch;
    return fetchFn;
  }

  it(
    "reaches the 25-page limit instead of stopping on the skip cap",
    { timeout: PERF_TEST_TIMEOUT_MS },
    async () => {
      const fetchFn = facetedShop();
      const t = performance.now();
      const result = await crawlSite("https://mojweb.sk/", {
        fetchFn,
        resolver: publicResolver,
        timeoutMs: 30_000,
        pageLimit: 25,
        now: () => 0,
      });
      const ms = performance.now() - t;
      expect(result.crawledCount).toBe(25);
      expect(result.findings.some((f) => f.code === "ROBOTS_SKIP_LIMIT")).toBe(false);
      // 100 facet URLs per page were counted, never queued or fetched.
      expect(result.robotsFilteredCount).toBeGreaterThan(1_000);
      expect(fetchedUrls(fetchFn).some((u) => u.includes("?color=") || u.includes("?sort="))).toBe(
        false,
      );
      expect(ms).toBeLessThan(10_000);
    },
  );
});

describe("review fixes round 6: robots.txt applies to redirects (P2-D)", () => {
  const robots = ok(
    "User-agent: *\nDisallow: /private\nDisallow: /dir/\nDisallow: /login\n",
    "text/plain",
  );

  it("does not follow a redirect hop to a disallowed path (/go -> /private/secret)", async () => {
    const secret = vi.fn(() => ok(html({ title: "Tajná stránka s dostatočnou dĺžkou titulku" })));
    const fetchFn = mockFetch({
      "https://mojweb.sk/robots.txt": robots,
      ...noSitemaps,
      "https://mojweb.sk/": ok(html({ extras: '<a href="/go">go</a>' })),
      "https://mojweb.sk/go": () => redirect("/private/secret"),
      "https://mojweb.sk/private/secret": secret,
    });
    const result = await crawlSite("https://mojweb.sk/", {
      fetchFn,
      resolver: publicResolver,
      timeoutMs: 5_000,
      pageLimit: 10,
    });
    expect(secret).not.toHaveBeenCalled();
    expect(fetchedUrls(fetchFn).some((u) => u.includes("/private"))).toBe(false);
    const hit = result.findings.find((f) => f.code === "REDIRECT_DISALLOWED");
    expect(hit?.url).toBe("https://mojweb.sk/go");
    expect(hit?.severity).toBe("info");
    // Only the homepage was audited; the blocked hop produced an empty finding page.
    expect(result.pages.map((p) => p.title).filter(Boolean)).toHaveLength(1);
  });

  it("does not follow a 301 to a disallowed path (/old -> /private)", async () => {
    const fetchFn = mockFetch({
      "https://mojweb.sk/robots.txt": robots,
      ...noSitemaps,
      "https://mojweb.sk/": ok(html({ extras: '<a href="/old">old</a>' })),
      "https://mojweb.sk/old": () => redirect("/private", 301),
      "https://mojweb.sk/private": () => ok(html()),
    });
    const result = await crawlSite("https://mojweb.sk/", {
      fetchFn,
      resolver: publicResolver,
      timeoutMs: 5_000,
    });
    expect(fetchedUrls(fetchFn)).not.toContain("https://mojweb.sk/private");
    expect(result.findings.some((f) => f.code === "REDIRECT_DISALLOWED")).toBe(true);
  });

  it("does not audit a seed that redirects to a disallowed path (/ -> /login)", async () => {
    const fetchFn = mockFetch({
      "https://mojweb.sk/robots.txt": robots,
      ...noSitemaps,
      "https://mojweb.sk/": () => redirect("/login"),
      "https://mojweb.sk/login": () => ok(html({ title: "Prihlásenie do administrácie webu" })),
    });
    const result = await crawlSite("https://mojweb.sk/", {
      fetchFn,
      resolver: publicResolver,
      timeoutMs: 5_000,
    });
    expect(fetchedUrls(fetchFn)).not.toContain("https://mojweb.sk/login");
    expect(result.stepStates).toContain("BLOCKED: ROBOTS");
    expect(result.findings.some((f) => f.code === "REDIRECT_DISALLOWED")).toBe(true);
    expect(result.pages.every((p) => p.title === "")).toBe(true);
  });

  it("evaluates robots on the path as written: a link to /dir/ is disallowed, not stripped to /dir", async () => {
    const fetchFn = mockFetch({
      "https://mojweb.sk/robots.txt": robots,
      ...noSitemaps,
      "https://mojweb.sk/": ok(html({ extras: '<a href="/dir/">dir</a><a href="/ok">ok</a>' })),
      "https://mojweb.sk/ok": () => ok(html()),
      // /dir (no slash) would redirect to /dir/, which robots disallows.
      "https://mojweb.sk/dir": () => redirect("/dir/", 301),
      "https://mojweb.sk/dir/": () =>
        ok(html({ title: "Zakázaný adresár so slovenským titulkom" })),
    });
    const result = await crawlSite("https://mojweb.sk/", {
      fetchFn,
      resolver: publicResolver,
      timeoutMs: 5_000,
    });
    const fetched = fetchedUrls(fetchFn);
    expect(fetched).not.toContain("https://mojweb.sk/dir");
    expect(fetched).not.toContain("https://mojweb.sk/dir/");
    expect(fetched).toContain("https://mojweb.sk/ok");
    expect(result.robotsFilteredCount).toBe(1);
  });

  it("blocks /dir -> /dir/ at the redirect hop when only the slash-less link is known", async () => {
    const fetchFn = mockFetch({
      "https://mojweb.sk/robots.txt": robots,
      ...noSitemaps,
      "https://mojweb.sk/": ok(html({ extras: '<a href="/dir">dir</a>' })),
      "https://mojweb.sk/dir": () => redirect("/dir/", 301),
      "https://mojweb.sk/dir/": () =>
        ok(html({ title: "Zakázaný adresár so slovenským titulkom" })),
    });
    const result = await crawlSite("https://mojweb.sk/", {
      fetchFn,
      resolver: publicResolver,
      timeoutMs: 5_000,
    });
    expect(fetchedUrls(fetchFn)).not.toContain("https://mojweb.sk/dir/");
    expect(result.findings.some((f) => f.code === "REDIRECT_DISALLOWED")).toBe(true);
  });

  it("checks a seed given with a trailing slash in its written form", async () => {
    const fetchFn = mockFetch({
      "https://mojweb.sk/robots.txt": robots,
      ...noSitemaps,
      "https://mojweb.sk/dir/": () => ok(html()),
    });
    const result = await crawlSite("https://mojweb.sk/dir/", {
      fetchFn,
      resolver: publicResolver,
      timeoutMs: 5_000,
    });
    expect(result.stepStates).toContain("BLOCKED: ROBOTS");
    expect(result.findings.some((f) => f.code === "ROBOTS_DISALLOW")).toBe(true);
    expect(result.crawledCount).toBe(0);
  });

  it("checks the final URL too when the response reports one that was never hopped to", async () => {
    const reportsOtherUrl = () => {
      const res = ok(html({ title: "Obsah zakázanej stránky vo finálnej URL" }));
      Object.defineProperty(res, "url", { value: "https://mojweb.sk/private/final" });
      return res;
    };
    const result = await crawl("https://mojweb.sk/", {
      "https://mojweb.sk/robots.txt": robots,
      ...noSitemaps,
      "https://mojweb.sk/": ok(html({ extras: '<a href="/x">x</a>' })),
      "https://mojweb.sk/x": reportsOtherUrl,
    });
    expect(result.findings.some((f) => f.code === "REDIRECT_DISALLOWED")).toBe(true);
    expect(result.pages.some((p) => p.title.includes("zakázanej"))).toBe(false);
  });

  it("still follows redirects between allowed paths", async () => {
    const result = await crawl("https://mojweb.sk/", {
      "https://mojweb.sk/robots.txt": robots,
      ...noSitemaps,
      "https://mojweb.sk/": ok(html({ extras: '<a href="/a">a</a>' })),
      "https://mojweb.sk/a": () => redirect("/b"),
      "https://mojweb.sk/b": () => ok(html({ title: "Cieľová stránka presmerovania slovensky" })),
    });
    expect(result.findings.some((f) => f.code === "REDIRECT_DISALLOWED")).toBe(false);
    expect(result.pages.some((p) => p.url === "https://mojweb.sk/b")).toBe(true);
  });

  it("does not let robots.txt block sitemap redirects within the host", async () => {
    const result = await crawl("https://mojweb.sk/", {
      "https://mojweb.sk/robots.txt": ok("User-agent: *\nDisallow: /feeds\n", "text/plain"),
      "https://mojweb.sk/sitemap.xml": () => redirect("/feeds/sitemap.xml"),
      "https://mojweb.sk/feeds/sitemap.xml": () =>
        ok(xmlSitemap(["https://mojweb.sk/x"]), "application/xml"),
      "https://mojweb.sk/sitemap_index.xml": () => ok("no", "text/html", 404),
      "https://mojweb.sk/": ok(html()),
      "https://mojweb.sk/x": ok(html()),
    });
    expect(result.pages.some((p) => p.url === "https://mojweb.sk/x")).toBe(true);
  });
});

describe("review fixes round 6: robotsFilteredCount on every result (P3-o)", () => {
  it("is defined (0, exact) on early returns", async () => {
    const blocked = await crawl("https://mojweb.sk/", {
      "https://mojweb.sk/robots.txt": ok("User-agent: *\nDisallow: /\n", "text/plain"),
    });
    expect(blocked.stepStates).toContain("BLOCKED: ROBOTS");
    expect(blocked.robotsFilteredCount).toBe(0);
    expect(blocked.robotsFilteredCountIsLowerBound).toBe(false);

    const unavailable = await crawl("https://mojweb.sk/", {
      "https://mojweb.sk/robots.txt": ok("x", "text/plain", 503),
    });
    expect(unavailable.robotsFilteredCount).toBe(0);

    const ssrf = await crawlSite("http://127.0.0.1/", {});
    expect(ssrf.robotsFilteredCount).toBe(0);
    const invalid = await crawlSite("", {});
    expect(invalid.robotsFilteredCount).toBe(0);
    expect(invalid.robotsFilteredCountIsLowerBound).toBe(false);
  });

  it("is exact while the matching budget lasts", async () => {
    const result = await crawl(
      "https://mojweb.sk/",
      {
        "https://mojweb.sk/robots.txt": ok("User-agent: *\nDisallow: /tajne\n", "text/plain"),
        ...noSitemaps,
        "https://mojweb.sk/": ok(
          html({ extras: '<a href="/tajne/1">a</a><a href="/tajne/2">b</a>' }),
        ),
      },
      { now: () => 0 },
    );
    expect(result.robotsFilteredCount).toBe(2);
    expect(result.robotsFilteredCountIsLowerBound).toBe(false);
  });
});

describe("review fixes round 7: URLs are fetched and robots-checked as written (P3-p)", () => {
  const page = (title: string) => () => ok(html({ title }));

  it("crawls a /dir/ link under `Disallow: /dir` + `Allow: /dir/` and keeps the slash", async () => {
    const fetchFn = mockFetch({
      "https://mojweb.sk/robots.txt": ok(
        "User-agent: *\nDisallow: /dir\nAllow: /dir/\n",
        "text/plain",
      ),
      ...noSitemaps,
      "https://mojweb.sk/": ok(html({ extras: '<a href="/dir/">a</a><a href="/dir">b</a>' })),
      "https://mojweb.sk/dir/": page("Povolený adresár s lomítkom na konci"),
      "https://mojweb.sk/dir": page("Zakázaná forma bez lomítka v robots"),
    });
    const result = await crawlSite("https://mojweb.sk/", {
      fetchFn,
      resolver: publicResolver,
      timeoutMs: 5_000,
    });
    const fetched = fetchedUrls(fetchFn);
    expect(fetched).toContain("https://mojweb.sk/dir/");
    // The slash-less form was seen second: deduplicated, and never fetched.
    expect(fetched).not.toContain("https://mojweb.sk/dir");
    expect(result.pages.some((p) => p.title.startsWith("Povolený adresár"))).toBe(true);
  });

  it("crawls a /dir/ link under `Disallow: /dir$` but not /dir", async () => {
    const fetchFn = mockFetch({
      "https://mojweb.sk/robots.txt": ok("User-agent: *\nDisallow: /dir$\n", "text/plain"),
      ...noSitemaps,
      "https://mojweb.sk/": ok(html({ extras: '<a href="/dir/">a</a>' })),
      "https://mojweb.sk/dir/": page("Adresár s lomítkom povolený cez dolár"),
      "https://mojweb.sk/dir": page("Zakázaná forma bez lomítka cez dolár"),
    });
    await crawlSite("https://mojweb.sk/", { fetchFn, resolver: publicResolver, timeoutMs: 5_000 });
    expect(fetchedUrls(fetchFn)).toContain("https://mojweb.sk/dir/");
    expect(fetchedUrls(fetchFn)).not.toContain("https://mojweb.sk/dir");

    const only = mockFetch({
      "https://mojweb.sk/robots.txt": ok("User-agent: *\nDisallow: /dir$\n", "text/plain"),
      ...noSitemaps,
      "https://mojweb.sk/": ok(html({ extras: '<a href="/dir">a</a>' })),
      "https://mojweb.sk/dir": page("Zakázaná forma bez lomítka cez dolár"),
    });
    const blocked = await crawlSite("https://mojweb.sk/", {
      fetchFn: only,
      resolver: publicResolver,
      timeoutMs: 5_000,
    });
    expect(fetchedUrls(only)).not.toContain("https://mojweb.sk/dir");
    expect(blocked.robotsFilteredCount).toBe(1);
  });

  it("fetches sitemap URLs and a seed as written", async () => {
    const fetchFn = mockFetch({
      "https://mojweb.sk/robots.txt": ok("User-agent: *\nDisallow: /dir$\n", "text/plain"),
      "https://mojweb.sk/sitemap.xml": ok(
        xmlSitemap(["https://mojweb.sk/dir/", "https://mojweb.sk/dir"]),
        "application/xml",
      ),
      "https://mojweb.sk/sitemap_index.xml": () => ok("no", "text/html", 404),
      "https://mojweb.sk/": ok(html()),
      "https://mojweb.sk/dir/": page("Adresár zo sitemapy s lomítkom"),
    });
    await crawlSite("https://mojweb.sk/", { fetchFn, resolver: publicResolver, timeoutMs: 5_000 });
    expect(fetchedUrls(fetchFn)).toContain("https://mojweb.sk/dir/");

    const seedFetch = mockFetch({
      "https://mojweb.sk/robots.txt": ok("User-agent: *\nDisallow: /dir$\n", "text/plain"),
      ...noSitemaps,
      "https://mojweb.sk/dir/": page("Seed adresár s lomítkom na konci"),
    });
    const seeded = await crawlSite("https://mojweb.sk/dir/", {
      fetchFn: seedFetch,
      resolver: publicResolver,
      timeoutMs: 5_000,
    });
    expect(seeded.stepStates).not.toContain("BLOCKED: ROBOTS");
    expect(fetchedUrls(seedFetch)).toContain("https://mojweb.sk/dir/");
    expect(seeded.pages[0]!.title).toContain("Seed adresár");
  });

  it("does not block a redirect whose final URL is allowed as written", async () => {
    const result = await crawl("https://mojweb.sk/", {
      "https://mojweb.sk/robots.txt": ok("User-agent: *\nDisallow: /dir$\n", "text/plain"),
      ...noSitemaps,
      "https://mojweb.sk/": ok(html({ extras: '<a href="/old">o</a>' })),
      "https://mojweb.sk/old": () => redirect("/dir/", 301),
      "https://mojweb.sk/dir/": page("Cieľ presmerovania s lomítkom povolený"),
    });
    expect(result.findings.some((f) => f.code === "REDIRECT_DISALLOWED")).toBe(false);
    expect(result.pages.some((p) => p.title.startsWith("Cieľ presmerovania"))).toBe(true);
  });
});

describe("review fixes round 7: redirect loops are not reported as SSRF (P3-q)", () => {
  it("reports a same-host redirect loop as REDIRECT_LOOP, not BLOCKED: SSRF", async () => {
    const result = await crawl("https://mojweb.sk/", {
      "https://mojweb.sk/robots.txt": robotsOk,
      ...noSitemaps,
      "https://mojweb.sk/": ok(
        html({ extras: '<a href="/loop-a">a</a><a href="/self">s</a><a href="/ok">k</a>' }),
      ),
      "https://mojweb.sk/loop-a": () => redirect("/loop-b"),
      "https://mojweb.sk/loop-b": () => redirect("/loop-a"),
      "https://mojweb.sk/self": () => redirect("/self"),
      "https://mojweb.sk/ok": ok(html({ title: "Bežná stránka za slučkami presmerovaní" })),
    });
    const loops = result.findings.filter((f) => f.code === "REDIRECT_LOOP");
    expect(loops.map((f) => f.url).sort()).toEqual([
      "https://mojweb.sk/loop-a",
      "https://mojweb.sk/self",
    ]);
    expect(loops[0]!.message).toContain("presmerovan");
    expect(result.stepStates).not.toContain("BLOCKED: SSRF");
    expect(result.findings.some((f) => f.code === "SSRF_BLOCKED")).toBe(false);
    // The crawl continues with the remaining pages.
    expect(result.pages.some((p) => p.title.startsWith("Bežná stránka"))).toBe(true);
  });

  it("still reports a redirect to a private address as SSRF", async () => {
    const result = await crawl("https://mojweb.sk/", {
      "https://mojweb.sk/robots.txt": robotsOk,
      ...noSitemaps,
      "https://mojweb.sk/": () => redirect("http://127.0.0.1/admin"),
    });
    expect(result.stepStates).toContain("BLOCKED: SSRF");
    expect(result.findings.some((f) => f.code === "REDIRECT_LOOP")).toBe(false);
  });

  it("treats a robots.txt redirect loop as unavailable, not as SSRF", async () => {
    const result = await crawl("https://mojweb.sk/", {
      "https://mojweb.sk/robots.txt": () => redirect("/robots.txt"),
    });
    expect(result.stepStates).toContain("BLOCKED: ROBOTS");
    expect(result.stepStates).not.toContain("BLOCKED: SSRF");
    expect(result.findings.some((f) => f.code === "ROBOTS_UNAVAILABLE")).toBe(true);
  });
});
