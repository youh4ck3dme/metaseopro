// Server-only SuperFaktúra adapter. Disabled unless explicitly configured.
// Tax decisions must come from a reviewed server-side accounting record;
// this module validates their shape, not their legal correctness.

import { z } from "zod";

export interface InvoicingClient {
  name: string;
  ico?: string;
  dic?: string;
  ic_dph?: string;
  email: string;
  address?: string;
  city?: string;
  zip?: string;
  country?: string;
  country_id?: number;
}

export interface InvoiceItem {
  name: string;
  quantity: number;
  unit_price: number;
  tax: number;
  description?: string;
}

export interface CreateInvoicePayload {
  Invoice: {
    name: string;
    variable?: string;
    currency: string;
    payment_type: string;
    order_no?: string;
    already_paid?: number;
    comment?: string;
    invoice_currency?: string;
    vat_transfer?: number;
  };
  Client: InvoicingClient;
  InvoiceItem: InvoiceItem[];
}

/**
 * Load this decision from trusted server-side storage, never from checkout input.
 * reviewId must identify the approved seller/customer tax assessment.
 * Other zero-tax treatments need a separately reviewed adapter, not reverse charge.
 */
export interface VerifiedTaxDecision {
  status: "verified";
  reviewId: string;
  sellerProfileVersion: string;
  treatment: "taxable" | "reverse_charge";
  taxRate: number;
}

export interface InvoiceResult {
  success: boolean;
  mock: boolean;
  invoiceId?: number | string;
  invoiceNumber: string;
  invoiceUrl: string;
  invoicePdfUrl?: string;
  totalAmount: number;
  taxRate: number;
  reverseCharge: boolean;
  client: InvoicingClient;
  /** Provider scope of a trusted server-side create receipt; contains no credentials. */
  provider?: Readonly<{ origin: string; companyId: string }>;
  error?: string;
  errorCode?: string;
  requiresReconciliation?: boolean;
}

export interface InvoiceExecutionOptions {
  taxDecision?: VerifiedTaxDecision;
  /** Test fixtures require NODE_ENV=test and an injected fetch. No real credentials are used. */
  mode?: "test";
}

export type InvoiceEmailResult =
  | { success: true; mock: false; status: "accepted"; requiresReconciliation: false }
  | { success: true; mock: true; status: "mock"; requiresReconciliation: false }
  | {
      success: false;
      mock: false;
      status: "not_sent";
      message: string;
      requiresReconciliation: false;
    }
  | {
      success: false;
      mock: false;
      status: "unknown";
      message: string;
      requiresReconciliation: true;
    };

const InvoiceEmailSchema = z.string().trim().max(254).email();

