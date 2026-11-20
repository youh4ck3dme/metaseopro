import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createClient: vi.fn((..._args: unknown[]) => ({ auth: { getClaims: vi.fn() } })),
  getRequest: vi.fn(() => undefined as { headers: Headers } | undefined),
}));

vi.mock("@supabase/supabase-js", () => ({ createClient: mocks.createClient }));
vi.mock("@tanstack/react-start/server", () => ({ getRequest: mocks.getRequest }));
vi.mock("@tanstack/react-start", () => ({
  createMiddleware: () => ({
    server: (fn: (ctx: { next: (x: unknown) => unknown }) => Promise<unknown>) => ({ run: fn }),
  }),
}));

const ENV_KEYS = [
  "SUPABASE_URL",
  "SUPABASE_PUBLISHABLE_KEY",
  "VITE_SUPABASE_URL",
  "VITE_SUPABASE_PUBLISHABLE_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
] as const;

beforeEach(() => {
  for (const k of ENV_KEYS) vi.stubEnv(k, "");
  mocks.createClient.mockClear();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

async function runMiddleware() {
  const { requireSupabaseAuth } =
    (await import("@/integrations/supabase/auth-middleware")) as unknown as {
      requireSupabaseAuth: { run: (ctx: { next: (x: unknown) => unknown }) => Promise<unknown> };
    };
  return requireSupabaseAuth.run({ next: (x) => x });
}

describe("auth-middleware env fallback (SUPABASE_* → VITE_SUPABASE_*)", () => {
  it("missing both → existing 'Missing Supabase environment variable(s)' error naming SUPABASE_* (no values)", async () => {
    await expect(runMiddleware()).rejects.toThrow(
      "Missing Supabase environment variable(s): SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY.",
    );
    expect(mocks.createClient).not.toHaveBeenCalled();
  });

  it("only VITE_* set → config check passes (proceeds to the request/auth checks)", async () => {
    vi.stubEnv("VITE_SUPABASE_URL", "https://vite.example.test");
    vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "vite-key");
    await expect(runMiddleware()).rejects.toThrow("Unauthorized: No request headers available");
  });

  it("empty SUPABASE_* + VITE_* set → falls back (empty = unset)", async () => {
    vi.stubEnv("SUPABASE_URL", "  ");
    vi.stubEnv("SUPABASE_PUBLISHABLE_KEY", "");
    vi.stubEnv("VITE_SUPABASE_URL", "https://vite.example.test");
    vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "vite-key");
    await expect(runMiddleware()).rejects.toThrow("Unauthorized: No request headers available");
  });

  it("only one of the pair set → still fails closed, naming only the missing one", async () => {
    vi.stubEnv("VITE_SUPABASE_URL", "https://vite.example.test");
    await expect(runMiddleware()).rejects.toThrow(
      "Missing Supabase environment variable(s): SUPABASE_PUBLISHABLE_KEY.",
    );
  });

  it("SUPABASE_* wins over VITE_* when building the client", async () => {
    vi.stubEnv("SUPABASE_URL", "https://server.example.test");
    vi.stubEnv("SUPABASE_PUBLISHABLE_KEY", "server-key");
    vi.stubEnv("VITE_SUPABASE_URL", "https://vite.example.test");
    vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "vite-key");
    mocks.getRequest.mockReturnValueOnce({ headers: new Headers({ authorization: "Bearer tok" }) });
    await runMiddleware().catch(() => {});
    expect(mocks.createClient).toHaveBeenCalledTimes(1);
    expect(mocks.createClient.mock.calls[0]?.[0]).toBe("https://server.example.test");
    expect(mocks.createClient.mock.calls[0]?.[1]).toBe("server-key");
  });

  it("falls back to VITE_* when building the client", async () => {
    vi.stubEnv("VITE_SUPABASE_URL", "https://vite.example.test");
    vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "vite-key");
    mocks.getRequest.mockReturnValueOnce({ headers: new Headers({ authorization: "Bearer tok" }) });
    await runMiddleware().catch(() => {});
    expect(mocks.createClient.mock.calls[0]?.[0]).toBe("https://vite.example.test");
    expect(mocks.createClient.mock.calls[0]?.[1]).toBe("vite-key");
  });
});

describe("client.server (supabaseAdmin) env fallback for the URL", () => {
  async function touchAdmin() {
    vi.resetModules();
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    return (supabaseAdmin as unknown as { auth: unknown }).auth;
  }

  it("missing URL (both) → existing error naming SUPABASE_URL", async () => {
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-key");
    await expect(touchAdmin()).rejects.toThrow(
      "Missing Supabase environment variable(s): SUPABASE_URL.",
    );
  });

  it("missing service key → still fails closed even when the URL falls back from VITE_*", async () => {
    vi.stubEnv("VITE_SUPABASE_URL", "https://vite.example.test");
    await expect(touchAdmin()).rejects.toThrow(
      "Missing Supabase environment variable(s): SUPABASE_SERVICE_ROLE_KEY.",
    );
  });

  it("only VITE_SUPABASE_URL set (+ service key) → client is created with the VITE_ URL", async () => {
    vi.stubEnv("VITE_SUPABASE_URL", "https://vite.example.test");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-key");
    await touchAdmin();
    expect(mocks.createClient.mock.calls[0]?.[0]).toBe("https://vite.example.test");
    expect(mocks.createClient.mock.calls[0]?.[1]).toBe("service-key");
  });

  it("SUPABASE_URL wins over VITE_SUPABASE_URL", async () => {
    vi.stubEnv("SUPABASE_URL", "https://server.example.test");
    vi.stubEnv("VITE_SUPABASE_URL", "https://vite.example.test");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-key");
    await touchAdmin();
    expect(mocks.createClient.mock.calls[0]?.[0]).toBe("https://server.example.test");
  });
});
