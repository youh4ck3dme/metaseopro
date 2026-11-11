import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  isLocale,
  pageUrl,
  swapLocale,
  t,
  outputLanguage,
  LOCALES,
  BRAND,
  SITE,
  OG_IMAGE,
} from "./i18n";

const ROOT = process.cwd();

describe("i18n core behavior", () => {
  it("recognizes only sk, en, de as valid locales", () => {
    expect(isLocale("sk")).toBe(true);
    expect(isLocale("en")).toBe(true);
    expect(isLocale("de")).toBe(true);
    expect(isLocale("fr")).toBe(false);
    expect(isLocale("")).toBe(false);
    expect(isLocale(undefined)).toBe(false);
    expect(LOCALES).toEqual(["sk", "en", "de"]);
  });

  it("builds absolute page URLs with locale prefix and no double slash", () => {
    expect(pageUrl("sk", "/")).toBe("https://seo.vorkei.com/sk");
    expect(pageUrl("en", "/audit")).toBe("https://seo.vorkei.com/en/audit");
    expect(pageUrl("de", "/settings/agency")).toBe(
      "https://seo.vorkei.com/de/settings/agency",
    );
    expect(pageUrl("sk", "/sk/audit")).toBe("https://seo.vorkei.com/sk/audit");
  });

  it("swaps locale prefix while preserving the rest of the path", () => {
    expect(swapLocale("/sk/audit", "en")).toBe("/en/audit");
    expect(swapLocale("/en/settings/agency", "de")).toBe("/de/settings/agency");
    expect(swapLocale("/de", "sk")).toBe("/sk");
    expect(swapLocale("/", "en")).toBe("/en");
    expect(swapLocale("/login", "de")).toBe("/de/login");
  });

  it("falls back to Slovak when a key is missing in the requested locale", () => {
    const skTitle = t("sk", "meta.homeTitle");
    expect(skTitle).toContain("seo.vorkei");
    expect(t("en", "meta.homeTitle")).toBeTruthy();
    expect(t("de", "meta.homeTitle")).toBeTruthy();
    // Unknown key should return the key itself (via fallback chain)
    expect(t("en", "this.key.does.not.exist" as never)).toBe("this.key.does.not.exist");
  });

  it("maps locale to the correct AI output language", () => {
    expect(outputLanguage("sk")).toBe("Slovenčina (SK)");
    expect(outputLanguage("en")).toBe("English");
    expect(outputLanguage("de")).toBe("Deutsch (DE/CH)");
  });

  it("exposes the current brand, site and og image constants", () => {
    expect(BRAND).toBe("seo.vorkei");
    expect(SITE).toBe("https://seo.vorkei.com");
    expect(OG_IMAGE).toBe("https://seo.vorkei.com/og-seo-vorkei.png");
  });
});

describe("locale-aware route structure", () => {
  const required = [
    "index.tsx",
    "login.tsx",
    "audit.tsx",
    "brief.tsx",
    "dashboard.tsx",
    "decay.tsx",
    "history.tsx",
    "plan.tsx",
    "raketa.tsx",
    "settings.agency.tsx",
  ];

  it("has all main pages under the $locale segment", () => {
    for (const file of required) {
      const path = join(ROOT, "src/routes/$locale", file);
      expect(existsSync(path), `Missing locale route: src/routes/$locale/${file}`).toBe(true);
    }
  });

  it("does not keep the old flat routes that would bypass the locale prefix", () => {
    const oldFlat = ["audit.tsx", "brief.tsx", "dashboard.tsx", "login.tsx", "plan.tsx"];
    for (const file of oldFlat) {
      const path = join(ROOT, "src/routes", file);
      expect(existsSync(path), `Old flat route still present: src/routes/${file}`).toBe(false);
    }
  });
});
