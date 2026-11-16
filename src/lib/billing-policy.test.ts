import { describe, expect, it } from "vitest";
import { blocksNewCheckout, getEffectivePlan, hasPaidEntitlement } from "./billing-policy";

const now = Date.parse("2026-11-16T12:00:00.000Z");
const record = {
  plan: "pro",
  status: "active",
  current_period_end: "2026-12-16T12:00:00.000Z",
};

describe("billing entitlement", () => {
  it("grants only a known paid tier in an active or trialing unexpired period", () => {
    expect(getEffectivePlan(record, now)).toBe("pro");
    expect(getEffectivePlan({ ...record, plan: "agency", status: "trialing" }, now)).toBe("agency");
    expect(hasPaidEntitlement(record, now)).toBe(true);
  });

  it.each(["past_due", "unpaid", "paused", "incomplete", "incomplete_expired", "canceled"])(
    "%s never grants paid access even with a future stored period",
    (status) => expect(getEffectivePlan({ ...record, status }, now)).toBe("free"),
  );

  it("rejects absent/invalid/expired periods and expires at the exact boundary", () => {
    for (const current_period_end of [null, "", "bad", new Date(now).toISOString()]) {
      expect(getEffectivePlan({ ...record, current_period_end }, now)).toBe("free");
    }
    expect(getEffectivePlan(null, now)).toBe("free");
    expect(getEffectivePlan({ ...record, plan: "constructor" }, now)).toBe("free");
    expect(getEffectivePlan(record, Number.NaN)).toBe("free");
  });

  it("routes recovery states to management instead of allowing a second subscription", () => {
    for (const status of ["active", "trialing", "past_due", "unpaid", "paused", "incomplete"]) {
      expect(blocksNewCheckout(status)).toBe(true);
    }
    expect(blocksNewCheckout("canceled")).toBe(false);
    expect(blocksNewCheckout("incomplete_expired")).toBe(false);
    expect(blocksNewCheckout("unknown_future_status")).toBe(true);
  });
});
