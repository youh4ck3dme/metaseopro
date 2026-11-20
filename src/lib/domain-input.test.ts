import { describe, expect, it } from "vitest";
import {
  DOMAIN_INPUT_EMPTY_ERROR,
  DOMAIN_INPUT_INVALID_ERROR,
  auditLoginRedirect,
  domainInputError,
  parseDomainInput,
} from "./domain-input";

describe("parseDomainInput", () => {
  it("accepts a bare hostname", () => {
    expect(parseDomainInput("example.sk")).toBe("example.sk");
  });

  it("normalizes an https URL with www, path and query to the hostname", () => {
    expect(parseDomainInput("https://www.example.sk/path?q=1")).toBe("example.sk");
  });

  it("accepts http, mixed case, a trailing dot and surrounding whitespace", () => {
    expect(parseDomainInput("  HTTP://Example.SK.  ")).toBe("example.sk");
  });

  it("accepts a protocol-relative URL", () => {
    expect(parseDomainInput("//www.example.sk/cesta")).toBe("example.sk");
  });

  it.each([
    "",
    "   ",
    "garbage",
    "not a domain",
    "http://",
    "https://localhost",
    "https://127.0.0.1",
    "ftp://example.sk",
    "javascript:alert(1)",
    "example",
    "-example.sk",
  ])("rejects %j", (input) => {
    expect(parseDomainInput(input)).toBeNull();
  });

  it("accepts a bare hostname with a trailing path slash via URL parsing", () => {
    expect(parseDomainInput("example.sk/")).toBe("example.sk");
  });
});

describe("domainInputError", () => {
  it("asks for a domain when the field is empty", () => {
    expect(domainInputError("")).toBe(DOMAIN_INPUT_EMPTY_ERROR);
    expect(domainInputError("  ")).toBe(DOMAIN_INPUT_EMPTY_ERROR);
  });

  it("explains invalid input in Slovak", () => {
    expect(domainInputError("!!!")).toBe(DOMAIN_INPUT_INVALID_ERROR);
  });

  it("returns null for a valid domain", () => {
    expect(domainInputError("example.sk")).toBeNull();
  });
});

describe("auditLoginRedirect (/audit login guard, Bora P3-5)", () => {
  it("keeps a plain domain", () => {
    expect(auditLoginRedirect("example.sk")).toBe("/audit?domain=example.sk");
  });

  it.each([
    ["user@x.sk", "x.sk", "userinfo '@'"],
    ["https://x.sk", "x.sk", "'://' URL"],
    ["https://www.x.sk/path?q=1", "x.sk", "URL with path, query and www"],
    ["A@B.sk", "b.sk", "upper case"],
  ])("normalizes %s to %s (%s)", (raw, host) => {
    expect(auditLoginRedirect(raw)).toBe(`/audit?domain=${host}`);
  });

  it.each([
    [null, "missing"],
    [undefined, "undefined"],
    ["", "empty"],
    ["not a domain", "whitespace"],
    ["127.0.0.1", "IP address"],
    ["javascript:alert(1)", "scheme"],
    ["<script>.sk", "markup"],
  ])("falls back to /audit for %s (%s)", (raw, _label) => {
    expect(auditLoginRedirect(raw)).toBe("/audit");
  });

  it("never returns /dashboard or an off-site target", () => {
    for (const raw of [
      "a@b.sk",
      "https://evil.com\\@x.sk",
      "//evil.com",
      "x.sk&ref=http://y.com",
    ]) {
      const out = auditLoginRedirect(raw);
      expect(out.startsWith("/audit")).toBe(true);
      expect(out).not.toContain("://");
      expect(out).not.toContain("@");
    }
  });
});
