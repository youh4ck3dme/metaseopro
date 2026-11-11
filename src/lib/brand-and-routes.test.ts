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
