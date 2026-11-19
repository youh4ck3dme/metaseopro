import { describe, expect, it } from "vitest";
import { checkoutPlanLabel } from "./billing-ui";

describe("checkout plan labels", () => {
  it("labels a Pro checkout with the existing Pro monthly price", () => {
    expect(checkoutPlanLabel("pro")).toBe("SEO4WEB Pro (39 € / mesiac)");
  });

  it("labels an Agency checkout as Agency with its price, not Pro", () => {
    expect(checkoutPlanLabel("agency")).toBe("SEO4WEB Agency (89 € / mesiac)");
  });
});
