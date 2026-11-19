import { describe, expect, it } from "vitest";
import { secretsMatch } from "./secret-compare.server";

describe("secretsMatch", () => {
  it("matches equal secrets only", () => {
    expect(secretsMatch("abc", "abc")).toBe(true);
    expect(secretsMatch("abc", "abd")).toBe(false);
  });
  it("is length-safe (does not throw on different lengths)", () => {
    expect(secretsMatch("abc", "abcd")).toBe(false);
    expect(secretsMatch("a-long-secret-value", "x")).toBe(false);
  });
  it("rejects missing or empty values", () => {
    expect(secretsMatch(undefined, "x")).toBe(false);
    expect(secretsMatch("x", undefined)).toBe(false);
    expect(secretsMatch("", "")).toBe(false);
  });
});
