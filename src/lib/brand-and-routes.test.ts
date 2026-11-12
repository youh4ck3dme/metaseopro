import { describe, expect, it } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();

describe("brand and public assets", () => {
  it("favicon files exist and are referenced from the root head", () => {
    expect(existsSync(join(ROOT, "public/favicon.svg"))).toBe(true);
    expect(existsSync(join(ROOT, "public/favicon-32.png"))).toBe(true);
    expect(existsSync(join(ROOT, "public/apple-touch-icon.png"))).toBe(true);

    const root = readFileSync(join(ROOT, "src/routes/__root.tsx"), "utf-8");
    expect(root).toContain("/favicon.svg");
    expect(root).toContain("/favicon-32.png");
    expect(root).toContain("/apple-touch-icon.png");
    expect(root).toContain("/manifest.json");
  });

  it("ships an installable web app manifest and network-first service worker", () => {
    const manifest = JSON.parse(readFileSync(join(ROOT, "public/manifest.json"), "utf-8"));
    expect(manifest.name).toBe("seo.vorkei");
    expect(manifest.short_name).toBe("seo.vorkei");
    expect(manifest.start_url).toBe("/sk");
    expect(manifest.display).toBe("standalone");
    expect(manifest.theme_color).toBe("#0f1214");
    expect(manifest.background_color).toBe("#0f1214");
    expect(manifest.icons.map((icon: { sizes: string }) => icon.sizes)).toEqual([
      "192x192",
      "512x512",
    ]);
    expect(existsSync(join(ROOT, "public/icon-192.png"))).toBe(true);
    expect(existsSync(join(ROOT, "public/icon-512.png"))).toBe(true);

    const worker = readFileSync(join(ROOT, "public/sw.js"), "utf-8");
    expect(worker).toContain("networkFirstHtml");
    const start = worker.indexOf("async function networkFirstHtml");
    const end = worker.indexOf("async function cacheFirstStatic");
    const htmlStrategy = worker.slice(start, end);
    expect(htmlStrategy).toContain("fetch(request)");
    expect(htmlStrategy).not.toContain("cache.put");
    expect(existsSync(join(ROOT, "public/offline.html"))).toBe(true);
  });

  it("root head uses seo.vorkei brand in title and og:site_name", () => {
    const root = readFileSync(join(ROOT, "src/routes/__root.tsx"), "utf-8");
    expect(root).toContain("seo.vorkei");
    // Old brand must not appear in the root title / og tags
    expect(root).not.toContain("SEO4WEB — All-in-One");
  });
});

describe("architectural guards (no live server)", () => {
  it("forbids private secrets in any committed .env file", () => {
    const envPath = join(ROOT, ".env");
    if (!existsSync(envPath)) return; // nothing committed to check

    const content = readFileSync(envPath, "utf-8");
    const forbidden = [
      "LOVABLE_API_KEY=",
      "SEMRUSH_API_KEY=",
      "SUPABASE_SERVICE_ROLE_KEY=",
      "STRIPE_SECRET_KEY=",
      "STRIPE_WEBHOOK_SECRET=",
      "SUPERFAKTURA_API_KEY=",
    ];
    for (const secret of forbidden) {
      expect(content, `.env must not contain ${secret}`).not.toContain(secret);
    }
  });

  it(".gitignore protects local env files", () => {
    const gi = readFileSync(join(ROOT, ".gitignore"), "utf-8");
    expect(gi).toContain(".env.local");
    // Bare .env is intentionally tracked for public Lovable config; private keys must stay out
  });

  it("no source file imports from react-router-dom", () => {
    // Lightweight check on a few high-traffic files; full scan is in integrity.test.ts
    const files = [
      "src/components/AppHeader.tsx",
      "src/routes/__root.tsx",
      "src/routes/index.tsx",
    ];
    for (const f of files) {
      const content = readFileSync(join(ROOT, f), "utf-8");
      expect(content).not.toContain('from "react-router-dom"');
      expect(content).not.toContain("from 'react-router-dom'");
    }
  });
});
