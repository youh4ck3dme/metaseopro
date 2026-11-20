import { afterEach, describe, expect, it, vi } from "vitest";
import { startAuditEntry } from "./audit-entry";
import { consumeAuthRedirect, peekAuthRedirect } from "./safe-auth-redirect";

afterEach(() => {
  vi.unstubAllGlobals();
});

const stubBrowser = () => {
  const store = new Map<string, string>();
  vi.stubGlobal("window", {
    location: { origin: "https://metaseopro.vercel.app", search: "" },
    sessionStorage: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    },
  });
  return store;
};

describe("startAuditEntry (#19 P3-1)", () => {
  it("signed in: goes to the audit and stores no auth redirect", () => {
    const store = stubBrowser();
    expect(
      startAuditEntry({ normalizedDomain: "example.sk", signedIn: true, loading: false }),
    ).toBe("/audit?domain=example.sk");
    expect(peekAuthRedirect()).toBeNull();
    expect(store.size).toBe(0);
  });

  it("signed in while loading flag is still set: still stores nothing", () => {
    stubBrowser();
    expect(startAuditEntry({ normalizedDomain: "example.sk", signedIn: true, loading: true })).toBe(
      "/audit?domain=example.sk",
    );
    expect(peekAuthRedirect()).toBeNull();
  });

  it("signed out: stores the audit target and opens sign-up", () => {
    stubBrowser();
    expect(
      startAuditEntry({ normalizedDomain: "example.sk", signedIn: false, loading: false }),
    ).toBe("/login?mode=signup");
    expect(consumeAuthRedirect()).toBe("/audit?domain=example.sk");
  });

  it("auth loading and signed out: does nothing and stores nothing", () => {
    stubBrowser();
    expect(
      startAuditEntry({ normalizedDomain: "example.sk", signedIn: false, loading: true }),
    ).toBeNull();
    expect(peekAuthRedirect()).toBeNull();
  });

  it("encodes the domain in the stored target", () => {
    stubBrowser();
    startAuditEntry({ normalizedDomain: "xn--mnchen-3ya.de", signedIn: false, loading: false });
    expect(consumeAuthRedirect()).toBe("/audit?domain=xn--mnchen-3ya.de");
  });
});
