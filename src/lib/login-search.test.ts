import { afterEach, describe, expect, it, vi } from "vitest";
import { parseLoginMode, parseLoginSearch, rememberLoginRedirect } from "./login-search";
import { consumeAuthRedirect, peekAuthRedirect, saveAuthRedirect } from "./safe-auth-redirect";

afterEach(() => {
  vi.unstubAllGlobals();
});

const stubBrowser = (withStorage = true) => {
  const store = new Map<string, string>();
  vi.stubGlobal("window", {
    location: { origin: "https://metaseopro.vercel.app", search: "" },
    sessionStorage: withStorage
      ? {
          getItem: (k: string) => store.get(k) ?? null,
          setItem: (k: string, v: string) => void store.set(k, v),
          removeItem: (k: string) => void store.delete(k),
        }
      : undefined,
  });
};

describe("parseLoginMode", () => {
  it("selects signup only for the exact signup value", () => {
    expect(parseLoginMode("signup")).toBe("signup");
  });

  it.each([
    { value: "signin" as const, label: "signin literal" },
    { value: undefined, label: "missing" },
    { value: null, label: "null" },
    { value: "", label: "empty string" },
    { value: "SIGNUP", label: "wrong case" },
    { value: "register", label: "unknown string" },
    { value: 1, label: "number" },
    { value: true, label: "boolean" },
    { value: ["signup"], label: "array" },
    { value: { mode: "signup" }, label: "object" },
  ])("falls back to signin for $label", ({ value }) => {
    expect(parseLoginMode(value)).toBe("signin");
  });
});

describe("parseLoginSearch", () => {
  it("keeps a safe redirect and omits mode for default sign-in", () => {
    expect(parseLoginSearch({ redirect: "/audit?domain=example.sk" })).toEqual({
      redirect: "/audit?domain=example.sk",
    });
  });

  it("adds mode=signup when requested", () => {
    expect(parseLoginSearch({ redirect: "/audit", mode: "signup" })).toEqual({
      redirect: "/audit",
      mode: "signup",
    });
  });

  it("drops invalid mode and unsafe redirect together", () => {
    expect(parseLoginSearch({ redirect: "https://evil.example", mode: "nope" })).toEqual({
      redirect: "/dashboard",
    });
  });
});

describe("sticky redirect fix (46da7b7) — parseLoginSearch", () => {
  it("returns no redirect key when ?redirect is absent", () => {
    expect(parseLoginSearch({})).toEqual({});
    expect("redirect" in parseLoginSearch({})).toBe(false);
    expect(parseLoginSearch({ mode: "signup" })).toEqual({ mode: "signup" });
  });

  it.each([
    { value: "", label: "empty string" },
    { value: undefined, label: "undefined" },
    { value: null, label: "null" },
    { value: 5, label: "number" },
    { value: ["/brief"], label: "array" },
    { value: { redirect: "/brief" }, label: "object" },
  ])("returns no redirect key for $label", ({ value }) => {
    expect("redirect" in parseLoginSearch({ redirect: value })).toBe(false);
  });

  it("keeps an explicit safe redirect and sanitizes an unsafe one to /dashboard", () => {
    expect(parseLoginSearch({ redirect: "/brief" })).toEqual({ redirect: "/brief" });
    expect(parseLoginSearch({ redirect: "//evil.com" })).toEqual({ redirect: "/dashboard" });
  });
});

describe("sticky redirect fix (46da7b7) — rememberLoginRedirect", () => {
  it("an explicit ?redirect overrides a saved target", () => {
    stubBrowser();
    saveAuthRedirect("/audit?domain=old.sk");
    rememberLoginRedirect(parseLoginSearch({ redirect: "/brief" }).redirect);
    expect(consumeAuthRedirect()).toBe("/brief");
  });

  it("an absent ?redirect keeps the saved target (landing → /login?mode=signup)", () => {
    stubBrowser();
    saveAuthRedirect("/audit?domain=example.sk");
    rememberLoginRedirect(parseLoginSearch({ mode: "signup" }).redirect);
    expect(consumeAuthRedirect()).toBe("/audit?domain=example.sk");
  });

  it("empty or invalid input does not overwrite the saved target", () => {
    stubBrowser();
    saveAuthRedirect("/audit?domain=example.sk");
    rememberLoginRedirect(parseLoginSearch({ redirect: "" }).redirect);
    rememberLoginRedirect(parseLoginSearch({ redirect: null }).redirect);
    rememberLoginRedirect(parseLoginSearch({ redirect: 42 }).redirect);
    rememberLoginRedirect(undefined);
    expect(peekAuthRedirect()).toBe("/audit?domain=example.sk");
  });

  it("a bare /login visit with nothing saved stores nothing (falls back to /dashboard)", () => {
    stubBrowser();
    rememberLoginRedirect(parseLoginSearch({}).redirect);
    expect(peekAuthRedirect()).toBeNull();
    expect(consumeAuthRedirect()).toBe("/dashboard");
  });

  it("/login then /login?redirect=/brief ends on /brief", () => {
    stubBrowser();
    rememberLoginRedirect(parseLoginSearch({}).redirect);
    rememberLoginRedirect(parseLoginSearch({ redirect: "/brief" }).redirect);
    expect(consumeAuthRedirect()).toBe("/brief");
  });

  it("an unsafe explicit redirect is stored as the safe default, never as given", () => {
    stubBrowser();
    rememberLoginRedirect(parseLoginSearch({ redirect: "https://evil.example" }).redirect);
    expect(consumeAuthRedirect()).toBe("/dashboard");
  });

  it("does not throw without storage", () => {
    stubBrowser(false);
    expect(() => rememberLoginRedirect("/brief")).not.toThrow();
  });
});
