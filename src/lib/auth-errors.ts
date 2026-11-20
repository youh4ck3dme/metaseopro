import { t, type Locale } from "@/lib/i18n";

type AuthErrorKey =
  | "login.authError.invalidCredentials"
  | "login.authError.alreadyRegistered"
  | "login.authError.emailNotConfirmed"
  | "login.authError.passwordTooShort"
  | "login.authError.invalidEmail"
  | "login.authError.rateLimit"
  | "login.authError.generic";

const CODE_MAP: Record<string, AuthErrorKey> = {
  invalid_credentials: "login.authError.invalidCredentials",
  email_not_confirmed: "login.authError.emailNotConfirmed",
  user_already_exists: "login.authError.alreadyRegistered",
  email_exists: "login.authError.alreadyRegistered",
  weak_password: "login.authError.passwordTooShort",
  over_email_send_rate_limit: "login.authError.rateLimit",
  over_request_rate_limit: "login.authError.rateLimit",
  email_rate_limit_exceeded: "login.authError.rateLimit",
};

function extractMessage(error: unknown): string {
  if (typeof error === "string") return error;
  if (error instanceof Error && error.message) return error.message;
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message: unknown }).message;
    if (typeof message === "string") return message;
  }
  return "";
}

function extractCode(error: unknown): string {
  if (error && typeof error === "object" && "code" in error) {
    const code = (error as { code: unknown }).code;
    if (typeof code === "string") return code;
  }
  return "";
}

/** Maps a Supabase Auth error code or English message to an i18n key. */
export function mapAuthErrorKey(error: unknown): AuthErrorKey {
  const code = extractCode(error).trim().toLowerCase();
  if (code && CODE_MAP[code]) return CODE_MAP[code];

  const message = extractMessage(error).trim().toLowerCase();
  if (!message) return "login.authError.generic";

  if (message.includes("invalid login credentials") || message.includes("invalid credentials")) {
    return "login.authError.invalidCredentials";
  }
  if (
    message.includes("user already registered") ||
    message.includes("user already exists") ||
    message.includes("already registered") ||
    message.includes("email already")
  ) {
    return "login.authError.alreadyRegistered";
  }
  if (message.includes("email not confirmed")) {
    return "login.authError.emailNotConfirmed";
  }
  if (
    message.includes("password should be at least") ||
    message.includes("password is too short") ||
    message.includes("password is known to be weak")
  ) {
    return "login.authError.passwordTooShort";
  }
  if (message.includes("unable to validate email address") || message.includes("invalid email")) {
    return "login.authError.invalidEmail";
  }
  if (
    message.includes("rate limit") ||
    message.includes("too many requests") ||
    message.includes("for security purposes, you can only request this after")
  ) {
    return "login.authError.rateLimit";
  }

  return "login.authError.generic";
}

/**
 * Returns a localized auth error. Unknown or raw English Supabase messages
 * fall back to a generic copy and are never shown as-is.
 */
export function translateAuthError(error: unknown, locale: Locale = "sk"): string {
  return t(locale, mapAuthErrorKey(error));
}
