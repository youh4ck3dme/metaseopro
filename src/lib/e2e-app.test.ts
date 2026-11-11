/**
 * Replaced the previous live-server E2E suite.
 *
 * The old tests:
 * - Silently skipped when no dev server was running (false greens)
 * - Asserted the outdated brand "SEO4WEB"
 * - Hit old routes without the /$locale prefix
 * - Depended on exact Slovak HTML strings
 *
 * Real behavioral coverage now lives in:
 * - src/lib/i18n.test.ts          (locale helpers, URL building, fallback)
 * - src/lib/brand-and-routes.test.ts (favicon, brand, route structure)
 * - src/lib/integrity.test.ts     (secrets, RLS, no react-router-dom)
 *
 * If you need true browser E2E later, add Playwright with a controlled
 * fixture server and assert on the /$locale routes.
 */
import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { join } from "node:path";

describe("legacy e2e suite (retired)", () => {
  it("documents that live HTTP checks were removed", () => {
    // This test exists only so the file still runs and the reason is visible in CI output.
    expect(true).toBe(true);
  });

  it("confirms the new unit-test replacements are present", () => {
    expect(existsSync(join(process.cwd(), "src/lib/i18n.test.ts"))).toBe(true);
    expect(existsSync(join(process.cwd(), "src/lib/brand-and-routes.test.ts"))).toBe(true);
  });
});
