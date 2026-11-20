import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getClaims = vi.fn();
vi.mock("@supabase/supabase-js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@supabase/supabase-js")>();
  return {
    ...actual,
    createClient: (...args: Parameters<typeof actual.createClient>) => {
      const client = actual.createClient(...args);
      if (mockClaims) {
        (client.auth as unknown as { getClaims: typeof getClaims }).getClaims = getClaims;
      }
      return client;
    },
  };
});

let mockClaims = true;

import { requireUser } from "./api-auth.server";

const req = (authorization?: string) =>
  new Request("https://example.test/api/x", {
    headers: authorization ? { authorization } : {},
  });

async function expect401(result: Awaited<ReturnType<typeof requireUser>>) {
  expect(result.ok).toBe(false);
  if (result.ok) return;
  expect(result.response.status).toBe(401);
  expect(result.response.headers.get("Content-Type")).toBe("application/json");
  expect(await result.response.json()).toEqual({ error: "Vyžaduje sa prihlásenie." });
}

describe("requireUser (getClaims hardening)", () => {
  beforeEach(() => {
    mockClaims = true;
    getClaims.mockReset();
    vi.stubEnv("SUPABASE_URL", "https://example.invalid");
    vi.stubEnv("SUPABASE_PUBLISHABLE_KEY", "sb_publishable_test_key");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("missing/non-bearer header -> 401 without calling getClaims", async () => {
    await expect401(await requireUser(req()));
    await expect401(await requireUser(req("Basic abc")));
    await expect401(await requireUser(req("Bearer   ")));
    expect(getClaims).not.toHaveBeenCalled();
  });

  it("malformed JWT-shaped token (real getClaims) -> 401, does not throw", async () => {
    mockClaims = false;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect401(await requireUser(req("Bearer fake.fake.fake")));
    // never logs the token
    expect(JSON.stringify(warn.mock.calls)).not.toContain("fake.fake.fake");
  });

  it("getClaims throwing -> 401 and no error detail leaked", async () => {
    getClaims.mockRejectedValue(new Error("SECRET-DETAIL token=abc.def.ghi"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    // expect401 asserts the body is exactly the standard message (no detail).
    await expect401(await requireUser(req("Bearer abc.def.ghi")));
    const logged = JSON.stringify(warn.mock.calls);
    expect(logged).not.toContain("SECRET-DETAIL");
    expect(logged).not.toContain("abc.def.ghi");
  });

  it("getClaims throwing a non-Error value -> 401", async () => {
    getClaims.mockImplementation(() => {
      throw "boom";
    });
    await expect401(await requireUser(req("Bearer a.b.c")));
  });

  it("getClaims returning error -> 401", async () => {
    getClaims.mockResolvedValue({ data: null, error: { message: "invalid jwt" } });
    await expect401(await requireUser(req("Bearer a.b.c")));
  });

  it("getClaims returning no sub -> 401", async () => {
    getClaims.mockResolvedValue({ data: { claims: {} }, error: null });
    await expect401(await requireUser(req("Bearer a.b.c")));
  });

  it("valid claims still pass", async () => {
    getClaims.mockResolvedValue({
      data: {
        claims: {
          sub: "user-123",
          email: "u@example.test",
          email_confirmed_at: "2026-01-01T00:00:00Z",
          email_verified: true,
        },
      },
      error: null,
    });
    const result = await requireUser(req("Bearer good.token.here"));
    expect(result).toEqual({
      ok: true,
      userId: "user-123",
      email: "u@example.test",
    });
    expect(getClaims).toHaveBeenCalledWith("good.token.here");
  });

  it("missing server config still returns 500 (not masked as 401)", async () => {
    vi.stubEnv("SUPABASE_URL", "");
    vi.stubEnv("VITE_SUPABASE_URL", "");
    const result = await requireUser(req("Bearer a.b.c"));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(500);
  });
});
