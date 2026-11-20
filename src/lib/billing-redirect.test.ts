import { describe, expect, it } from "vitest";
import { resolveBillingOrigin, resolveBillingReturnUrl } from "./billing-redirect.server";

describe("billing redirect boundary", () => {
  const origin = "https://seo4web.lovable.app";
  it("uses the requested canonical default and a server-owned portal path", () => {
    expect(resolveBillingOrigin(undefined, "production")).toBe(origin);
    expect(resolveBillingReturnUrl(undefined, "/settings/agency?tab=billing", origin)).toBe(
      `${origin}/settings/agency?tab=billing`,
    );
  });
  it.each([
    "https://evil.example/",
    "//evil.example/",
    "/\\evil.example/",
    "/\tevil.example/",
    "javascript:alert(1)",
    " /dashboard",
    "",
  ])("rejects untrusted return target %j", (candidate) => {
    expect(() => resolveBillingReturnUrl(candidate, "/dashboard", origin)).toThrow();
  });
  it("keeps relative query/hash paths on the server-configured origin", () => {
    expect(resolveBillingReturnUrl("/dashboard?payment=cancelled#billing", "/", origin)).toBe(
      `${origin}/dashboard?payment=cancelled#billing`,
    );
  });
  it.each([
    "http://seo4web.lovable.app",
    "https://name:secret@example.test",
    "https://example.test/path",
    "https://example.test/?redirect=x",
    "not a URL",
  ])("rejects malformed or unsafe SITE_URL %j", (value) => {
    expect(() => resolveBillingOrigin(value, "production")).toThrow();
  });
  it("allows loopback HTTP only in local development", () => {
    expect(resolveBillingOrigin("http://localhost:3000", "development")).toBe(
      "http://localhost:3000",
    );
    expect(() => resolveBillingOrigin("http://localhost:3000", "production")).toThrow();
    expect(() => resolveBillingOrigin("http://localhost.evil.test", "development")).toThrow();
  });
});
