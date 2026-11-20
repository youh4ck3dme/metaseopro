import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { BillingPortalCard, type BillingPortalState } from "./BillingPortalCard";

function renderCard(state: BillingPortalState, opening = false) {
  const onOpen = vi.fn();
  const onRetry = vi.fn();
  const html = renderToStaticMarkup(
    <BillingPortalCard state={state} opening={opening} onOpen={onOpen} onRetry={onRetry} />,
  );
  expect(onOpen).not.toHaveBeenCalled();
  expect(onRetry).not.toHaveBeenCalled();
  return html;
}

describe("BillingPortalCard rendering", () => {
  it("shows a loading status without presenting a guessed Free plan or a portal action", () => {
    const html = renderCard({ status: "loading" });
    expect(html).toContain('role="status"');
    expect(html).toContain("Načítavam správu predplatného");
    expect(html).not.toContain("<button");
    expect(html).not.toContain("Free");
  });

  it("shows the load failure with a retry action instead of a portal action", () => {
    const html = renderCard({ status: "error", message: "Predplatné sa nepodarilo načítať." });
    expect(html).toContain('role="alert"');
    expect(html).toContain("Predplatné sa nepodarilo načítať.");
    expect(html).toContain("Skúsiť načítať znova");
    expect(html).not.toContain("Spravovať predplatné");
  });

  it("does not offer a portal when the server reports no Stripe customer", () => {
    expect(renderCard({ status: "ready", hasStripeCustomer: false })).toBe("");
  });

  it("offers a portal when a Stripe customer exists, with no paid-plan requirement", () => {
    const html = renderCard({ status: "ready", hasStripeCustomer: true });
    expect(html).toContain("Spravovať predplatné");
    expect(html).toContain('type="button"');
    expect(html).not.toContain('disabled=""');
  });

  it("disables the action while opening a portal session", () => {
    const html = renderCard({ status: "ready", hasStripeCustomer: true }, true);
    expect(html).toContain('disabled=""');
    expect(html).toContain("Otváram portál");
    expect(html).not.toContain("Spravovať predplatné");
  });
});
