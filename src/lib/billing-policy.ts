import type { PlanId } from "./slovak-billing";

export type SubscriptionAccessRecord = {
  plan?: string | null;
  status?: string | null;
  current_period_end?: string | null;
};

/** Display and server gates share this policy. Redirects never grant access. */
export function getEffectivePlan(
  subscription: SubscriptionAccessRecord | null | undefined,
  now: number = Date.now(),
): PlanId {
  if (!subscription || !Number.isFinite(now)) return "free";
  if (subscription.plan !== "pro" && subscription.plan !== "agency") return "free";
  if (subscription.status !== "active" && subscription.status !== "trialing") return "free";
  const periodEnd = subscription.current_period_end
    ? Date.parse(subscription.current_period_end)
    : Number.NaN;
  return Number.isFinite(periodEnd) && periodEnd > now ? subscription.plan : "free";
}

export function hasPaidEntitlement(
  subscription: SubscriptionAccessRecord | null | undefined,
  now: number = Date.now(),
): boolean {
  return getEffectivePlan(subscription, now) !== "free";
}

/** A recoverable/delinquent subscription must be managed, not sold a second time. */
export function blocksNewCheckout(status: string): boolean {
  return !["canceled", "incomplete_expired"].includes(status);
}
