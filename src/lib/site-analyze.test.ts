import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { normalizeUrl } from "./raketa-schema";
import { analyzePage, runAnalysis } from "./site-analyze.server";

const DNS_OK = {
  ok: true,
  status: 200,
  json: async () => ({ Answer: [{ type: 1, data: "93.184.216.34" }] }),
};

const dnsAware = (impl: (url: string, init?: RequestInit) => unknown) =>
  vi.fn((url: unknown, init?: RequestInit) =>
    String(url).includes("dns-query") ? DNS_OK : impl(String(url), init),
  ) as unknown as typeof fetch;

describe("Site Analyze & Parser (Unit & Regression)", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  describe("normalizeUrl", () => {
    it("prepends https:// when protocol is missing", () => {
      expect(normalizeUrl("seo4web.sk")).toBe("https://seo4web.sk/");
      expect(normalizeUrl("subdomain.example.com/path")).toBe("https://subdomain.example.com/path");
    });

    it("preserves valid http and https URLs", () => {
      expect(normalizeUrl("https://example.com/blog/")).toBe("https://example.com/blog/");
      expect(normalizeUrl("http://example.com/test")).toBe("http://example.com/test");
    });

    it("returns null for invalid strings or empty input", () => {
      expect(normalizeUrl("")).toBeNull();
      expect(normalizeUrl("   ")).toBeNull();
      expect(normalizeUrl("not-a-domain")).toBeNull();
      expect(normalizeUrl("domain with space.com")).toBeNull();
      expect(normalizeUrl("ftp://files.example.com")).toBeNull();
    });
  });

  describe("analyzePage with mock HTML", () => {
    it("extracts title, meta description, headings, and CTAs accurately", async () => {
      const mockHtml = `
        <!DOCTYPE html>
        <html>
        <head>
          <title>Najlepšie SEO Služby v Bratislave | Agentúra</title>
          <meta name="description" content="Kompletná SEO optimalizácia pre firmy v Bratislave a okolí. Zvýšte organickú návštevnosť a tržby.">
        </head>
        <body>
          <header>
            <a href="/kontakt">Kontakt</a>
          </header>
          <main>
            <h1>SEO Optimalizácia pre Váš Web</h1>
            <h2>Technický SEO Audit</h2>
            <p>Vykonavame podrobny technicky audit vsetkych parametrov webu pre vyhladavace.</p>
            <h2>On-page Faktory a Obsah</h2>
            <p>Pripravujeme analyzu klucovych slov a kvalitne clanky s vysokou pridanou hodnotou.</p>
            <h2>Linkbuilding a Autorita</h2>
            <p>Budujeme silny a bezpecny odkazovy profil, ktory prinasa dlhodobe vysledky.</p>
            <h3>Analyza Konkurencie</h3>
            <p>Pozrieme sa na vase najvacsie konkurencie a najdeme prilezitosti pre rast.</p>
            <button>Objednať konzultáciu zadarmo</button>
            <a href="/cennik">Pozrieť cenník</a>
          </main>
        </body>
        </html>
      `;

      globalThis.fetch = dnsAware(() =>
        Promise.resolve({
          ok: true,
          headers: new Headers({ "content-type": "text/html; charset=utf-8" }),
          text: () => Promise.resolve(mockHtml),
          body: null,
        }),
      );

      const analysis = await analyzePage("https://mojweb.sk");

      expect(analysis.ok).toBe(true);
      expect(analysis.estimated).toBe(false);
      expect(analysis.title).toBe("Najlepšie SEO Služby v Bratislave | Agentúra");
      expect(analysis.metaDescription).toContain("Kompletná SEO optimalizácia");
      expect(analysis.h1).toEqual(["SEO Optimalizácia pre Váš Web"]);
      expect(analysis.h2.length).toBe(3);
      expect(analysis.h2).toContain("Technický SEO Audit");
      expect(analysis.h3).toContain("Analyza Konkurencie");
      expect(analysis.ctas.length).toBeGreaterThan(0);
      expect(analysis.ctas.some((c) => c.toLowerCase().includes("kontakt"))).toBe(true);
      expect(analysis.ctas.some((c) => c.toLowerCase().includes("cenník"))).toBe(true);
    });

    it("falls back to og:description when standard description is absent", async () => {
      const mockHtml = `
        <!DOCTYPE html>
        <html>
        <head>
          <title>OpenGraph Test</title>
          <meta property="og:description" content="Popis z OpenGraph tagu pre sociálne siete.">
        </head>
        <body>
          <h1>Hlavný Titulok</h1>
          <h2>Podtitulok 1</h2>
          <h2>Podtitulok 2</h2>
          <h2>Podtitulok 3</h2>
          <p>${"Slovo ".repeat(70)}</p>
        </body>
        </html>
      `;

      globalThis.fetch = dnsAware(() =>
        Promise.resolve({
          ok: true,
          headers: new Headers({ "content-type": "text/html" }),
          text: () => Promise.resolve(mockHtml),
          body: null,
        }),
      );

      const analysis = await analyzePage("https://ogtest.sk");
      expect(analysis.metaDescription).toBe("Popis z OpenGraph tagu pre sociálne siete.");
    });

    it("detects thin content (<60 words, 0 headings) and marks estimated: true", async () => {
      const thinHtml = `
        <!DOCTYPE html>
        <html>
        <body>
          <div id="root">Loading application...</div>
        </body>
        </html>
      `;

      globalThis.fetch = dnsAware(() =>
        Promise.resolve({
          ok: true,
          headers: new Headers({ "content-type": "text/html" }),
          text: () => Promise.resolve(thinHtml),
          body: null,
        }),
      );

      const analysis = await analyzePage("https://spa-app.sk");
      expect(analysis.ok).toBe(false);
      expect(analysis.estimated).toBe(true);
      expect(analysis.note).toContain("pravdepodobne JS-heavy web");
    });

    it("handles HTTP errors (e.g. 404/500) gracefully", async () => {
      globalThis.fetch = dnsAware(() =>
        Promise.resolve({
          ok: false,
          status: 404,
          headers: new Headers({ "content-type": "text/html" }),
        }),
      );

      await expect(analyzePage("https://mojweb.sk/non-existent")).rejects.toMatchObject({
        name: "AnalyzeError",
        code: "HTTP_ERROR",
      });
    });
  });

  describe("runAnalysis and competitor comparison", () => {
    it("identifies content gaps, missing keywords, and CTA disparities", async () => {
      const ownHtml = `
        <!DOCTYPE html>
        <html>
        <head>
          <title>Moja Stránka</title>
          <meta name="description" content="Kratky">
        </head>
        <body>
          <h1>Iba jeden nadpis bez kľúčového slova</h1>
          <p>Maly obsah bez CTA a bez podnadpisov.</p>
        </body>
        </html>
      `;

      const compHtml = `
        <!DOCTYPE html>
        <html>
        <head>
          <title>Najlepšie SEO v Bratislave od Špecialistov</title>
          <meta name="description" content="Kompletné SEO služby a optimalizácia pre vyhľadávače v Bratislave s merateľnými výsledkami pre každú firmu.">
        </head>
        <body>
          <h1>SEO Služby Bratislava</h1>
          <h2>Audit webu</h2>
          <h2>Analýza kľúčových slov</h2>
          <h2>Linkbuilding stratégia</h2>
          <p>${"Komplexný text o optimalizácii webových stránok a vyhľadávačoch. ".repeat(40)}</p>
          <button>Objednať bezplatnú konzultáciu</button>
          <a href="/kontakt">Kontaktujte nás</a>
        </body>
        </html>
      `;

      globalThis.fetch = dnsAware((url: string) => {
        const isComp = url.includes("konkurent");
        return Promise.resolve({
          ok: true,
          headers: new Headers({ "content-type": "text/html" }),
          text: () => Promise.resolve(isComp ? compHtml : ownHtml),
          body: null,
        });
      });

      const result = await runAnalysis(
        "https://mojweb.sk",
        "https://konkurent.sk",
        "seo bratislava",
      );

      expect(result.own.url).toBe("https://mojweb.sk/");
      expect(result.competitor).not.toBeNull();
      expect(result.comparison.metaIssues.length).toBeGreaterThan(0);
      expect(result.comparison.weakHeadings.length).toBeGreaterThan(0);
      expect(result.comparison.ctaIssues.length).toBeGreaterThan(0);
      expect(result.comparison.contentGaps.length).toBeGreaterThan(0);
    });
  });
});

