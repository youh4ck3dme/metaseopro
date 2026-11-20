import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  isValidDIC,
  isValidICDPH,
  isValidICO,
  normalizeDIC,
  normalizeICDPH,
  normalizeICO,
  validateCompanyBilling,
  verifyViesVat,
} from "./slovak-billing";

describe("Slovak & Czech B2B billing validator", () => {
  describe("isValidICO", () => {
    it("validates real Slovak companies by modulo 11 checksum", () => {
      // Slovak Telekom, a.s.
      expect(isValidICO("35763469")).toBe(true);
      // Slovnaft, a.s.
      expect(isValidICO("31322832")).toBe(true);
      // SPP, a.s.
      expect(isValidICO("35815256")).toBe(true);
      // Orange Slovensko, a.s.
      expect(isValidICO("31348262")).toBe(true);
      // VÚB, a.s.
      expect(isValidICO("00151700")).toBe(true);
      // With whitespace
      expect(isValidICO(" 3576 3469 ")).toBe(true);
    });

    it("rejects invalid IČO (bad checksum, wrong length, non-digits)", () => {
      // Bad check digit
      expect(isValidICO("35763460")).toBe(false);
      expect(isValidICO("12345678")).toBe(false);
      // Too short / too long
      expect(isValidICO("1234567")).toBe(false);
      expect(isValidICO("123456789")).toBe(false);
      // Non-numeric
      expect(isValidICO("abcdefgh")).toBe(false);
      expect(isValidICO("")).toBe(false);
    });
  });

  describe("isValidDIC", () => {
    it("validates real Slovak DIČ (10 digits, starts with 10/20/21, divisible by 11)", () => {
      // Slovnaft DIČ
      expect(isValidDIC("2020273893")).toBe(true);
      // Slovenská sporiteľňa DIČ
      expect(isValidDIC("2020315440")).toBe(true);
      // Valid with whitespace
      expect(isValidDIC(" 2020 273893 ")).toBe(true);
    });

    it("rejects invalid DIČ (invalid prefix, not divisible by 11, wrong length)", () => {
      // Starts with 30 (invalid prefix for SK)
      expect(isValidDIC("3020273893")).toBe(false);
      // Not divisible by 11
      expect(isValidDIC("2020273894")).toBe(false);
      // Wrong length
      expect(isValidDIC("202027")).toBe(false);
      expect(isValidDIC("")).toBe(false);
    });
  });

  describe("isValidICDPH", () => {
    it("validates Slovak IČ DPH with SK prefix and valid DIČ", () => {
      expect(isValidICDPH("SK2020273893")).toBe(true);
      expect(isValidICDPH("sk2020315440")).toBe(true);
      expect(isValidICDPH(" SK 2020273893 ")).toBe(true);
    });

    it("rejects non-SK prefixes and invalid DIČ parts", () => {
      expect(isValidICDPH("CZ2020273893")).toBe(false);
      expect(isValidICDPH("SK2020273894")).toBe(false);
      expect(isValidICDPH("SK123")).toBe(false);
      expect(isValidICDPH("")).toBe(false);
    });
  });

  describe("Normalization & Composite validation", () => {
    it("normalizes formatting cleanly", () => {
      expect(normalizeICO(" 35 763 469 ")).toBe("35763469");
      expect(normalizeDIC(" 2020 273893 ")).toBe("2020273893");
      expect(normalizeICDPH("2020273893")).toBe("SK2020273893");
      expect(normalizeICDPH(" sk 2020273893 ")).toBe("SK2020273893");
      expect(normalizeICDPH(" cz 12345678 ")).toBe("CZ12345678");
      expect(normalizeICDPH("DE123456789")).toBe("DE123456789");
      expect(normalizeICDPH("")).toBe("");
    });

    it("validates complete billing form payload", () => {
      const valid = validateCompanyBilling({
        companyName: "Acme s.r.o.",
        ico: "35763469",
        dic: "2020273893",
        icDph: "SK2020273893",
      });
      expect(valid.valid).toBe(true);
      expect(Object.keys(valid.errors)).toHaveLength(0);

      const invalid = validateCompanyBilling({
        companyName: "Acme s.r.o.",
        ico: "12345678",
        dic: "9999999999",
        icDph: "XX123",
      });
      expect(invalid.valid).toBe(false);
      expect(invalid.errors.ico).toBeDefined();
      expect(invalid.errors.dic).toBeDefined();
      expect(invalid.errors.icDph).toBeDefined();
    });
  });

  describe("VIES registry status versus syntax", () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => {
      expect(vi.getTimerCount()).toBe(0);
      vi.useRealTimers();
      vi.restoreAllMocks();
    });

    function response(body: unknown, status = 200) {
      return vi.fn<typeof fetch>().mockResolvedValue(
        new Response(JSON.stringify(body), {
          status,
          headers: { "Content-Type": "application/json" },
        }),
      );
    }

    it("sets valid only after an explicit registry confirmation", async () => {
      const request = response({
        isValid: true,
        name: "Fixture s.r.o.",
        address: "Fixture address",
      });
      const result = await verifyViesVat("SK", "SK2020273893", request);
      expect(result).toMatchObject({
        valid: true,
        verificationStatus: "verified",
        syntaxValid: true,
        source: "vies",
        name: "Fixture s.r.o.",
        vatNumber: "2020273893",
      });
      expect(request).toHaveBeenCalledTimes(1);
    });

    it("keeps registry invalidity separate from syntactically valid input", async () => {
      expect(await verifyViesVat("SK", "2020273893", response({ isValid: false }))).toMatchObject({
        valid: false,
        verificationStatus: "invalid",
        syntaxValid: true,
        source: "vies",
      });
    });

    it("reports unavailable after a rejected request and still clears the timeout", async () => {
      const request = vi.fn<typeof fetch>().mockRejectedValue(new Error("Unavailable"));
      expect(await verifyViesVat("SK", "2020273893", request)).toMatchObject({
        valid: false,
        verificationStatus: "unavailable",
        syntaxValid: true,
        source: "syntax_fallback",
      });
    });

    it("does not pretend to implement an EU syntax validator", async () => {
      const request = vi.fn<typeof fetch>().mockRejectedValue(new Error("Unavailable"));
      expect(await verifyViesVat("DE", "DE123456789", request)).toMatchObject({
        valid: false,
        verificationStatus: "unavailable",
        syntaxValid: null,
      });
      expect(await verifyViesVat("DE", "DE123456789", response({ isValid: true }))).toMatchObject({
        valid: true,
        verificationStatus: "verified",
        syntaxValid: null,
        source: "vies",
      });
    });

    it("rejects locally invalid SK syntax without requesting the registry", async () => {
      const request = response({ isValid: true });
      expect(await verifyViesVat("SK", "123456", request)).toMatchObject({
        valid: false,
        verificationStatus: "invalid",
        syntaxValid: false,
        source: "syntax_fallback",
      });
      expect(request).not.toHaveBeenCalled();
    });

    it("does not truncate an invalid country or send empty input", async () => {
      const request = response({ isValid: true });
      for (const [country, vat] of [
        ["SKextra", "2020273893"],
        ["", "2020273893"],
        ["DE", ""],
      ]) {
        expect(await verifyViesVat(country, vat, request)).toMatchObject({
          valid: false,
          verificationStatus: "invalid",
          syntaxValid: false,
        });
      }
      expect(request).not.toHaveBeenCalled();
    });

    it.each([{}, { isValid: "true" }, { isValid: 1 }, null])(
      "does not treat malformed registry JSON as valid or registry-invalid: %j",
      async (body) => {
        expect(await verifyViesVat("SK", "2020273893", response(body))).toMatchObject({
          valid: false,
          verificationStatus: "unavailable",
          syntaxValid: true,
        });
      },
    );

    it("reports HTTP errors and unreadable JSON as unavailable", async () => {
      const invalidJson = vi.fn<typeof fetch>().mockResolvedValue(new Response("not JSON"));
      for (const request of [response({ isValid: false }, 503), invalidJson]) {
        expect(await verifyViesVat("SK", "2020273893", request)).toMatchObject({
          valid: false,
          verificationStatus: "unavailable",
          syntaxValid: true,
        });
      }
    });

    it("aborts a pending fetch on timeout and clears the timer", async () => {
      let observedSignal: AbortSignal | null | undefined;
      const request = vi.fn<typeof fetch>().mockImplementation(
        (_url, init) =>
          new Promise((_resolve, reject) => {
            observedSignal = init?.signal;
            init?.signal?.addEventListener("abort", () => reject(new Error("Aborted")), {
              once: true,
            });
          }),
      );
      const result = verifyViesVat("SK", "2020273893", request);
      await vi.advanceTimersByTimeAsync(4000);
      expect(observedSignal?.aborted).toBe(true);
      expect(await result).toMatchObject({
        valid: false,
        verificationStatus: "unavailable",
        syntaxValid: true,
      });
      expect(request).toHaveBeenCalledTimes(1);
    });
  });
});
