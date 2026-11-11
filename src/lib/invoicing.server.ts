// SuperFaktúra & Fakturoid automated B2B invoicing connector for SEO4WEB
// Handles Slovak 20% VAT vs. EU Reverse Charge (§ 69 ods. 3 zákona o DPH),
// POST /invoices/create and POST /invoices/sendInvoiceEmail with graceful mock fallback.

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
  tax: number; // 0 or 20
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
  };
  Client: InvoicingClient;
  InvoiceItem: InvoiceItem[];
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
  error?: string;
}

export const REVERSE_CHARGE_NOTICE =
  "Dodanie tovaru/služby s prenesením daňovej povinnosti podľa § 69 ods. 3 zákona o DPH";

/**
 * Standard SuperFaktúra country IDs:
 * 191 = Slovensko (SK)
 * 56  = Česká republika (CZ)
 * 81  = Nemecko (DE)
 * 15  = Rakúsko (AT)
 * 175 = Poľsko (PL)
 * 99  = Maďarsko (HU)
 */
export const SUPERFAKTURA_COUNTRIES: Record<string, number> = {
  SK: 191,
  SLOVENSKO: 191,
  SLOVAKIA: 191,
  CZ: 56,
  CESKO: 56,
  "CESKA REPUBLIKA": 56,
  "ČESKÁ REPUBLIKA": 56,
  CZECHIA: 56,
  "CZECH REPUBLIC": 56,
  DE: 81,
  NEMECKO: 81,
  GERMANY: 81,
  AT: 15,
  RAKUSKO: 15,
  RAKÚSKO: 15,
  AUSTRIA: 15,
  PL: 175,
  POLSKO: 175,
  POĽSKO: 175,
  POLAND: 175,
  HU: 99,
  MADARSKO: 99,
  MAĎARSKO: 99,
  HUNGARY: 99,
};

export function resolveCountryId(country?: string): number {
  if (!country) return 191; // Default: Slovensko
  const normalized = country
    .trim()
    .toUpperCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

  return SUPERFAKTURA_COUNTRIES[normalized] ?? 191;
}

/**
 * Evaluates whether EU Reverse Charge (Prenesenie daňovej povinnosti) applies:
 * - Client must have a non-empty foreign EU VAT ID (IČ DPH not starting with 'SK').
 * - Country must be outside Slovakia (or countryId !== 191).
 */
export function isReverseChargeEligible(country?: string, icDph?: string): boolean {
  if (!icDph) return false;
  const cleanVat = icDph.trim().toUpperCase().replace(/\s+/g, "");
  if (!cleanVat || cleanVat.startsWith("SK")) {
    return false;
  }

  const countryId = resolveCountryId(country);
  return countryId !== 191;
}

/**
 * Computes net price, VAT, and invoice notes according to Slovak VAT legislation:
 * - SK entities & consumer sales: 20% DPH (unit_price is base excluding VAT).
 * - Foreign EU businesses with valid VAT ID: 0% DPH (Reverse charge under § 69 ods. 3).
 */
export function calculateInvoiceAmounts(
  amountTotal: number,
  isReverseCharge: boolean,
): {
  unitPrice: number;
  taxRate: number;
  taxAmount: number;
  total: number;
  notice?: string;
} {
  const roundedTotal = Number(amountTotal.toFixed(2));

  if (isReverseCharge) {
    return {
      unitPrice: roundedTotal,
      taxRate: 0,
      taxAmount: 0,
      total: roundedTotal,
      notice: REVERSE_CHARGE_NOTICE,
    };
  }

  // Standard Slovak 20% VAT
  const unitPrice = Number((roundedTotal / 1.2).toFixed(2));
  const taxAmount = Number((roundedTotal - unitPrice).toFixed(2));

  return {
    unitPrice,
    taxRate: 20,
    taxAmount,
    total: roundedTotal,
  };
}

/**
 * Prepares the complete SuperFaktúra invoice payload.
 */
