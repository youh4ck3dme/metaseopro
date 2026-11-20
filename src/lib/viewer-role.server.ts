// Server-only superadmin / effective-plan resolution.
//
// This is the ONE place that decides whether a user bypasses plan limits,
// quotas, per-user rate limits and paywalls. Every gate must call it instead of
// re-implementing the check.
//
// Superadmin = user.id listed in ADMIN_USER_IDS. Only the verified user id from
// the server-side token is considered: email, user_metadata, app_metadata and
// anything the client sends are ignored. Fail closed: no user / no id / any
// error => not admin.
import { isAdminUser } from "./admin.server";
import { getEffectivePlan, type SubscriptionAccessRecord } from "./billing-policy";
import { checkRateLimit } from "./rate-limit.server";
import type { PlanId } from "./slovak-billing";

export type ViewerPlan = PlanId | "admin";

export type ViewerRole = {
  isAdmin: boolean;
  plan: ViewerPlan;
};

/** Minimal identity accepted here: only the verified user id is ever read. */
export type ViewerIdentity = { id?: string | null } | null | undefined;

function hasAdminUserIdsConfigured(): boolean {
  return (process.env.ADMIN_USER_IDS || "").split(",").some((v) => v.trim().length > 0);
}

/**
 * True only when the verified user id is listed in ADMIN_USER_IDS.
 * Never falls back to ADMIN_EMAILS: isAdminUser() receives the id alone, and an
 * empty/unset ADMIN_USER_IDS means nobody is a superadmin.
 */
export function isUnlimited(user: ViewerIdentity): boolean {
  try {
    const id = typeof user?.id === "string" ? user.id.trim() : "";
    if (!id) return false;
    if (!hasAdminUserIdsConfigured()) return false;
    return isAdminUser({ id });
  } catch {
    return false;
  }
}

/** Effective plan for gates and UI: "admin" for superadmins, else the paid plan policy. */
export function getViewerPlan(
  user: ViewerIdentity,
  subscription: SubscriptionAccessRecord | null | undefined,
  now: number = Date.now(),
): ViewerPlan {
  if (isUnlimited(user)) return "admin";
  return getEffectivePlan(subscription, now);
}

export function resolveViewerRole(
  user: ViewerIdentity,
  subscription: SubscriptionAccessRecord | null | undefined,
  now: number = Date.now(),
): ViewerRole {
  const plan = getViewerPlan(user, subscription, now);
  return { isAdmin: plan === "admin", plan };
}

/** Paid-feature gate: superadmin or a current paid entitlement. */
export function hasViewerPaidAccess(
  user: ViewerIdentity,
  subscription: SubscriptionAccessRecord | null | undefined,
  now: number = Date.now(),
): boolean {
  return getViewerPlan(user, subscription, now) !== "free";
}

/**
 * Per-user rate limit for paid/AI endpoints. Superadmins bypass it; everyone
 * else gets exactly the existing limit. The bucket key is unchanged.
 *
 * DECISION (Erik, 2026-11-17): the admin bypass is a FULL bypass with NO cap
 * (not even a 10x limit). Bora's review (P2-1) recommended a 10x cap as
 * protection against a stolen admin token; Erik knowingly accepted the risk
 * and confirmed "admin bez limitov". This is intentional, not a bug. Do not add
 * a cap here without a new decision from Erik.
 */
export function checkViewerRateLimit(
  user: ViewerIdentity,
  key: string,
  opts: { limit: number; windowMs: number },
): { ok: true } | { ok: false; retryAfterSec: number } {
  if (isUnlimited(user)) return { ok: true };
  return checkRateLimit(key, opts);
}
