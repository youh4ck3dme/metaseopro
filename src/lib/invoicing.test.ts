import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildSuperfakturaPayload,
  calculateInvoiceAmounts,
  createSuperfakturaInvoice,
  isReverseChargeEligible,
  resolveCountryId,
  sendInvoiceEmail,
  REVERSE_CHARGE_NOTICE,
  type InvoiceResult,
  type VerifiedTaxDecision,
} from "./invoicing.server";

const taxable: VerifiedTaxDecision = {
  status: "verified",
  reviewId: "test-review-1",
  sellerProfileVersion: "test-seller-v1",
  treatment: "taxable",
  taxRate: 23,
};
const reverseCharge: VerifiedTaxDecision = { ...taxable, treatment: "reverse_charge", taxRate: 0 };

function payload(decision = taxable) {
  return buildSuperfakturaPayload({
    plan: "pro",
    amountTotal: 39,
    client: { name: "Fixture company", email: "fixture@example.invalid", country: "SK" },
    taxDecision: decision,
  });
}
function successBody() {
  return {
    error: 0,
    data: {
      Invoice: { id: "98765", token: "fixture-token", invoice_no_formatted: "TEST-0001" },
      Summary: { invoice_total: 39 },
    },
  };
}
function emailSuccessBody() {
  return {
    error: 0,
    data: {
      Invoice: {
        invoice_id: "98765",
        recipient: "fixture@example.invalid",
        email: "fixture@example.invalid",
      },
    },
  };
}
function configureFixtureProvider() {
  vi.stubEnv("SUPERFAKTURA_INVOICING_ENABLED", "true");
  vi.stubEnv("SUPERFAKTURA_EMAIL_ENABLED", "true");
  vi.stubEnv("SUPERFAKTURA_EMAIL", "fixture@example.invalid");
  vi.stubEnv("SUPERFAKTURA_API_KEY", "synthetic-fixture-only");
  vi.stubEnv("SUPERFAKTURA_COMPANY_ID", "1");
  vi.stubEnv("SUPERFAKTURA_API_URL", "https://sandbox.superfaktura.sk");
}
function fixtureFetch(body: unknown = successBody(), status = 200) {
  return vi.fn<typeof fetch>().mockResolvedValue(
    new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    }),
  );
}
const testOptions = { mode: "test" as const, taxDecision: taxable };
let networkGuard: ReturnType<typeof vi.fn<typeof fetch>>;

