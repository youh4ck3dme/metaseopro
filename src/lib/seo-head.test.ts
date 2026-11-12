import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { privateSeoHead, publicSeoHead } from "./seo-head";
import { buildSitemapXml, SITEMAP_PATHS } from "./sitemap";

describe("public SEO head", () => {
  it("emits unique title, description, canonical, hreflang and JSON-LD for a locale path", () => {
    const head = publicSeoHead("de", "/audit", "meta.auditTitle", "meta.auditDesc");
    const title = head.meta.find((item) => "title" in item);
    const description = head.meta.find((item) => "name" in item && item.name === "description");
    const robots = head.meta.find((item) => "name" in item && item.name === "robots");

    expect(title && "title" in title && title.title).toContain("seo.vorkei");
    expect(description && "content" in description && description.content).toContain("seo.vorkei");
    expect(robots && "content" in robots && robots.content).toBe("index, follow");
    expect(head.links.find((link) => link.rel === "canonical")?.href).toBe(
      "https://seo.vorkei.com/de/audit",
    );
    expect(head.links.filter((link) => link.rel === "alternate").map((link) => link.hrefLang)).toEqual([
      "sk",
      "en",
      "de",
      "x-default",
    ]);

    const script = head.scripts[0]?.children ?? "";
    expect(script).toContain('"@type":"Organization"');
    expect(script).toContain('"@type":"WebApplication"');
    expect(script).toContain("https://seo.vorkei.com/de/audit");
    expect(script).not.toContain("<script");
  });

  it("marks private routes noindex and omits JSON-LD", () => {
    const head = privateSeoHead("sk", "/dashboard", "meta.dashboardTitle", "meta.dashboardDesc");
    const robots = head.meta.find((item) => "name" in item && item.name === "robots");
    expect(robots && "content" in robots && robots.content).toBe("noindex, nofollow");
    expect(head).not.toHaveProperty("scripts");
    expect(head.links.find((link) => link.rel === "canonical")?.href).toBe(
      "https://seo.vorkei.com/sk/dashboard",
    );
  });
});

describe("sitemap", () => {
  it("lists every public path in sk, en and de", () => {
    const xml = buildSitemapXml("2026-11-12");
    expect(xml).toContain('xmlns:xhtml="http://www.w3.org/1999/xhtml"');
    for (const entry of SITEMAP_PATHS) {
      const suffix = entry.path === "/" ? "" : entry.path;
      expect(xml).toContain(`<loc>https://seo.vorkei.com/sk${suffix}</loc>`);
      expect(xml).toContain(`<loc>https://seo.vorkei.com/en${suffix}</loc>`);
      expect(xml).toContain(`<loc>https://seo.vorkei.com/de${suffix}</loc>`);
      expect(xml).toContain(`hreflang="de" href="https://seo.vorkei.com/de${suffix}"`);
      expect(xml).toContain(`hreflang="x-default" href="https://seo.vorkei.com/sk${suffix}"`);
    }
    expect(xml).not.toContain("/dashboard");
    expect(xml).not.toContain("/api/");
    expect(readFileSync(join(process.cwd(), "public/sitemap.xml"), "utf-8")).toBe(
      buildSitemapXml("2026-11-12"),
    );
  });
});
