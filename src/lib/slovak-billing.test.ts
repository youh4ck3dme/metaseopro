import { describe, expect, it } from "vitest";
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

  describe("verifyViesVat (Live & Fallback)", () => {
    it("returns valid result when VIES API confirms registered VAT payer", async () => {
      const mockFetch: typeof fetch = async () =>
        new Response(
          JSON.stringify({
            isValid: true,
            name: "SLOVNAFT a.s.",
            address: "Vlčie hrdlo 1, 824 12 Bratislava",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );

      const result = await verifyViesVat("SK", "SK2020273893", mockFetch);
      expect(result.valid).toBe(true);
      expect(result.source).toBe("vies");
      expect(result.name).toBe("SLOVNAFT a.s.");
      expect(result.vatNumber).toBe("2020273893");
    });

    it("returns invalid result when VIES API returns isValid: false", async () => {
      const mockFetch: typeof fetch = async () =>
        new Response(JSON.stringify({ isValid: false }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });

      const result = await verifyViesVat("SK", "2020273893", mockFetch);
      expect(result.valid).toBe(false);
      expect(result.source).toBe("vies");
    });

    it("falls back to local syntax validation when VIES service fails or times out", async () => {
      const failingFetch: typeof fetch = async () => {
        throw new Error("Network timeout / VIES service unavailable");
      };

      // Valid SK DIČ format
      const validFallback = await verifyViesVat("SK", "2020273893", failingFetch);
      expect(validFallback.valid).toBe(true);
      expect(validFallback.source).toBe("syntax_fallback");

      // Invalid SK DIČ format
      const invalidFallback = await verifyViesVat("SK", "123456", failingFetch);
      expect(invalidFallback.valid).toBe(false);
      expect(invalidFallback.source).toBe("syntax_fallback");
    });
  });
});
