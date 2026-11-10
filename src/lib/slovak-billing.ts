// Slovak & Czech B2B billing validator and subscription helpers
// Supports IČO checksum validation, DIČ (mod 11), and IČ DPH (SK prefix).

/**
 * Validates a Slovak or Czech 8-digit IČO using weighted modulo 11 checksum.
 * Weights: [8, 7, 6, 5, 4, 3, 2]
 */
export function isValidICO(ico: string): boolean {
  if (!ico) return false;
  const clean = ico.trim().replace(/\s+/g, "");
  if (!/^\d{8}$/.test(clean)) return false;

  const digits = clean.split("").map(Number);
  const weights = [8, 7, 6, 5, 4, 3, 2];

  let sum = 0;
  for (let i = 0; i < 7; i++) {
    sum += digits[i]! * weights[i]!;
  }

  const remainder = sum % 11;
  let checkDigit: number;
  if (remainder === 0) {
    checkDigit = 1;
  } else if (remainder === 1) {
    checkDigit = 0;
  } else {
    checkDigit = 11 - remainder;
  }

  return checkDigit === digits[7];
}

/**
 * Validates Slovak DIČ:
 * - Exactly 10 digits
 * - Starts with 10 (SZČO / physical person), 20 (legal entity / s.r.o.), or 21 (other organizations)
 * - Whole 10-digit number must be cleanly divisible by 11
 */
export function isValidDIC(dic: string): boolean {
  if (!dic) return false;
  const clean = dic.trim().replace(/\s+/g, "");
  if (!/^\d{10}$/.test(clean)) return false;

  const prefix = clean.slice(0, 2);
  if (!["10", "20", "21"].includes(prefix)) {
    return false;
  }

  try {
    return BigInt(clean) % 11n === 0n;
  } catch {
    return false;
  }
}

/**
 * Validates Slovak IČ DPH:
 * - Starts with 'SK' (case insensitive)
 * - Followed by valid 10-digit DIČ
 */
export function isValidICDPH(icDph: string): boolean {
  if (!icDph) return false;
  const clean = icDph.trim().toUpperCase().replace(/\s+/g, "");
  if (!clean.startsWith("SK")) return false;
  const numericPart = clean.slice(2);
  return isValidDIC(numericPart);
}

export function normalizeICO(ico: string): string {
  return ico.trim().replace(/\s+/g, "");
}

export function normalizeDIC(dic: string): string {
  return dic.trim().replace(/\s+/g, "");
}

export function normalizeICDPH(icDph: string): string {
  const clean = icDph.trim().toUpperCase().replace(/\s+/g, "");
  if (!clean.startsWith("SK")) {
    return `SK${clean}`;
  }
  return clean;
}

export type PlanId = "free" | "pro" | "agency";

export type PlanConfig = {
  id: PlanId;
  name: string;
  priceMonthly: number;
  priceIdEnvVar?: string;
  maxProjects: number;
  maxAuditUrls: number;
  unlimitedDecay: boolean;
  canExportWordPress: boolean;
};

export const PLANS: Record<PlanId, PlanConfig> = {
  free: {
    id: "free",
    name: "Free",
    priceMonthly: 0,
    maxProjects: 1,
    maxAuditUrls: 3,
    unlimitedDecay: false,
    canExportWordPress: false,
  },
  pro: {
    id: "pro",
    name: "Pro",
    priceMonthly: 39,
    priceIdEnvVar: "STRIPE_PRICE_PRO_MONTHLY",
    maxProjects: 5,
    maxAuditUrls: Infinity,
    unlimitedDecay: true,
    canExportWordPress: true,
  },
  agency: {
    id: "agency",
    name: "Agency",
    priceMonthly: 89,
    priceIdEnvVar: "STRIPE_PRICE_AGENCY_MONTHLY",
    maxProjects: Infinity,
    maxAuditUrls: Infinity,
    unlimitedDecay: true,
    canExportWordPress: true,
  },
};

export function validateCompanyBilling(data: {
  companyName?: string;
  ico?: string;
  dic?: string;
  icDph?: string;
}): { valid: boolean; errors: Record<string, string> } {
  const errors: Record<string, string> = {};

  if (data.ico && !isValidICO(data.ico)) {
    errors.ico = "Zadané IČO má neplatný formát alebo kontrolnú číslicu.";
  }

  if (data.dic && !isValidDIC(data.dic)) {
    errors.dic = "Neplatné DIČ (musí mať 10 číslic, začínať na 10, 20 alebo 21 a byť deliteľné 11).";
  }

  if (data.icDph && !isValidICDPH(data.icDph)) {
    errors.icDph = "Neplatné IČ DPH (očakávaný formát: SK + 10-miestne DIČ).";
  }

  return {
    valid: Object.keys(errors).length === 0,
    errors,
  };
}