beforeEach(() => {
  vi.stubEnv("NODE_ENV", "test");
  for (const name of [
    "SUPERFAKTURA_INVOICING_ENABLED",
    "SUPERFAKTURA_EMAIL_ENABLED",
    "SUPERFAKTURA_EMAIL",
    "SUPERFAKTURA_API_KEY",
    "SUPERFAKTURA_COMPANY_ID",
    "SUPERFAKTURA_APP_ID",
    "SUPERFAKTURA_MODULE",
    "SUPERFAKTURA_API_URL",
  ])
    vi.stubEnv(name, "");
  networkGuard = vi.fn<typeof fetch>().mockRejectedValue(new Error("Unexpected network call"));
  vi.stubGlobal("fetch", networkGuard);
});
afterEach(() => {
  expect(networkGuard).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("explicit tax decisions", () => {
  it("does not infer reverse charge from a foreign VAT string or a legacy boolean", () => {
    expect(() => isReverseChargeEligible("DE", "garbage")).toThrow("TAX_DECISION_REQUIRED");
    expect(() => calculateInvoiceAmounts(39, true)).toThrow("TAX_DECISION_REQUIRED");
    expect(() => calculateInvoiceAmounts(39, false)).toThrow("TAX_DECISION_REQUIRED");
  });

  it("uses only the supplied reviewed rate for gross arithmetic", () => {
    expect(calculateInvoiceAmounts(123, taxable)).toEqual({
      unitPrice: 100,
      taxRate: 23,
      taxAmount: 23,
      total: 123,
      notice: undefined,
    });
    expect(calculateInvoiceAmounts(107.7, { ...taxable, taxRate: 7.7 })).toMatchObject({
      unitPrice: 100,
      taxRate: 7.7,
      taxAmount: 7.7,
      total: 107.7,
    });
  });

  it("keeps reverse charge explicit and does not claim a universal paragraph", () => {
    expect(isReverseChargeEligible("CZ", "CZfixture", reverseCharge)).toBe(true);
    expect(calculateInvoiceAmounts(39, reverseCharge)).toMatchObject({
      unitPrice: 39,
      taxRate: 0,
      taxAmount: 0,
      total: 39,
      notice: REVERSE_CHARGE_NOTICE,
    });
    expect(REVERSE_CHARGE_NOTICE).not.toContain("69");
  });

  it.each([
    { ...taxable, reviewId: "" },
    { ...taxable, sellerProfileVersion: "" },
    { ...taxable, status: "pending" },
    { ...taxable, taxRate: 0 },
    { ...reverseCharge, taxRate: 23 },
    { ...taxable, treatment: "exempt", taxRate: 0 },
  ])("rejects incomplete or inconsistent decisions: %j", (decision) => {
    expect(() => calculateInvoiceAmounts(39, decision as VerifiedTaxDecision)).toThrow();
  });

  it.each([NaN, Infinity, -1])("rejects invalid monetary values: %s", (amount) => {
    expect(() => calculateInvoiceAmounts(amount, taxable)).toThrow("INVALID_AMOUNT");
  });

  it("refuses a rounding mismatch instead of changing the final charged sum", () => {
    expect(() => calculateInvoiceAmounts(0.03, { ...taxable, taxRate: 20 })).toThrow(
      "ROUNDING_REVIEW_REQUIRED",
    );
  });

  it("does not default unknown countries to Slovakia", () => {
    expect(resolveCountryId("Česká republika")).toBe(56);
    for (const country of [undefined, "", "FR", "__proto__"]) {
      expect(() => resolveCountryId(country)).toThrow("UNSUPPORTED_COUNTRY");
    }
  });

  it("requires a decision in the builder and never marks an invoice paid", () => {
    expect(() =>
      buildSuperfakturaPayload({
        plan: "pro",
        amountTotal: 39,
        client: payload().Client,
      }),
    ).toThrow("TAX_DECISION_REQUIRED");
    expect(payload().Invoice).toMatchObject({ already_paid: 0, vat_transfer: 0 });
    expect(payload().Invoice.variable).toBeUndefined();
    expect(payload(reverseCharge).Invoice.vat_transfer).toBe(1);
  });

  it("rejects contradictory country IDs and unsupported currency", () => {
    const base = { plan: "pro", amountTotal: 39, client: payload().Client, taxDecision: taxable };
    expect(() =>
      buildSuperfakturaPayload({ ...base, client: { ...base.client, country_id: 56 } }),
    ).toThrow("COUNTRY_MISMATCH");
    expect(() => buildSuperfakturaPayload({ ...base, currency: "JPY" })).toThrow(
      "UNSUPPORTED_CURRENCY",
    );
  });
});

describe("SuperFaktura provider boundary", () => {
  it("fails closed without a decision, without enablement, or without credentials", async () => {
    const request = fixtureFetch();
    expect(await createSuperfakturaInvoice(payload(), request)).toMatchObject({
      success: false,
      mock: false,
      errorCode: "TAX_DECISION_REQUIRED",
    });
    expect(
      await createSuperfakturaInvoice(payload(), request, { taxDecision: taxable }),
    ).toMatchObject({
      success: false,
      mock: false,
      errorCode: "INVOICING_DISABLED",
    });
    vi.stubEnv("SUPERFAKTURA_INVOICING_ENABLED", "true");
    expect(
      await createSuperfakturaInvoice(payload(), request, { taxDecision: taxable }),
    ).toMatchObject({
      success: false,
      mock: false,
      errorCode: "INVOICING_NOT_CONFIGURED",
    });
    expect(request).not.toHaveBeenCalled();
  });

  it("does not use APP_ID as COMPANY_ID", async () => {
    vi.stubEnv("SUPERFAKTURA_INVOICING_ENABLED", "true");
    vi.stubEnv("SUPERFAKTURA_EMAIL", "fixture@example.invalid");
    vi.stubEnv("SUPERFAKTURA_API_KEY", "fixture");
    vi.stubEnv("SUPERFAKTURA_APP_ID", "12");
    const request = fixtureFetch();
    expect(
      await createSuperfakturaInvoice(payload(), request, { taxDecision: taxable }),
    ).toMatchObject({
      success: false,
      errorCode: "INVOICING_NOT_CONFIGURED",
    });
    expect(request).not.toHaveBeenCalled();
  });

  it("requires an explicit test mode and injected transport for fixture results", async () => {
    const request = fixtureFetch();
    expect(await createSuperfakturaInvoice(payload(), undefined, testOptions)).toMatchObject({
      success: false,
      errorCode: "TEST_MODE_REQUIRES_INJECTED_FETCH",
    });
    vi.stubEnv("NODE_ENV", "production");
    expect(await createSuperfakturaInvoice(payload(), request, testOptions)).toMatchObject({
      success: false,
      errorCode: "TEST_MODE_REQUIRES_INJECTED_FETCH",
    });
    expect(request).not.toHaveBeenCalled();
  });

  it("uses documented JSON/auth/PDF formats and only fixture credentials in test mode", async () => {
    const request = fixtureFetch();
    const result = await createSuperfakturaInvoice(payload(), request, testOptions);
    expect(result).toMatchObject({
      success: true,
      mock: true,
      invoiceId: "98765",
      invoiceNumber: "TEST-0001",
      totalAmount: 39,
    });
    const [url, init] = request.mock.calls[0];
    expect(url).toBe("https://superfaktura.invalid/invoices/create");
    expect(init?.redirect).toBe("error");
    expect(init?.headers).toEqual({
      Authorization:
        "SFAPI email=fixture%40example.invalid&apikey=fixture&module=SEO4WEB%20test&company_id=1",
      "Content-Type": "application/json",
    });
    expect(JSON.parse(String(init?.body))).toEqual(payload());
    expect(result.invoiceUrl).toBe(
      "https://superfaktura.invalid/invoices/pdf/98765/token:fixture-token",
    );
  });

  it.each(["rate", "paid", "zero"])(
    "rejects an altered %s payload before transport",
    async (change) => {
      const input = payload();
      if (change === "rate") input.InvoiceItem[0].tax = 20;
      if (change === "paid") input.Invoice.already_paid = 1;
      if (change === "zero") input.InvoiceItem[0].tax = 0;
      const request = fixtureFetch();
      expect((await createSuperfakturaInvoice(input, request, testOptions)).success).toBe(false);
      expect(request).not.toHaveBeenCalled();
    },
  );

  it.each([
    {},
    { error: 0, data: {} },
    { error: 0, data: { Invoice: { token: "missing-id" } } },
    { ...successBody(), data: { ...successBody().data, Summary: { invoice_total: 1 } } },
  ])("does not invent IDs or accept malformed success: %j", async (body) => {
    const result = await createSuperfakturaInvoice(payload(), fixtureFetch(body), testOptions);
    expect(result).toMatchObject({ success: false, mock: false, requiresReconciliation: true });
    expect(result.invoiceNumber).toBe("");
    expect(result.invoiceUrl).toBe("");
  });

  it("keeps raw provider errors and personal data out of errors and logs", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const secretText = "provider private email personal@example.invalid";
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(secretText, { status: 500 }));
    const result = await createSuperfakturaInvoice(payload(), request, testOptions);
    expect(result.error).not.toContain(secretText);
    expect(result.errorCode).toBe("PROVIDER_HTTP_500");
    expect(info).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });

  it("marks unreadable JSON and transport timeout as uncertain; never retries create", async () => {
    for (const request of [
      vi.fn<typeof fetch>().mockResolvedValue(new Response("not JSON")),
      vi.fn<typeof fetch>().mockRejectedValue(new Error("sensitive provider details")),
    ]) {
      const result = await createSuperfakturaInvoice(payload(), request, testOptions);
      expect(result).toMatchObject({
        success: false,
        errorCode: "PROVIDER_OUTCOME_UNKNOWN",
        requiresReconciliation: true,
      });
      expect(result.error).not.toContain("sensitive");
      expect(request).toHaveBeenCalledTimes(1);
    }
  });
});

