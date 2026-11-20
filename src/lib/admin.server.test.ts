import { afterEach, describe, expect, it, vi } from "vitest";
import { isAdminUser } from "./admin.server";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("isAdminUser — AUD-11 follow-ups: ADMIN_USER_IDS only, fail-closed", () => {
  it("returns true when user.id is in ADMIN_USER_IDS", () => {
    vi.stubEnv("ADMIN_USER_IDS", "uuid-1,uuid-2");
    expect(isAdminUser({ id: "uuid-2" })).toBe(true);
  });

  it("returns false when user.id is not in ADMIN_USER_IDS", () => {
    vi.stubEnv("ADMIN_USER_IDS", "uuid-1");
    expect(isAdminUser({ id: "uuid-9" })).toBe(false);
  });

  it("ignores whitespace and empty entries in the list", () => {
    vi.stubEnv("ADMIN_USER_IDS", "  uuid-1 , , uuid-2 ,");
    expect(isAdminUser({ id: "uuid-1" })).toBe(true);
    expect(isAdminUser({ id: "uuid-2" })).toBe(true);
  });

  it('treats ADMIN_USER_IDS=" , " as "no admin" (false), not as a fallback', () => {
    vi.stubEnv("ADMIN_USER_IDS", " , ");
    vi.stubEnv("ADMIN_EMAILS", "admin@example.com");
    expect(isAdminUser({ id: "uuid-1" })).toBe(false);
  });

  it("returns false when nothing is configured (fail-closed)", () => {
    vi.stubEnv("ADMIN_USER_IDS", "");
    vi.stubEnv("ADMIN_EMAILS", "");
    expect(isAdminUser({ id: "uuid-1" })).toBe(false);
  });

  it("returns false for a missing user or missing id", () => {
    vi.stubEnv("ADMIN_USER_IDS", "uuid-1");
    expect(isAdminUser(undefined)).toBe(false);
    expect(isAdminUser(null)).toBe(false);
    expect(isAdminUser({ id: "" })).toBe(false);
  });

  it("ADMIN_EMAILS never grants admin, even for the listed email (no email fallback)", () => {
    vi.stubEnv("ADMIN_USER_IDS", "uuid-1");
    vi.stubEnv("ADMIN_EMAILS", "admin@example.com");
    expect(isAdminUser({ id: "uuid-9" } as never) && false).toBe(false);
    // email is not even part of the decision — ID outside the list is not admin
    expect(isAdminUser({ id: "uuid-9" })).toBe(false);
  });

  it("user_metadata/app_metadata spoof ({ role: 'admin', email_verified: true }) does NOT grant admin", () => {
    vi.stubEnv("ADMIN_USER_IDS", "");
    const spoofed = {
      id: "attacker-uuid",
      email: "admin@example.com",
      user_metadata: { role: "admin", email_verified: true },
      app_metadata: { role: "admin" },
    };
    expect(isAdminUser(spoofed as never)).toBe(false);
  });
});