export function buildSuperfakturaPayload(options: {
  plan: string;
  amountTotal: number;
  currency?: string;
  variableSymbol?: string;
  stripeSessionId?: string;
  client: InvoicingClient;
}): CreateInvoicePayload {
  const currency = (options.currency || "EUR").toUpperCase();
  const planLabel = options.plan.toUpperCase();
  const countryId = options.client.country_id ?? resolveCountryId(options.client.country);

  const reverseCharge = isReverseChargeEligible(options.client.country, options.client.ic_dph);
  const calculation = calculateInvoiceAmounts(options.amountTotal, reverseCharge);

  return {
    Invoice: {
      name: `Faktúra za predplatné SEO4WEB ${planLabel}`,
      variable: options.variableSymbol || options.stripeSessionId?.slice(-10) || "20260001",
      currency,
      payment_type: "card",
      order_no: options.stripeSessionId,
      already_paid: 1, // Stripe charges card immediately
      comment: calculation.notice,
    },
    Client: {
      ...options.client,
      country_id: countryId,
    },
    InvoiceItem: [
      {
        name: `SEO4WEB ${planLabel} (Mesačné predplatné)`,
        quantity: 1,
        unit_price: calculation.unitPrice,
        tax: calculation.taxRate,
        description: calculation.notice,
      },
    ],
  };
}

/**
 * Issues an invoice via SuperFaktúra REST API (/invoices/create).
 * If API credentials are not set, gracefully generates a simulated mock invoice.
 */