describe("invoice delivery", () => {
  it("does not simulate delivery without a confirmed invoice", async () => {
    const request = fixtureFetch();
    expect(await sendInvoiceEmail(98765, "fixture@example.invalid", request)).toMatchObject({
      success: false,
      mock: false,
      message: "CONFIRMED_INVOICE_REQUIRED",
    });
    expect(request).not.toHaveBeenCalled();
  });

  it("does not send a fixture receipt in live mode or to another recipient", async () => {
    const receipt = await createSuperfakturaInvoice(payload(), fixtureFetch(), testOptions);
    const request = fixtureFetch();
    expect(
      (
        await sendInvoiceEmail(98765, "other@example.invalid", request, {
          mode: "test",
          confirmedInvoice: receipt,
        })
      ).success,
    ).toBe(false);
    expect(
      (
        await sendInvoiceEmail(98765, receipt.client.email, request, {
          confirmedInvoice: receipt,
        })
      ).success,
    ).toBe(false);
    expect(request).not.toHaveBeenCalled();
  });

  it("uses the documented /invoices/send route and requires an application success result", async () => {
    const receipt = await createSuperfakturaInvoice(payload(), fixtureFetch(), testOptions);
    const request = fixtureFetch(emailSuccessBody());
    expect(
      await sendInvoiceEmail(98765, receipt.client.email, request, {
        mode: "test",
        confirmedInvoice: receipt,
      }),
    ).toEqual({ success: true, mock: true, status: "mock", requiresReconciliation: false });
    expect(request.mock.calls[0][0]).toBe("https://superfaktura.invalid/invoices/send");
    expect(JSON.parse(String(request.mock.calls[0][1]?.body))).toEqual({
      Email: { invoice_id: 98765, to: receipt.client.email, pdf_language: "slo" },
    });
    expect(
      await sendInvoiceEmail(98765, receipt.client.email, fixtureFetch({ error: 13 }), {
        mode: "test",
        confirmedInvoice: receipt,
      }),
    ).toEqual({
      success: false,
      mock: false,
      status: "not_sent",
      message: "EMAIL_NOT_CONFIRMED",
      requiresReconciliation: false,
    });
    expect(
      await sendInvoiceEmail(98765, receipt.client.email, fixtureFetch({}), {
        mode: "test",
        confirmedInvoice: receipt,
      }),
    ).toEqual({
      success: false,
      mock: false,
      status: "unknown",
      message: "EMAIL_OUTCOME_UNKNOWN",
      requiresReconciliation: true,
    });
  });

  it.each([
    { error: 0 },
    { error: 0, data: { Invoice: {} } },
    { error: 0, data: { Invoice: { invoice_id: "123", recipient: "fixture@example.invalid" } } },
    { error: 0, data: { Invoice: { invoice_id: "98765", recipient: "other@example.invalid" } } },
    { error: 0, data: { Invoice: { invoice_id: "98765" } } },
    { error: "0" },
    null,
  ])(
    "does not confirm delivery from an incomplete or unrelated acknowledgement: %j",
    async (body) => {
      const receipt = await createSuperfakturaInvoice(payload(), fixtureFetch(), testOptions);
      const request = fixtureFetch(body);
      expect(
        await sendInvoiceEmail(98765, receipt.client.email, request, {
          mode: "test",
          confirmedInvoice: receipt,
        }),
      ).toMatchObject({ success: false, status: "unknown", requiresReconciliation: true });
      expect(request).toHaveBeenCalledTimes(1);
    },
  );

  it("keeps the confirmed recipient independent of a subsequently edited payload", async () => {
    const input = payload();
    const receipt = await createSuperfakturaInvoice(input, fixtureFetch(), testOptions);
    input.Client.email = "changed@example.invalid";
    expect(receipt.client.email).toBe("fixture@example.invalid");
    const request = fixtureFetch(emailSuccessBody());
    expect(
      await sendInvoiceEmail(98765, input.Client.email, request, {
        mode: "test",
        confirmedInvoice: receipt,
      }),
    ).toMatchObject({ success: false, status: "not_sent" });
    expect(request).not.toHaveBeenCalled();
  });

  it.each([
    { success: true, mock: false, invoiceId: "98765" },
    { success: true, mock: false, invoiceId: "98765", client: null },
    { success: true, mock: false, invoiceId: "98765", client: { email: 123 } },
    { success: true, mock: false, invoiceId: "98765", client: { email: "" } },
  ])("rejects incomplete stored receipts without throwing: %j", async (receipt) => {
    const request = fixtureFetch(emailSuccessBody());
    await expect(
      sendInvoiceEmail(98765, "fixture@example.invalid", request, {
        mode: "test",
        confirmedInvoice: receipt as InvoiceResult,
      }),
    ).resolves.toMatchObject({ success: false, status: "not_sent" });
    expect(request).not.toHaveBeenCalled();
  });

  it.each(["", " ", "not-an-email", "first@example.invalid,second@example.invalid"])(
    "rejects an invalid invoice recipient before creating any invoice: %s",
    async (email) => {
      const input = payload();
      input.Client.email = email;
      const request = fixtureFetch();
      expect(await createSuperfakturaInvoice(input, request, testOptions)).toMatchObject({
        success: false,
        errorCode: "INVALID_CLIENT",
      });
      expect(request).not.toHaveBeenCalled();
    },
  );

  it.each(["origin", "company"])(
    "does not send an invoice after its provider %s changes",
    async (change) => {
      configureFixtureProvider();
      const receipt = await createSuperfakturaInvoice(payload(), fixtureFetch(), {
        taxDecision: taxable,
      });
      expect(receipt.success).toBe(true);
      if (change === "origin")
        vi.stubEnv("SUPERFAKTURA_API_URL", "https://sandbox.superfaktura.cz");
      else vi.stubEnv("SUPERFAKTURA_COMPANY_ID", "2");
      const request = fixtureFetch(emailSuccessBody());
      expect(
        await sendInvoiceEmail(98765, receipt.client.email, request, { confirmedInvoice: receipt }),
      ).toMatchObject({ success: false, status: "not_sent", message: "INVOICE_PROVIDER_MISMATCH" });
      expect(request).not.toHaveBeenCalled();
    },
  );

  it("reports provider acceptance separately from inbox delivery", async () => {
    configureFixtureProvider();
    const receipt = await createSuperfakturaInvoice(payload(), fixtureFetch(), {
      taxDecision: taxable,
    });
    const request = fixtureFetch(emailSuccessBody());
    expect(
      await sendInvoiceEmail(98765, receipt.client.email, request, { confirmedInvoice: receipt }),
    ).toEqual({ success: true, mock: false, status: "accepted", requiresReconciliation: false });
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("preserves uncertainty after an HTTP error, invalid JSON or timeout and never retries", async () => {
    const receipt = await createSuperfakturaInvoice(payload(), fixtureFetch(), testOptions);
    for (const request of [
      fixtureFetch({ error: 0 }, 500),
      vi.fn<typeof fetch>().mockResolvedValue(new Response("not JSON")),
      vi.fn<typeof fetch>().mockRejectedValue(new Error("sensitive provider details")),
    ]) {
      const result = await sendInvoiceEmail(98765, receipt.client.email, request, {
        mode: "test",
        confirmedInvoice: receipt,
      });
      expect(result).toEqual({
        success: false,
        mock: false,
        status: "unknown",
        message: "EMAIL_OUTCOME_UNKNOWN",
        requiresReconciliation: true,
      });
      expect(request).toHaveBeenCalledTimes(1);
    }
  });
});
