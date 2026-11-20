import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  checkViewerRateLimit,
  getViewerPlan,
  hasViewerPaidAccess,
  isUnlimited,
  resolveViewerRole,
} from "./viewer-role.server";

const ADMIN_ID = "00000000-0000-4000-8000-0000000000aa";
const USER_ID = "00000000-0000-4000-8000-0000000000bb";
const NOW = Date.parse("2026-11-17T12:00:00.000Z");
const ACTIVE_PRO = {
  plan: "pro",
  status: "active",
  current_period_end: "2026-12-17T12:00:00.000Z",
};

beforeEach(() => {
  vi.stubEnv("ADMIN_USER_IDS", "");
  vi.stubEnv("ADMIN_EMAILS", "");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("superadmin gate (ADMIN_USER_IDS only, fail-closed)", () => {
  it("admin by ID is unlimited and gets the 'admin' plan without a subscription", () => {
    vi.stubEnv("ADMIN_USER_IDS", ` other-id , ${ADMIN_ID} `);
    expect(isUnlimited({ id: ADMIN_ID })).toBe(true);
    expect(getViewerPlan({ id: ADMIN_ID }, null, NOW)).toBe("admin");
    expect(resolveViewerRole({ id: ADMIN_ID }, null, NOW)).toEqual({
      isAdmin: true,
      plan: "admin",
    });
    expect(hasViewerPaidAccess({ id: ADMIN_ID }, null, NOW)).toBe(true);
  });

  it("non-admin is not unlimited and keeps the subscription policy plan", () => {
    vi.stubEnv("ADMIN_USER_IDS", ADMIN_ID);
    expect(isUnlimited({ id: USER_ID })).toBe(false);
    expect(resolveViewerRole({ id: USER_ID }, null, NOW)).toEqual({ isAdmin: false, plan: "free" });
    expect(resolveViewerRole({ id: USER_ID }, ACTIVE_PRO, NOW)).toEqual({
      isAdmin: false,
      plan: "pro",
    });
    expect(hasViewerPaidAccess({ id: USER_ID }, null, NOW)).toBe(false);
    expect(hasViewerPaidAccess({ id: USER_ID }, ACTIVE_PRO, NOW)).toBe(true);
  });

  it("ignores user_metadata role spoofing", () => {
    vi.stubEnv("ADMIN_USER_IDS", ADMIN_ID);
    const spoof = { id: USER_ID, user_metadata: { role: "admin", is_admin: true } };
    expect(isUnlimited(spoof)).toBe(false);
    expect(resolveViewerRole(spoof, null, NOW).isAdmin).toBe(false);
  });

  it("ignores app_metadata role spoofing", () => {
    vi.stubEnv("ADMIN_USER_IDS", ADMIN_ID);
    const spoof = { id: USER_ID, app_metadata: { role: "admin", roles: ["superadmin"] } };
    expect(isUnlimited(spoof)).toBe(false);
  });

  it("never grants admin via a verified email in ADMIN_EMAILS (IDs configured)", () => {
    vi.stubEnv("ADMIN_USER_IDS", ADMIN_ID);
    vi.stubEnv("ADMIN_EMAILS", "owner@example.com");
    const viaEmail = { id: USER_ID, email: "owner@example.com", email_verified: true };
    expect(isUnlimited(viaEmail)).toBe(false);
  });

  it("never grants admin via a verified email in ADMIN_EMAILS (IDs unset)", () => {
    vi.stubEnv("ADMIN_EMAILS", "owner@example.com");
    const viaEmail = {
      id: USER_ID,
      email: "owner@example.com",
      email_verified: true,
      email_confirmed_at: "2026-01-01T00:00:00.000Z",
    };
    expect(isUnlimited(viaEmail)).toBe(false);
    expect(getViewerPlan(viaEmail, null, NOW)).toBe("free");
  });

  it("treats nobody as admin when ADMIN_USER_IDS is empty, blank or unset", () => {
    for (const value of ["", " ", " , ,"]) {
      vi.stubEnv("ADMIN_USER_IDS", value);
      expect(isUnlimited({ id: ADMIN_ID })).toBe(false);
    }
    vi.unstubAllEnvs();
    const original = process.env.ADMIN_USER_IDS;
    delete process.env.ADMIN_USER_IDS;
    try {
      expect(isUnlimited({ id: ADMIN_ID })).toBe(false);
    } finally {
      if (original !== undefined) process.env.ADMIN_USER_IDS = original;
    }
  });

  it("fails closed for a missing user or id", () => {
    vi.stubEnv("ADMIN_USER_IDS", ADMIN_ID);
    expect(isUnlimited(null)).toBe(false);
    expect(isUnlimited(undefined)).toBe(false);
    expect(isUnlimited({})).toBe(false);
    expect(isUnlimited({ id: "" })).toBe(false);
    expect(isUnlimited({ id: "   " })).toBe(false);
    expect(isUnlimited({ id: 42 as unknown as string })).toBe(false);
  });
});

describe("checkViewerRateLimit (single admin bypass for per-user limits)", () => {
  it("admin bypasses the per-user limit", () => {
    vi.stubEnv("ADMIN_USER_IDS", ADMIN_ID);
    const key = `sa-test-admin:${Date.now()}`;
    for (let i = 0; i < 10; i++) {
      expect(checkViewerRateLimit({ id: ADMIN_ID }, key, { limit: 2, windowMs: 60_000 })).toEqual({
        ok: true,
      });
    }
  });

  it("admin is never rate-limited, even far above 10x the limit (intentional: Erik 2026-11-17)", () => {
    vi.stubEnv("ADMIN_USER_IDS", ADMIN_ID);
    const key = `sa-test-admin-nocap:${Date.now()}`;
    const opts = { limit: 2, windowMs: 60_000 };
    for (let i = 0; i < opts.limit * 10 * 5; i++) {
      expect(checkViewerRateLimit({ id: ADMIN_ID }, key, opts)).toEqual({ ok: true });
    }
    // The bypass must not consume the shared bucket: a regular user on the same key still gets the full limit.
    expect(checkViewerRateLimit({ id: USER_ID }, key, opts).ok).toBe(true);
    expect(checkViewerRateLimit({ id: USER_ID }, key, opts).ok).toBe(true);
    expect(checkViewerRateLimit({ id: USER_ID }, key, opts).ok).toBe(false);
  });

  it("regular user keeps exactly the existing limit", () => {
    vi.stubEnv("ADMIN_USER_IDS", ADMIN_ID);
    const key = `sa-test-user:${Date.now()}`;
    const opts = { limit: 2, windowMs: 60_000 };
    expect(checkViewerRateLimit({ id: USER_ID }, key, opts).ok).toBe(true);
    expect(checkViewerRateLimit({ id: USER_ID }, key, opts).ok).toBe(true);
    expect(checkViewerRateLimit({ id: USER_ID }, key, opts).ok).toBe(false);
  });
});