export async function createSuperfakturaInvoice(
  payload: CreateInvoicePayload,
  fetchFn: typeof fetch = fetch,
): Promise<InvoiceResult> {
  const email = process.env.SUPERFAKTURA_EMAIL;
  const apiKey = process.env.SUPERFAKTURA_API_KEY;
  const appId = process.env.SUPERFAKTURA_APP_ID;
  const baseUrl = (process.env.SUPERFAKTURA_API_URL || "https://moja.superfaktura.sk").replace(
    /\/$/,
    "",
  );

  const reverseCharge = payload.InvoiceItem[0]?.tax === 0;
  const taxRate = payload.InvoiceItem[0]?.tax ?? 20;
  const totalAmount = reverseCharge
    ? (payload.InvoiceItem[0]?.unit_price ?? 0)
    : Number(((payload.InvoiceItem[0]?.unit_price ?? 0) * 1.2).toFixed(2));

  // Graceful fallback when credentials are not configured
  if (!email || !apiKey) {
    const varSym = payload.Invoice.variable || "20260001";
    const mockId = Math.floor(100000 + Math.random() * 900000);
    const mockNumber = `FAK-${new Date().getFullYear()}-${varSym}`;
    const mockUrl = `${baseUrl}/invoices/view/mock_${varSym}`;

    console.info(
      `[SuperFaktura Mock] Vystavená simulovaná faktúra ${mockNumber} pre ${payload.Client.name} (${totalAmount} €)`,
    );

    return {
      success: true,
      mock: true,
      invoiceId: mockId,
      invoiceNumber: mockNumber,
      invoiceUrl: mockUrl,
      invoicePdfUrl: `${baseUrl}/invoices/pdf/mock_${varSym}`,
      totalAmount,
      taxRate,
      reverseCharge,
      client: payload.Client,
    };
  }

  // Live SuperFaktúra API call
  try {
    const authHeader = `SFAPI email=${encodeURIComponent(email)}&apikey=${encodeURIComponent(
      apiKey,
    )}${appId ? `&company_id=${encodeURIComponent(appId)}` : ""}`;

    const res = await fetchFn(`${baseUrl}/invoices/create`, {
      method: "POST",
      headers: {
        Authorization: authHeader,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      console.error(
        `[SuperFaktura API] HTTP chyba pri vystavení faktúry (${res.status}):`,
        errText,
      );
      return {
        success: false,
        mock: false,
        invoiceNumber: "",
        invoiceUrl: "",
        totalAmount,
        taxRate,
        reverseCharge,
        client: payload.Client,
        error: `SuperFaktura API HTTP ${res.status}: ${errText}`,
      };
    }

    const json = (await res.json().catch(() => ({}))) as {
      error?: number;
      message?: string;
      data?: {
        Invoice?: {
          id?: number;
          token?: string;
          invoice_no_formatted?: string;
          variable?: string;
        };
      };
    };

    if (json.error && json.error !== 0) {
      console.error("[SuperFaktura API] Chyba vo validačnej odpovedi:", json.message);
      return {
        success: false,
        mock: false,
        invoiceNumber: "",
        invoiceUrl: "",
        totalAmount,
        taxRate,
        reverseCharge,
        client: payload.Client,
        error: json.message || "SuperFaktura odmietla dáta faktúry",
      };
    }

    const inv = json.data?.Invoice;
    const invoiceId = inv?.id || Math.floor(100000 + Math.random() * 900000);
    const token = inv?.token || payload.Invoice.variable || "token";
    const invoiceNumber = inv?.invoice_no_formatted || String(inv?.variable || invoiceId);

    const invoiceUrl = `${baseUrl}/invoices/view/${token}`;
    const invoicePdfUrl = `${baseUrl}/invoices/pdf/${invoiceId}/token:${token}`;

    return {
      success: true,
      mock: false,
      invoiceId,
      invoiceNumber,
      invoiceUrl,
      invoicePdfUrl,
      totalAmount,
      taxRate,
      reverseCharge,
      client: payload.Client,
    };
  } catch (err) {
    console.error("[SuperFaktura API] Výnimka pri komunikácii:", err);
    return {
      success: false,
      mock: false,
      invoiceNumber: "",
      invoiceUrl: "",
      totalAmount,
      taxRate,
      reverseCharge,
      client: payload.Client,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Sends the invoice PDF directly to client's email via SuperFaktúra (/invoices/sendInvoiceEmail).
 */
export async function sendInvoiceEmail(
  invoiceId: number | string,
  recipientEmail: string,
  fetchFn: typeof fetch = fetch,
): Promise<{ success: boolean; mock: boolean; message?: string }> {
  const email = process.env.SUPERFAKTURA_EMAIL;
  const apiKey = process.env.SUPERFAKTURA_API_KEY;
  const appId = process.env.SUPERFAKTURA_APP_ID;
  const baseUrl = (process.env.SUPERFAKTURA_API_URL || "https://moja.superfaktura.sk").replace(
    /\/$/,
    "",
  );

  if (!email || !apiKey) {
    console.info(
      `[SuperFaktura Mock] Simulované odoslanie PDF faktúry #${invoiceId} na ${recipientEmail}`,
    );
    return {
      success: true,
      mock: true,
      message: `Simulované odoslanie PDF na ${recipientEmail}`,
    };
  }

  try {
    const authHeader = `SFAPI email=${encodeURIComponent(email)}&apikey=${encodeURIComponent(
      apiKey,
    )}${appId ? `&company_id=${encodeURIComponent(appId)}` : ""}`;

    const res = await fetchFn(`${baseUrl}/invoices/sendInvoiceEmail`, {
      method: "POST",
      headers: {
        Authorization: authHeader,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        Email: {
          invoice_id: Number(invoiceId),
          to: recipientEmail,
          pdf_language: "slo",
        },
      }),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      console.warn(`[SuperFaktura API] Odoslanie e-mailu zlyhalo (${res.status}):`, errText);
      return { success: false, mock: false, message: `HTTP ${res.status}: ${errText}` };
    }

    return { success: true, mock: false };
  } catch (err) {
    console.warn("[SuperFaktura API] Výnimka pri odosielaní e-mailu faktúry:", err);
    return {
      success: false,
      mock: false,
      message: err instanceof Error ? err.message : String(err),
    };
  }
}