function invoiceEmail(value: unknown): string | undefined {
  const parsed = InvoiceEmailSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

export const REVERSE_CHARGE_NOTICE = "Prenesenie daňovej povinnosti";

export const SUPERFAKTURA_COUNTRIES: Readonly<Record<string, number>> = Object.freeze({
  SK: 191,
  SLOVENSKO: 191,
  SLOVAKIA: 191,
  CZ: 56,
  CESKO: 56,
  "CESKA REPUBLIKA": 56,
  CZECHIA: 56,
  "CZECH REPUBLIC": 56,
  DE: 81,
  NEMECKO: 81,
  GERMANY: 81,
  AT: 15,
  RAKUSKO: 15,
  AUSTRIA: 15,
  PL: 175,
  POLSKO: 175,
  POLAND: 175,
  HU: 99,
  MADARSKO: 99,
  HUNGARY: 99,
});

function checkedDecision(value: unknown): VerifiedTaxDecision {
  const decision = value as Partial<VerifiedTaxDecision> | undefined;
  if (
    !decision ||
    typeof decision !== "object" ||
    decision.status !== "verified" ||
    typeof decision.reviewId !== "string" ||
    !decision.reviewId.trim() ||
    typeof decision.sellerProfileVersion !== "string" ||
    !decision.sellerProfileVersion.trim()
  ) {
    throw new Error("TAX_DECISION_REQUIRED: Chýba overené serverové daňové rozhodnutie.");
  }
  if (
    !Number.isFinite(decision.taxRate) ||
    decision.taxRate! < 0 ||
    decision.taxRate! > 100 ||
    (decision.treatment !== "taxable" && decision.treatment !== "reverse_charge") ||
    (decision.treatment === "taxable" && decision.taxRate! <= 0) ||
    (decision.treatment === "reverse_charge" && decision.taxRate !== 0)
  ) {
    throw new Error("INVALID_TAX_DECISION: Nepodporovaný alebo nekonzistentný daňový režim.");
  }
  return Object.freeze({
    status: "verified",
    reviewId: decision.reviewId,
    sellerProfileVersion: decision.sellerProfileVersion,
    treatment: decision.treatment,
    taxRate: decision.taxRate,
  }) as VerifiedTaxDecision;
}

function roundMoney(value: number): number {
  if (!Number.isFinite(value) || value < 0 || value > Number.MAX_SAFE_INTEGER / 100) {
    throw new Error("INVALID_AMOUNT: Suma musí byť konečná nezáporná hodnota.");
  }
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function resolveCountryId(country?: string): number {
  const normalized = country
    ?.trim()
    .toUpperCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  if (!normalized || !Object.hasOwn(SUPERFAKTURA_COUNTRIES, normalized)) {
    throw new Error(
      "UNSUPPORTED_COUNTRY: Krajina vyžaduje explicitné mapovanie; nepoužije sa SK fallback.",
    );
  }
  return SUPERFAKTURA_COUNTRIES[normalized];
}

/** @deprecated Country and VAT syntax do not establish reverse-charge eligibility. */
export function isReverseChargeEligible(
  _country?: string,
  _icDph?: string,
  decision?: VerifiedTaxDecision,
): boolean {
  return checkedDecision(decision).treatment === "reverse_charge";
}

/**
 * Arithmetic only: amountTotal is an already established final gross amount,
 * not a Stripe Price's tax-exclusive unit amount. No default VAT rate is chosen.
 * Legacy boolean inputs fail closed instead of guessing a tax treatment.
 */
export function calculateInvoiceAmounts(
  amountTotal: number,
  decision: VerifiedTaxDecision | boolean,
): { unitPrice: number; taxRate: number; taxAmount: number; total: number; notice?: string } {
  const approved = checkedDecision(decision);
  const total = roundMoney(amountTotal);
  const unitPrice = roundMoney(total / (1 + approved.taxRate / 100));
  const taxAmount = roundMoney(total - unitPrice);
  if (roundMoney(unitPrice * (1 + approved.taxRate / 100)) !== total) {
    throw new Error("ROUNDING_REVIEW_REQUIRED: Rozpis položky sa nezhoduje s konečnou sumou.");
  }
  return {
    unitPrice,
    taxRate: approved.taxRate,
    taxAmount,
    total,
    notice: approved.treatment === "reverse_charge" ? REVERSE_CHARGE_NOTICE : undefined,
  };
}

/** A limited single-line EUR builder; it is not an accounting/tax engine. */
export function buildSuperfakturaPayload(options: {
  plan: string;
  amountTotal: number;
  currency?: string;
  variableSymbol?: string;
  stripeSessionId?: string;
  client: InvoicingClient;
  taxDecision?: VerifiedTaxDecision;
}): CreateInvoicePayload {
  const decision = checkedDecision(options.taxDecision);
  if ((options.currency || "EUR").toUpperCase() !== "EUR") {
    throw new Error("UNSUPPORTED_CURRENCY: Tento builder podporuje iba EUR.");
  }
  const countryId = resolveCountryId(options.client.country);
  if (options.client.country_id !== undefined && options.client.country_id !== countryId) {
    throw new Error("COUNTRY_MISMATCH: Krajina a provider country_id sa nezhodujú.");
  }
  if (!options.plan.trim() || !options.client.name.trim() || !invoiceEmail(options.client.email)) {
    throw new Error("INVALID_INVOICE_INPUT: Chýbajú identifikačné údaje faktúry.");
  }
  const calculation = calculateInvoiceAmounts(options.amountTotal, decision);
  const planLabel = options.plan.toUpperCase();
  return {
    Invoice: {
      name: "Faktúra za predplatné SEO4WEB " + planLabel,
      variable: options.variableSymbol,
      currency: "EUR",
      invoice_currency: "EUR",
      payment_type: "card",
      order_no: options.stripeSessionId,
      // Issuance and settlement are separate. This builder never asserts payment.
      already_paid: 0,
      vat_transfer: decision.treatment === "reverse_charge" ? 1 : 0,
      comment: calculation.notice,
    },
    Client: { ...options.client, country_id: countryId },
    InvoiceItem: [
      {
        name: "SEO4WEB " + planLabel,
        quantity: 1,
        unit_price: calculation.unitPrice,
        tax: calculation.taxRate,
        description: calculation.notice,
      },
    ],
  };
}

type ProviderConfig = { baseUrl: string; companyId: string; authorization: string; test: boolean };

function providerConfig(fetchFn: typeof fetch | undefined, mode?: "test"): ProviderConfig {
  if (mode === "test") {
    if (process.env.NODE_ENV !== "test" || !fetchFn || fetchFn === globalThis.fetch) {
      throw new Error("TEST_MODE_REQUIRES_INJECTED_FETCH");
    }
    return {
      baseUrl: "https://superfaktura.invalid",
      companyId: "1",
      authorization:
        "SFAPI email=fixture%40example.invalid&apikey=fixture&module=SEO4WEB%20test&company_id=1",
      test: true,
    };
  }
  if (process.env.SUPERFAKTURA_INVOICING_ENABLED !== "true") {
    throw new Error("INVOICING_DISABLED");
  }
  const email = process.env.SUPERFAKTURA_EMAIL?.trim();
  const apiKey = process.env.SUPERFAKTURA_API_KEY?.trim();
  // APP_ID is not a company ID. Deliberately do not use the legacy ambiguous variable.
  const companyId = process.env.SUPERFAKTURA_COMPANY_ID?.trim();
  const moduleName = process.env.SUPERFAKTURA_MODULE?.trim() || "SEO4WEB";
  if (!email || !apiKey || !companyId || !/^[1-9]\d*$/.test(companyId)) {
    throw new Error("INVOICING_NOT_CONFIGURED");
  }
  const configuredUrl = process.env.SUPERFAKTURA_API_URL?.trim();
  const allowedOrigins = [
    "https://moja.superfaktura.sk",
    "https://sandbox.superfaktura.sk",
    "https://moje.superfaktura.cz",
    "https://sandbox.superfaktura.cz",
    "https://meine.superfaktura.at",
  ];
  if (!configuredUrl || !allowedOrigins.includes(configuredUrl.replace(/\/$/, ""))) {
    throw new Error("INVALID_PROVIDER_ORIGIN");
  }
  const fields = { email, apikey: apiKey, module: moduleName, company_id: companyId };
  const authorization =
    "SFAPI " +
    Object.entries(fields)
      .map(([key, value]) => key + "=" + encodeURIComponent(value))
      .join("&");
  return { baseUrl: configuredUrl.replace(/\/$/, ""), companyId, authorization, test: false };
}

function checkedPayload(payload: CreateInvoicePayload, decision: VerifiedTaxDecision): number {
  if (
    payload.Invoice.currency !== "EUR" ||
    (payload.Invoice.invoice_currency !== undefined &&
      payload.Invoice.invoice_currency !== "EUR") ||
    payload.Invoice.already_paid !== 0 ||
    payload.Invoice.vat_transfer !== (decision.treatment === "reverse_charge" ? 1 : 0) ||
    !Array.isArray(payload.InvoiceItem) ||
    payload.InvoiceItem.length < 1 ||
    payload.InvoiceItem.length > 100
  ) {
    throw new Error("INVALID_INVOICE_PAYLOAD");
  }
  if (decision.treatment === "reverse_charge" && payload.Invoice.comment !== REVERSE_CHARGE_NOTICE)
    throw new Error("INVALID_REVERSE_CHARGE_NOTICE");
  if (
    !payload.Client.name?.trim() ||
    !invoiceEmail(payload.Client.email) ||
    payload.Client.country_id !== resolveCountryId(payload.Client.country)
  )
    throw new Error("INVALID_CLIENT");
  let total = 0;
  for (const item of payload.InvoiceItem) {
    if (
      item.tax !== decision.taxRate ||
      !Number.isFinite(item.quantity) ||
      typeof item.unit_price !== "number" ||
      !Number.isFinite(item.unit_price) ||
      item.quantity <= 0 ||
      !item.name?.trim()
    )
      throw new Error("INVALID_INVOICE_ITEM");
    const base = roundMoney(item.unit_price * item.quantity);
    total += roundMoney(base * (1 + decision.taxRate / 100));
  }
  return roundMoney(total);
}

function numericId(value: unknown): string | undefined {
  const text = typeof value === "number" || typeof value === "string" ? String(value) : "";
  return /^[1-9]\d*$/.test(text) && Number.isSafeInteger(Number(text)) ? text : undefined;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/**
 * POST /invoices/create, disabled by default and without automatic retries.
 * After any uncertain provider response, reconcile before trying another create.
 */
export async function createSuperfakturaInvoice(
  payload: CreateInvoicePayload,
  fetchFn?: typeof fetch,
  options: InvoiceExecutionOptions = {},
): Promise<InvoiceResult> {
  let decision: VerifiedTaxDecision | undefined;
  let totalAmount = 0;
  // The caller can reuse/edit its payload while awaiting the provider. Keep the confirmed client
  // independent of that mutable object so later edits cannot redirect an existing invoice.
  const client = Object.freeze({ ...payload.Client });
  const fail = (
    errorCode: string,
    requiresReconciliation = false,
    invoiceId?: string,
  ): InvoiceResult => ({
    success: false,
    mock: false,
    invoiceId,
    invoiceNumber: "",
    invoiceUrl: "",
    totalAmount,
    taxRate: decision?.taxRate ?? 0,
    reverseCharge: decision?.treatment === "reverse_charge",
    client,
    errorCode,
    // No provider bodies, customer details, URLs or exception messages enter logs/errors.
    error: requiresReconciliation
      ? "Výsledok vystavenia nie je potvrdený. Pred opakovaním je potrebná kontrola u poskytovateľa."
      : "Faktúra nebola vystavená: " + errorCode,
    requiresReconciliation,
  });
  let config: ProviderConfig;
  try {
    decision = checkedDecision(options.taxDecision);
    totalAmount = checkedPayload(payload, decision);
    config = providerConfig(fetchFn, options.mode);
  } catch (error) {
    const code = error instanceof Error ? error.message.split(":")[0] : "INVALID_INVOICE_INPUT";
    const safeCodes = new Set([
      "TAX_DECISION_REQUIRED",
      "INVALID_TAX_DECISION",
      "INVALID_AMOUNT",
      "UNSUPPORTED_COUNTRY",
      "INVALID_INVOICE_PAYLOAD",
      "INVALID_REVERSE_CHARGE_NOTICE",
      "INVALID_CLIENT",
      "INVALID_INVOICE_ITEM",
      "TEST_MODE_REQUIRES_INJECTED_FETCH",
      "INVOICING_DISABLED",
      "INVOICING_NOT_CONFIGURED",
      "INVALID_PROVIDER_ORIGIN",
    ]);
    return fail(safeCodes.has(code) ? code : "INVALID_INVOICE_INPUT");
  }
  try {
    const res = await (fetchFn ?? fetch)(config.baseUrl + "/invoices/create", {
      method: "POST",
      redirect: "error",
      headers: { Authorization: config.authorization, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return fail("PROVIDER_HTTP_" + res.status, true);
    const json = record(await res.json());
    if (!json || json.error !== 0) {
      return fail(
        json && typeof json.error === "number" ? "PROVIDER_REJECTED" : "INVALID_PROVIDER_RESPONSE",
        true,
      );
    }
    const data = record(json.data);
    const invoice = record(data?.Invoice);
    const invoiceId = numericId(invoice?.id);
    const token = invoice?.token;
    const invoiceNumber = invoice?.invoice_no_formatted;
    const providerTotal = record(data?.Summary)?.invoice_total;
    if (
      !invoiceId ||
      typeof token !== "string" ||
      !token.trim() ||
      typeof invoiceNumber !== "string" ||
      !invoiceNumber.trim() ||
      typeof providerTotal !== "number" ||
      !Number.isFinite(providerTotal) ||
      providerTotal < 0 ||
      roundMoney(providerTotal) !== totalAmount
    )
      return fail("INVALID_PROVIDER_RESPONSE", true, invoiceId);
    const pdfUrl =
      config.baseUrl + "/invoices/pdf/" + invoiceId + "/token:" + encodeURIComponent(token);
    return {
      success: true,
      mock: config.test,
      invoiceId,
      invoiceNumber,
      // Only the documented PDF URL is constructed, not an invented public view route.
      invoiceUrl: pdfUrl,
      invoicePdfUrl: pdfUrl,
      totalAmount: roundMoney(providerTotal),
      taxRate: decision.taxRate,
      reverseCharge: decision.treatment === "reverse_charge",
      client,
      provider: Object.freeze({ origin: config.baseUrl, companyId: config.companyId }),
    };
  } catch {
    return fail("PROVIDER_OUTCOME_UNKNOWN", true);
  }
}

/**
 * Explicitly enabled sending of a confirmed invoice; never used by the checkout webhook.
 * A receipt must come from trusted server-side storage, not a caller-supplied JSON object.
 * "accepted" confirms the provider acknowledgement, not delivery to the recipient's inbox.
 * Reconcile an unknown result before retrying; this function never retries or recreates invoices.
 */
export async function sendInvoiceEmail(
  invoiceId: number | string,
  recipientEmail: string,
  fetchFn?: typeof fetch,
  options: { mode?: "test"; confirmedInvoice?: InvoiceResult } = {},
): Promise<InvoiceEmailResult> {
  const fail = (message: string, uncertain = false): InvoiceEmailResult =>
    uncertain
      ? { success: false, mock: false, status: "unknown", message, requiresReconciliation: true }
      : { success: false, mock: false, status: "not_sent", message, requiresReconciliation: false };
  const receipt = record(options.confirmedInvoice);
  const invoice = numericId(invoiceId);
  const recipient = invoiceEmail(recipientEmail);
  const confirmedRecipient = invoiceEmail(record(receipt?.client)?.email);
  const provider = record(receipt?.provider);
  if (
    !invoice ||
    !recipient ||
    !confirmedRecipient ||
    receipt?.success !== true ||
    (receipt.mock !== true && receipt.mock !== false) ||
    receipt.requiresReconciliation === true ||
    numericId(receipt.invoiceId) !== invoice ||
    confirmedRecipient.toLowerCase() !== recipient.toLowerCase() ||
    typeof provider?.origin !== "string" ||
    typeof provider.companyId !== "string" ||
    (options.mode !== "test" && receipt.mock === true)
  )
    return fail("CONFIRMED_INVOICE_REQUIRED");
  if (options.mode !== "test" && process.env.SUPERFAKTURA_EMAIL_ENABLED !== "true") {
    return fail("INVOICE_EMAIL_DISABLED");
  }
  let config: ProviderConfig;
  try {
    config = providerConfig(fetchFn, options.mode);
  } catch {
    return fail("INVOICING_NOT_CONFIGURED");
  }
  if (provider.origin !== config.baseUrl || provider.companyId !== config.companyId)
    return fail("INVOICE_PROVIDER_MISMATCH");
  try {
    const res = await (fetchFn ?? fetch)(config.baseUrl + "/invoices/send", {
      method: "POST",
      redirect: "error",
      headers: { Authorization: config.authorization, "Content-Type": "application/json" },
      body: JSON.stringify({
        Email: { invoice_id: Number(invoice), to: recipient, pdf_language: "slo" },
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return fail("EMAIL_OUTCOME_UNKNOWN", true);
    const response = record(await res.json());
    if (
      typeof response?.error === "number" &&
      Number.isSafeInteger(response.error) &&
      response.error > 0
    )
      return fail("EMAIL_NOT_CONFIRMED");
    const acknowledgement = record(record(response?.data)?.Invoice);
    const acknowledgedRecipient = invoiceEmail(acknowledgement?.recipient);
    if (
      response?.error !== 0 ||
      numericId(acknowledgement?.invoice_id) !== invoice ||
      acknowledgedRecipient?.toLowerCase() !== recipient.toLowerCase()
    )
      return fail("EMAIL_OUTCOME_UNKNOWN", true);
    return config.test
      ? { success: true, mock: true, status: "mock", requiresReconciliation: false }
      : { success: true, mock: false, status: "accepted", requiresReconciliation: false };
  } catch {
    return fail("EMAIL_OUTCOME_UNKNOWN", true);
  }
}
