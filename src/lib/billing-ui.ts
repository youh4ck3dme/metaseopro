import { PLANS, type PlanId } from "./slovak-billing";

/** Display the same plan name and monthly amount used by the billing configuration. */
export function checkoutPlanLabel(plan: Exclude<PlanId, "free">): string {
  const config = PLANS[plan];
  return `SEO4WEB ${config.name} (${config.priceMonthly} € / mesiac)`;
}
