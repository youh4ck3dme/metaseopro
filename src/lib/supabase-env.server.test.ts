import { afterEach, describe, expect, it, vi } from "vitest";
import { getServerSupabasePublishableKey, getServerSupabaseUrl } from "./supabase-env.server";
import { requireUser } from "./api-auth.server";

const KEYS = [
  "SUPABASE_URL",
  "SUPABASE_PUBLISHABLE_KEY",
  "VITE_SUPABASE_URL",
  "VITE_SUPABASE_PUBLISHABLE_KEY",
] as const;

function clearAll() {
  for (const k of KEYS) vi.stubEnv(k, "");
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("getServerSupabaseUrl / getServerSupabasePublishableKey (server env fallback)", () => {
  it("SUPABASE_* wins when set", () => {
    clearAll();
    vi.stubEnv("SUPABASE_URL", "https://server.example.test");
    vi.stubEnv("VITE_SUPABASE_URL", "https://vite.example.test");
    vi.stubEnv("SUPABASE_PUBLISHABLE_KEY", "server-key");
    vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "vite-key");
    expect(getServerSupabaseUrl()).toBe("https://server.example.test");
    expect(getServerSupabasePublishableKey()).toBe("server-key");
  });

  it("falls back to VITE_SUPABASE_* when SUPABASE_* is unset", () => {
    clearAll();
    vi.stubEnv("VITE_SUPABASE_URL", "https://vite.example.test");
    vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "vite-key");
    expect(getServerSupabaseUrl()).toBe("https://vite.example.test");
    expect(getServerSupabasePublishableKey()).toBe("vite-key");
  });

  it("treats empty / whitespace SUPABASE_* as unset and falls back", () => {
    clearAll();
    vi.stubEnv("SUPABASE_URL", "   ");
    vi.stubEnv("SUPABASE_PUBLISHABLE_KEY", "");
    vi.stubEnv("VITE_SUPABASE_URL", "https://vite.example.test");
    vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "vite-key");
    expect(getServerSupabaseUrl()).toBe("https://vite.example.test");
    expect(getServerSupabasePublishableKey()).toBe("vite-key");
  });

  it("returns undefined when both are missing (callers fail closed)", () => {
    clearAll();
    expect(getServerSupabaseUrl()).toBeUndefined();
    expect(getServerSupabasePublishableKey()).toBeUndefined();
  });

  it("only one of the pair set → the other stays undefined (no cross-mixing)", () => {
    clearAll();
    vi.stubEnv("VITE_SUPABASE_URL", "https://vite.example.test");
    expect(getServerSupabaseUrl()).toBe("https://vite.example.test");
    expect(getServerSupabasePublishableKey()).toBeUndefined();
  });
});

describe("requireUser (api-auth.server) config handling", () => {
  const req = new Request("https://app.test/api/x", {
    headers: { authorization: "Bearer abc" },
  });

  it("missing both SUPABASE_* and VITE_SUPABASE_* → existing 500 'not configured' error", async () => {
    clearAll();
    const r = await requireUser(req);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.response.status).toBe(500);
      const body = await r.response.json();
      expect(body).toEqual({ error: "Server nie je správne nakonfigurovaný." });
    }
  });

  it("with only VITE_SUPABASE_* set the config check passes (no 500; proceeds to token check)", async () => {
    clearAll();
    vi.stubEnv("VITE_SUPABASE_URL", "https://vite.example.test");
    vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "vite-key");
    const noAuth = new Request("https://app.test/api/x");
    const r = await requireUser(noAuth);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.response.status).toBe(401);
  });
});

// NOTE: under vitest import.meta.env is an alias of process.env, so these tests cover
// precedence/trim/empty handling only. That the build really inlines the third step is
// proven in supabase-env.build-inline.test.ts (real Vite build, empty runtime env).
describe("import.meta.env.VITE_* build-time fallback (third step)", () => {
  const meta = import.meta.env as Record<string, string | undefined>;
  const saved = {
    url: meta.VITE_SUPABASE_URL,
    key: meta.VITE_SUPABASE_PUBLISHABLE_KEY,
  };

  function setMeta(url: string | undefined, key: string | undefined) {
    meta.VITE_SUPABASE_URL = url;
    meta.VITE_SUPABASE_PUBLISHABLE_KEY = key;
  }

  afterEach(() => {
    meta.VITE_SUPABASE_URL = saved.url;
    meta.VITE_SUPABASE_PUBLISHABLE_KEY = saved.key;
  });

  it("used when SUPABASE_* and process.env.VITE_* are all unset", () => {
    clearAll();
    setMeta("https://meta.example.test", "meta-key");
    expect(getServerSupabaseUrl()).toBe("https://meta.example.test");
    expect(getServerSupabasePublishableKey()).toBe("meta-key");
  });

  it("process.env.VITE_* wins over import.meta.env", () => {
    clearAll();
    setMeta("https://meta.example.test", "meta-key");
    vi.stubEnv("VITE_SUPABASE_URL", "https://vite.example.test");
    vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "vite-key");
    expect(getServerSupabaseUrl()).toBe("https://vite.example.test");
    expect(getServerSupabasePublishableKey()).toBe("vite-key");
  });

  it("SUPABASE_* wins over import.meta.env", () => {
    clearAll();
    setMeta("https://meta.example.test", "meta-key");
    vi.stubEnv("SUPABASE_URL", "https://server.example.test");
    vi.stubEnv("SUPABASE_PUBLISHABLE_KEY", "server-key");
    expect(getServerSupabaseUrl()).toBe("https://server.example.test");
    expect(getServerSupabasePublishableKey()).toBe("server-key");
  });

  it("empty / whitespace import.meta.env counts as unset (fail closed)", () => {
    clearAll();
    setMeta("   ", "");
    expect(getServerSupabaseUrl()).toBeUndefined();
    expect(getServerSupabasePublishableKey()).toBeUndefined();
  });

  it("returned values are trimmed (every step)", () => {
    clearAll();
    vi.stubEnv("SUPABASE_URL", "  https://server.example.test \n");
    expect(getServerSupabaseUrl()).toBe("https://server.example.test");
    clearAll();
    vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "\tvite-key  ");
    expect(getServerSupabasePublishableKey()).toBe("vite-key");
    clearAll();
    setMeta("  https://meta.example.test  ", " meta-key ");
    expect(getServerSupabaseUrl()).toBe("https://meta.example.test");
    expect(getServerSupabasePublishableKey()).toBe("meta-key");
  });
});
