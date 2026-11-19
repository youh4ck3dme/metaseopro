import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { automaticTaxForCheckout, getStripeClient, stripeLivemode } from "./stripe.server";

let networkGuard: ReturnType<typeof vi.fn<typeof fetch>>;
beforeEach(() => {
  vi.stubEnv("STRIPE_SECRET_KEY", "");
  vi.stubEnv("STRIPE_AUTOMATIC_TAX_ENABLED", "");
  networkGuard = vi.fn<typeof fetch>().mockRejectedValue(new Error("Unexpected Stripe request"));
  vi.stubGlobal("fetch", networkGuard);
});
afterEach(() => {
  expect(networkGuard).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("server Stripe configuration", () => {
  it("has no client or invented billing mode when configuration is missing", () => {
    expect(getStripeClient()).toBeNull();
    expect(() => stripeLivemode()).toThrow("nakonfigurovaný");
  });

  it("rejects a publishable key or an unsupported secret format", () => {
    for (const key of ["pk_test_fixture", "not-a-stripe-key"]) {
      vi.stubEnv("STRIPE_SECRET_KEY", key);
      expect(() => getStripeClient()).toThrow("formát");
      expect(() => stripeLivemode()).toThrow("nakonfigurovaný");
    }
  });

  it("derives test/live mode consistently for secret and restricted keys without making HTTP calls", () => {
    for (const [key, livemode] of [
      ["sk_test_fixture", false],
      ["rk_test_fixture", false],
      ["sk_live_fixture", true],
      ["rk_live_fixture", true],
    ] as const) {
      vi.stubEnv("STRIPE_SECRET_KEY", key);
      expect(getStripeClient()).not.toBeNull();
      expect(stripeLivemode()).toBe(livemode);
    }
  });

  it("requires explicit automatic tax in live mode but permits a deliberate test setup", () => {
    expect(() => automaticTaxForCheckout(true)).toThrow("Stripe Tax");
    expect(automaticTaxForCheckout(false)).toBe(false);
    vi.stubEnv("STRIPE_AUTOMATIC_TAX_ENABLED", "true");
    expect(automaticTaxForCheckout(true)).toBe(true);
    expect(automaticTaxForCheckout(false)).toBe(true);
  });
});
