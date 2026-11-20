import { afterEach, describe, expect, it, vi } from "vitest";
import { handleAuthStateEvent } from "./auth-events";
import { peekAuthRedirect, saveAuthRedirect } from "./safe-auth-redirect";

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
};

describe("handleAuthStateEvent", () => {
  it("clears the stored redirect on SIGNED_OUT", () => {
    stubBrowser();
    saveAuthRedirect("/audit?domain=example.sk");
    handleAuthStateEvent("SIGNED_OUT");
    expect(peekAuthRedirect()).toBeNull();
  });

  it.each(["INITIAL_SESSION", "SIGNED_IN", "TOKEN_REFRESHED", "USER_UPDATED", "PASSWORD_RECOVERY"])(
    "keeps the stored redirect on %s",
    (event) => {
      stubBrowser();
      saveAuthRedirect("/audit?domain=example.sk");
      handleAuthStateEvent(event);
      expect(peekAuthRedirect()).toBe("/audit?domain=example.sk");
    },
  );

  it("does not throw without a window", () => {
    vi.stubGlobal("window", undefined);
    expect(() => handleAuthStateEvent("SIGNED_OUT")).not.toThrow();
  });
});