describe("fail-closed: every error is a typed AnalyzeError, never mock data", () => {
  it("rejects invalid URL with INVALID_URL", async () => {
    await expect(analyzePage("not-a-domain")).rejects.toMatchObject({
      name: "AnalyzeError",
      code: "INVALID_URL",
    });
  });

  it("rejects SSRF-blocked URL with SSRF_BLOCKED and never calls fetch", async () => {
    globalThis.fetch = vi.fn(() => Promise.resolve(new Response("x", { status: 200 })));
    await expect(analyzePage("http://10.1.2.3/")).rejects.toMatchObject({
      name: "AnalyzeError",
      code: "SSRF_BLOCKED",
    });
    await expect(analyzePage("http://10.1.2.3/")).rejects.toThrow(/SSRF/);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("rejects network/timeout failure with FETCH_FAILED", async () => {
    globalThis.fetch = dnsAware(() => Promise.reject(new Error("ECONNREFUSED")));
    await expect(analyzePage("https://mojweb.sk")).rejects.toMatchObject({
      name: "AnalyzeError",
      code: "FETCH_FAILED",
    });
  });

  it("maps TimeoutError to FETCH_FAILED", async () => {
    globalThis.fetch = dnsAware(() =>
      Promise.reject(new DOMException("The operation timed out.", "TimeoutError")),
    );
    await expect(analyzePage("https://mojweb.sk")).rejects.toMatchObject({
      name: "AnalyzeError",
      code: "FETCH_FAILED",
    });
  });

  it("rejects a redirect to an internal target with SSRF_BLOCKED and returns no data", async () => {
    globalThis.fetch = dnsAware(() =>
      Promise.resolve(
        new Response(null, { status: 302, headers: { location: "http://10.0.0.1/" } }),
      ),
    );
    await expect(analyzePage("https://mojweb.sk/")).rejects.toMatchObject({
      name: "AnalyzeError",
      code: "SSRF_BLOCKED",
    });
    await expect(analyzePage("https://mojweb.sk/")).rejects.toThrow(/SSRF/);
  });

  it("rejects non-HTML response with NOT_HTML", async () => {
    globalThis.fetch = dnsAware(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        headers: new Headers({ "content-type": "application/json" }),
        text: () => Promise.resolve('{"a":1}'),
        body: null,
      }),
    );
    await expect(analyzePage("https://mojweb.sk/api")).rejects.toMatchObject({
      name: "AnalyzeError",
      code: "NOT_HTML",
    });
  });

  it("runAnalysis propagates the typed error instead of returning mock analysis", async () => {
    globalThis.fetch = dnsAware(() => Promise.reject(new Error("timeout")));
    await expect(
      runAnalysis("https://mojweb.sk", "https://konkurent.sk", "seo"),
    ).rejects.toMatchObject({ name: "AnalyzeError", code: "FETCH_FAILED" });
  });
});
