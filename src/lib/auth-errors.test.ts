import { describe, expect, it } from "vitest";
import { mapAuthErrorKey, translateAuthError } from "./auth-errors";
import { t } from "./i18n";

const ENGLISH_LEAK =
  /invalid login credentials|user already registered|email not confirmed|password should be at least|rate limit exceeded|unable to validate email address|unexpected_failure|AuthApiError/i;

describe("mapAuthErrorKey", () => {
  it("maps known Supabase codes", () => {
    expect(mapAuthErrorKey({ code: "invalid_credentials" })).toBe(
      "login.authError.invalidCredentials",
    );
    expect(mapAuthErrorKey({ code: "user_already_exists" })).toBe(
      "login.authError.alreadyRegistered",
    );
    expect(mapAuthErrorKey({ code: "email_not_confirmed" })).toBe(
      "login.authError.emailNotConfirmed",
    );
    expect(mapAuthErrorKey({ code: "weak_password" })).toBe("login.authError.passwordTooShort");
    expect(mapAuthErrorKey({ code: "over_email_send_rate_limit" })).toBe(
      "login.authError.rateLimit",
    );
  });

  it("maps known English messages, case-insensitively", () => {
    expect(mapAuthErrorKey("Invalid login credentials")).toBe("login.authError.invalidCredentials");
    expect(mapAuthErrorKey(new Error("User already registered"))).toBe(
      "login.authError.alreadyRegistered",
    );
    expect(mapAuthErrorKey({ message: "Email not confirmed" })).toBe(
      "login.authError.emailNotConfirmed",
    );
    expect(mapAuthErrorKey("Password should be at least 6 characters")).toBe(
      "login.authError.passwordTooShort",
    );
    expect(mapAuthErrorKey("Unable to validate email address: invalid format")).toBe(
      "login.authError.invalidEmail",
    );
    expect(mapAuthErrorKey("Email rate limit exceeded")).toBe("login.authError.rateLimit");
    expect(
      mapAuthErrorKey("For security purposes, you can only request this after 12 seconds."),
    ).toBe("login.authError.rateLimit");
  });

  it("falls back to the generic key for unknown or empty errors", () => {
    expect(mapAuthErrorKey("unexpected_failure from gotrue")).toBe("login.authError.generic");
    expect(mapAuthErrorKey(undefined)).toBe("login.authError.generic");
    expect(mapAuthErrorKey(null)).toBe("login.authError.generic");
    expect(mapAuthErrorKey({})).toBe("login.authError.generic");
  });
});

describe("translateAuthError", () => {
  it("returns Slovak copy for known errors and never leaks the English source", () => {
    const cases = [
      "Invalid login credentials",
      "User already registered",
      "Email not confirmed",
      "Password should be at least 8 characters",
      "Email rate limit exceeded",
      "unexpected_failure from gotrue",
    ];
    for (const raw of cases) {
      const translated = translateAuthError(raw, "sk");
      expect(translated.length).toBeGreaterThan(0);
      expect(translated).not.toMatch(ENGLISH_LEAK);
      expect(translated).not.toBe(raw);
    }
    expect(translateAuthError("Invalid login credentials", "sk")).toBe(
      t("sk", "login.authError.invalidCredentials"),
    );
    expect(translateAuthError("mystery", "sk")).toBe(t("sk", "login.authError.generic"));
  });
});
