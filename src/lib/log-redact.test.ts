import { describe, expect, it } from "vitest";
import { MAX_REDACT_INPUT, maskEmail, redactEmails, safeErrorForLog } from "./log-redact";

describe("log-redact", () => {
  it("masks e-mail addresses", () => {
    expect(maskEmail("jan.novak@example.sk")).toBe("j***@e***");
    expect(maskEmail("")).toBe("***");
    expect(maskEmail("no-at-sign")).toBe("***");
    expect(maskEmail(undefined)).toBe("***");
  });

  it("redacts every e-mail inside free text", () => {
    const out = redactEmails('{"error":"invalid to a.b+c@firma.example.sk and x@y.io"}');
    expect(out).not.toContain("@firma");
    expect(out).not.toContain("x@y.io");
    expect(out).toContain("[redacted-email]");
  });

  it("safeErrorForLog strips e-mails from error messages", () => {
    const out = safeErrorForLog(new Error("send failed for klient@eshop.sk"));
    expect(out).not.toContain("klient@eshop.sk");
    expect(out).toContain("send failed");
  });

  it("redactEmails truncates huge input (bounded output and fast)", () => {
    const huge = `${"a".repeat(200_000)}@${"b".repeat(1000)}`;
    const t0 = Date.now();
    const out = redactEmails(huge);
    expect(Date.now() - t0).toBeLessThan(1000);
    expect(out.length).toBeLessThanOrEqual(MAX_REDACT_INPUT + 20);
    expect(out.endsWith("…[truncated]")).toBe(true);
  });

  it("redactEmails still redacts an e-mail inside the allowed window", () => {
    const out = redactEmails(`x@y.sk ${"z".repeat(10_000)}`);
    expect(out).toContain("[redacted-email]");
    expect(out).not.toContain("x@y.sk");
  });

  it("safeErrorForLog never throws on odd values", () => {
    const throwingToString = {
      toString() {
        throw new Error("nope klient@eshop.sk");
      },
    };
    const throwingMessage = Object.defineProperty(new Error("x"), "message", {
      get() {
        throw new Error("getter boom");
      },
    });
    const odd: unknown[] = [
      Object.create(null),
      throwingToString,
      throwingMessage,
      Symbol("s"),
      undefined,
      null,
      42,
      123n,
      () => 1,
      [],
    ];
    for (const v of odd) {
      let out = "";
      expect(() => {
        out = safeErrorForLog(v);
      }).not.toThrow();
      expect(typeof out).toBe("string");
      expect(out).not.toContain("klient@eshop.sk");
    }
    expect(safeErrorForLog(Object.create(null))).toBe("[unloggable error]");
  });
});
