import { afterEach, describe, expect, it, vi } from "vitest";
import { getServerSupabasePublishableKey, getServerSupabaseUrl } from "./supabase-server-env";

const VALID_URL = "https://pwftbssvdbjoblmhdeax.supabase.co";

afterEach(() => {
  vi.unstubAllEnvs();
});

const clearAll = () => {
  vi.stubEnv("SUPABASE_URL", "");
  vi.stubEnv("VITE_SUPABASE_URL", "");
  vi.stubEnv("SUPABASE_PUBLISHABLE_KEY", "");
  vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "");
};

describe("getServerSupabaseUrl", () => {
  it("uses SUPABASE_URL when only SUPABASE_* is set", () => {
    clearAll();
    vi.stubEnv("SUPABASE_URL", VALID_URL);
    expect(getServerSupabaseUrl()).toBe(VALID_URL);
  });

  it("falls back to VITE_SUPABASE_URL when only VITE_* is set", () => {
    clearAll();
    vi.stubEnv("VITE_SUPABASE_URL", VALID_URL);
    expect(getServerSupabaseUrl()).toBe(VALID_URL);
  });

  it("prefers SUPABASE_URL when both are set", () => {
    clearAll();
    vi.stubEnv("SUPABASE_URL", VALID_URL);
    vi.stubEnv("VITE_SUPABASE_URL", "https://other.supabase.co");
    expect(getServerSupabaseUrl()).toBe(VALID_URL);
  });

  it("treats empty/whitespace values as missing and falls back", () => {
    clearAll();
    vi.stubEnv("SUPABASE_URL", "   ");
    vi.stubEnv("VITE_SUPABASE_URL", ` ${VALID_URL} `);
    expect(getServerSupabaseUrl()).toBe(VALID_URL);
  });

  it("throws when both are missing, without leaking any value", () => {
    clearAll();
    expect(() => getServerSupabaseUrl()).toThrow(/nie je nakonfigurovaná/);
    try {
      getServerSupabaseUrl();
      expect.unreachable();
    } catch (e) {
      expect((e as Error).message).not.toContain("supabase.co");
    }
  });

  it("rejects non-https URLs", () => {
    clearAll();
    vi.stubEnv("SUPABASE_URL", "http://pwftbssvdbjoblmhdeax.supabase.co");
    expect(() => getServerSupabaseUrl()).toThrow(/https/);
  });

  it("rejects hosts that are not *.supabase.co", () => {
    clearAll();
    vi.stubEnv("VITE_SUPABASE_URL", "https://evil.example.com");
    expect(() => getServerSupabaseUrl()).toThrow(/supabase\.co/);
  });

  it("rejects malformed URLs", () => {
    clearAll();
    vi.stubEnv("SUPABASE_URL", "not a url");
    expect(() => getServerSupabaseUrl()).toThrow();
  });
});

describe("getServerSupabasePublishableKey", () => {
  it("uses SUPABASE_PUBLISHABLE_KEY when only SUPABASE_* is set", () => {
    clearAll();
    vi.stubEnv("SUPABASE_PUBLISHABLE_KEY", "sb_publishable_aaa");
    expect(getServerSupabasePublishableKey()).toBe("sb_publishable_aaa");
  });

  it("falls back to VITE_SUPABASE_PUBLISHABLE_KEY", () => {
    clearAll();
    vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_bbb");
    expect(getServerSupabasePublishableKey()).toBe("sb_publishable_bbb");
  });

  it("prefers SUPABASE_PUBLISHABLE_KEY when both are set", () => {
    clearAll();
    vi.stubEnv("SUPABASE_PUBLISHABLE_KEY", "sb_publishable_aaa");
    vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_bbb");
    expect(getServerSupabasePublishableKey()).toBe("sb_publishable_aaa");
  });

  it("treats whitespace as missing", () => {
    clearAll();
    vi.stubEnv("SUPABASE_PUBLISHABLE_KEY", "  ");
    expect(() => getServerSupabasePublishableKey()).toThrow(/nie je nakonfigurovaný/);
  });

  it("throws when missing, without leaking values", () => {
    clearAll();
    vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_secret_value");
    vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "");
    try {
      getServerSupabasePublishableKey();
      expect.unreachable();
    } catch (e) {
      expect((e as Error).message).not.toContain("sb_publishable");
    }
  });
});
