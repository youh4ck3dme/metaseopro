/**
 * Log hygiene helpers: customer e-mail addresses must never reach server logs.
 * Log a userId, or at most the masked form produced by maskEmail().
 */

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g;

/** "jan.novak@example.sk" -> "j***@e***". Never throws; non-emails become "***". */
export function maskEmail(email: unknown): string {
  if (typeof email !== "string") return "***";
  const at = email.indexOf("@");
  if (at < 1 || at === email.length - 1) return "***";
  return `${email[0]}***@${email[at + 1]}***`;
}

/** Upper bound for text that goes through the e-mail regex (keeps worst-case cost small). */
export const MAX_REDACT_INPUT = 4096;

/**
 * Replaces every e-mail address found in free text (provider error bodies, error messages).
 * Input is truncated to MAX_REDACT_INPUT characters first, so the output is bounded as well.
 */
export function redactEmails(text: string): string {
  const input = typeof text === "string" ? text : String(text);
  const bounded =
    input.length > MAX_REDACT_INPUT ? `${input.slice(0, MAX_REDACT_INPUT)}…[truncated]` : input;
  return bounded.replace(EMAIL_RE, "[redacted-email]");
}

/**
 * Safe representation of an unknown error for logs: message only, e-mails redacted.
 * Never throws (Object.create(null), throwing toString/getters, symbols, etc.).
 */
export function safeErrorForLog(err: unknown): string {
  try {
    const msg = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    return redactEmails(msg);
  } catch {
    return "[unloggable error]";
  }
}
