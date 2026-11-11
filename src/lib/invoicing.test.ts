import { describe, expect, it, vi } from "vitest";
import {
  buildSuperfakturaPayload,
  calculateInvoiceAmounts,
  createSuperfakturaInvoice,
  isReverseChargeEligible,
  resolveCountryId,
  REVERSE_CHARGE_NOTICE,
  sendInvoiceEmail,
} from "./invoicing.server";

describe("SuperFaktúra & Slovak Invoicing Engine", () => {
  describe("Country ID resolution", () => {
    it("maps Slovakia variations to 191", () => {
      expect(resolveCountryId("SK")).toBe(191);
      expect(resolveCountryId("Slovensko")).toBe(191);
      expect(resolveCountryId("Slovakia")).toBe(191);
      expect(resolveCountryId()).toBe(191);
    });

    it("maps Czech Republic variations to 56", () => {
      expect(resolveCountryId("CZ")).toBe(56);
      expect(resolveCountryId("Česká republika")).toBe(56);
      expect(resolveCountryId("Cesko")).toBe(56);
      expect(resolveCountryId("Czechia")).toBe(56);
    });

    it("maps other EU countries accurately", () => {
      expect(resolveCountryId("DE")).toBe(81);
      expect(resolveCountryId("Nemecko")).toBe(81);
      expect(resolveCountryId("AT")).toBe(15);
      expect(resolveCountryId("PL")).toBe(175);
    });
  });

  describe("Reverse Charge eligibility", () => {
    it("does not apply Reverse Charge for Slovak entities (country SK or IČ DPH starting with SK)", () => {
      expect(isReverseChargeEligible("SK", "SK2021234567")).toBe(false);
      expect(isReverseChargeEligible("Slovensko", "SK1020304050")).toBe(false);
      expect(isReverseChargeEligible("CZ", "SK2021234567")).toBe(false);
    });

    it("does not apply Reverse Charge if no VAT ID is provided", () => {
      expect(isReverseChargeEligible("CZ", undefined)).toBe(false);
      expect(isReverseChargeEligible("CZ", "")).toBe(false);
    });

    it("applies Reverse Charge for EU businesses outside SK with non-SK VAT number", () => {
      expect(isReverseChargeEligible("CZ", "CZ12345678")).toBe(true);
      expect(isReverseChargeEligible("Česká republika", "CZ87654321")).toBe(true);
      expect(isReverseChargeEligible("DE", "DE123456789")).toBe(true);
      expect(isReverseChargeEligible("Nemecko", "DE987654321")).toBe(true);
    });
  });

  describe("VAT and price calculations", () => {
    it("calculates standard 20% Slovak VAT correctly for Pro plan (39 €)", () => {
      const result = calculateInvoiceAmounts(39, false);

      expect(result.taxRate).toBe(20);
      expect(result.total).toBe(39);
      // 39 / 1.20 = 32.50 € base price
      expect(result.unitPrice).toBe(32.5);
      // 39 - 32.50 = 6.50 € VAT
      expect(result.taxAmount).toBe(6.5);
      expect(result.notice).toBeUndefined();
    });

    it("calculates standard 20% Slovak VAT correctly for Agency plan (89 €)", () => {
      const result = calculateInvoiceAmounts(89, false);

      expect(result.taxRate).toBe(20);
      expect(result.total).toBe(89);
      // 89 / 1.20 = 74.17 € base price
      expect(result.unitPrice).toBe(74.17);
      // 89 - 74.17 = 14.83 € VAT
      expect(result.taxAmount).toBe(14.83);
      expect(result.notice).toBeUndefined();
    });

    it("applies 0% VAT and legal notice for EU Reverse Charge", () => {
      const result = calculateInvoiceAmounts(39, true);

      expect(result.taxRate).toBe(0);
      expect(result.unitPrice).toBe(39);
      expect(result.taxAmount).toBe(0);
      expect(result.total).toBe(39);
      expect(result.notice).toBe(REVERSE_CHARGE_NOTICE);
      expect(result.notice).toContain("§ 69 ods. 3");
    });
  });

  describe("Payload building", () => {
    it("constructs valid SuperFaktúra payload for Slovak customer", () => {
      const payload = buildSuperfakturaPayload({
        plan: "pro",
        amountTotal: 39,
        stripeSessionId: "cs_test_abc1234567890",
        client: {
          name: "Slovenská Firma s.r.o.",
          ico: "12345678",
          dic: "2021234567",
          ic_dph: "SK2021234567",
          email: "faktury@firma.sk",
          city: "Bratislava",
          country: "Slovensko",
        },
      });

      expect(payload.Invoice.name).toContain("SEO4WEB PRO");
      expect(payload.Invoice.payment_type).toBe("card");
      expect(payload.Invoice.already_paid).toBe(1);
      expect(payload.Client.country_id).toBe(191);
      expect(payload.InvoiceItem[0]?.tax).toBe(20);
      expect(payload.InvoiceItem[0]?.unit_price).toBe(32.5);
      expect(payload.Invoice.comment).toBeUndefined();
    });

    it("constructs valid Reverse Charge payload for Czech customer", () => {
      const payload = buildSuperfakturaPayload({
        plan: "agency",
        amountTotal: 89,
        stripeSessionId: "cs_test_cz1234567890",
        client: {
          name: "Česká Agentura s.r.o.",
          ico: "87654321",
          dic: "CZ87654321",
          ic_dph: "CZ87654321",
          email: "ucetni@agentura.cz",
          city: "Praha",
          country: "Česká republika",
        },
      });

      expect(payload.Client.country_id).toBe(56);
      expect(payload.InvoiceItem[0]?.tax).toBe(0);
      expect(payload.InvoiceItem[0]?.unit_price).toBe(89);
      expect(payload.Invoice.comment).toBe(REVERSE_CHARGE_NOTICE);
      expect(payload.InvoiceItem[0]?.description).toBe(REVERSE_CHARGE_NOTICE);
    });
  });

  describe("createSuperfakturaInvoice API & Mock", () => {
    it("returns simulated mock invoice when SUPERFAKTURA_API_KEY is not set", async () => {
      const origKey = process.env.SUPERFAKTURA_API_KEY;
      delete process.env.SUPERFAKTURA_API_KEY;

      try {
        const payload = buildSuperfakturaPayload({
          plan: "pro",
          amountTotal: 39,
          stripeSessionId: "cs_mock_session_123",
          client: {
            name: "Mock Client s.r.o.",
            email: "mock@client.sk",
          },
        });

        const res = await createSuperfakturaInvoice(payload);

        expect(res.success).toBe(true);
        expect(res.mock).toBe(true);
        expect(res.invoiceNumber).toMatch(/^FAK-20\d\d-/);
        expect(res.invoiceUrl).toContain("/invoices/view/");
        expect(res.totalAmount).toBe(39);
        expect(res.taxRate).toBe(20);
      } finally {
        if (origKey) process.env.SUPERFAKTURA_API_KEY = origKey;
      }
    });

    it("executes live POST request when credentials are configured", async () => {
      const origEmail = process.env.SUPERFAKTURA_EMAIL;
      const origKey = process.env.SUPERFAKTURA_API_KEY;

      process.env.SUPERFAKTURA_EMAIL = "test@seo4web.sk";
      process.env.SUPERFAKTURA_API_KEY = "test_api_key_123";

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          error: 0,
          data: {
            Invoice: {
              id: 98765,
              token: "sec_token_xyz",
              invoice_no_formatted: "2026110042",
            },
          },
        }),
      });

      try {
        const payload = buildSuperfakturaPayload({
          plan: "agency",
          amountTotal: 89,
          stripeSessionId: "cs_live_session_456",
          client: {
            name: "Live Agency s.r.o.",
            email: "live@agency.sk",
            country: "Slovensko",
          },
        });

        const res = await createSuperfakturaInvoice(payload, mockFetch as unknown as typeof fetch);

        expect(res.success).toBe(true);
        expect(res.mock).toBe(false);
        expect(res.invoiceId).toBe(98765);
        expect(res.invoiceNumber).toBe("2026110042");
        expect(res.invoiceUrl).toContain("sec_token_xyz");
        expect(res.invoicePdfUrl).toContain("/invoices/pdf/98765/token:sec_token_xyz");
        expect(mockFetch).toHaveBeenCalledWith(
          expect.stringContaining("/invoices/create"),
          expect.objectContaining({
            method: "POST",
            headers: expect.objectContaining({
              Authorization: expect.stringContaining("test_api_key_123"),
            }),
          }),
        );
      } finally {
        if (origEmail) process.env.SUPERFAKTURA_EMAIL = origEmail;
        else delete process.env.SUPERFAKTURA_EMAIL;
        if (origKey) process.env.SUPERFAKTURA_API_KEY = origKey;
        else delete process.env.SUPERFAKTURA_API_KEY;
      }
    });
  });

  describe("sendInvoiceEmail", () => {
    it("simulates email delivery when credentials are missing", async () => {
      const origKey = process.env.SUPERFAKTURA_API_KEY;
      delete process.env.SUPERFAKTURA_API_KEY;

      try {
        const res = await sendInvoiceEmail(12345, "klient@firma.sk");
        expect(res.success).toBe(true);
        expect(res.mock).toBe(true);
      } finally {
        if (origKey) process.env.SUPERFAKTURA_API_KEY = origKey;
      }
    });

    it("invokes sendInvoiceEmail endpoint with invoice_id and recipient", async () => {
      const origEmail = process.env.SUPERFAKTURA_EMAIL;
      const origKey = process.env.SUPERFAKTURA_API_KEY;

      process.env.SUPERFAKTURA_EMAIL = "test@seo4web.sk";
      process.env.SUPERFAKTURA_API_KEY = "test_api_key_123";

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ error: 0 }),
      });

      try {
        const res = await sendInvoiceEmail(
          54321,
          "klient@firma.sk",
          mockFetch as unknown as typeof fetch,
        );
        expect(res.success).toBe(true);
        expect(res.mock).toBe(false);
        expect(mockFetch).toHaveBeenCalledWith(
          expect.stringContaining("/invoices/sendInvoiceEmail"),
          expect.objectContaining({
            method: "POST",
            body: JSON.stringify({
              Email: {
                invoice_id: 54321,
                to: "klient@firma.sk",
                pdf_language: "slo",
              },
            }),
          }),
        );
      } finally {
        if (origEmail) process.env.SUPERFAKTURA_EMAIL = origEmail;
        else delete process.env.SUPERFAKTURA_EMAIL;
        if (origKey) process.env.SUPERFAKTURA_API_KEY = origKey;
        else delete process.env.SUPERFAKTURA_API_KEY;
      }
    });
  });
});
