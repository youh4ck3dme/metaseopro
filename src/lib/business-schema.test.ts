import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const sql = readFileSync("drizzle/migrations/0002_create_seo_business_tables.sql", "utf8");

describe("Business table access boundaries", () => {
  it("limits subscription reads to the authenticated owner without granting client writes", () => {
    expect(sql).toMatch(/FOR SELECT TO authenticated USING \(auth\.uid\(\) = user_id\)/);
    expect(sql).toContain("GRANT SELECT ON public.subscriptions TO authenticated;");
    expect(sql).not.toMatch(
      /GRANT (?:ALL|INSERT|UPDATE|DELETE).*public\.subscriptions TO authenticated/,
    );
  });

  it("checks agency ownership on both inserts and updates", () => {
    expect(sql).toContain(
      "ON public.agency_profiles FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id)",
    );
    expect(sql).toContain(
      "ON public.agency_profiles FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id)",
    );
    expect(sql).toContain(
      "GRANT SELECT, INSERT, UPDATE, DELETE ON public.agency_profiles TO authenticated;",
    );
  });

  it("restricts cache exclusively to service role without exposing data to authenticated clients", () => {
    expect(sql).toContain("GRANT ALL ON public.semrush_domain_cache TO service_role;");
    expect(sql).toContain(
      "REVOKE ALL ON TABLE public.semrush_domain_cache FROM authenticated, anon, public;",
    );
    expect(sql).not.toContain("GRANT SELECT ON public.semrush_domain_cache TO authenticated;");
    expect(sql).not.toMatch(
      /GRANT (?:ALL|SELECT|INSERT|UPDATE|DELETE).*public\.semrush_domain_cache TO authenticated/,
    );
  });
});
