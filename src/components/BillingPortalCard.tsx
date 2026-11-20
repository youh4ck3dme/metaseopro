import { CreditCard, ExternalLink, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

export type BillingPortalState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; hasStripeCustomer: boolean };

interface BillingPortalCardProps {
  state: BillingPortalState;
  opening: boolean;
  onOpen: () => void;
  onRetry: () => void;
}

/** Customer access remains available after a subscription is cancelled or payment fails. */
export function BillingPortalCard({ state, opening, onOpen, onRetry }: BillingPortalCardProps) {
  if (state.status === "loading") {
    return (
      <div
        role="status"
        className="flex items-center gap-2 rounded-xl border bg-card p-5 text-sm text-muted-foreground"
      >
        <Loader2 className="size-4 animate-spin" aria-hidden="true" />
        Načítavam správu predplatného…
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <div role="alert" className="space-y-3 rounded-xl border border-destructive/30 bg-card p-5">
        <p className="text-sm">{state.message}</p>
        <Button type="button" variant="outline" onClick={onRetry}>
          Skúsiť načítať znova
        </Button>
      </div>
    );
  }

  if (!state.hasStripeCustomer) return null;

  return (
    <section
      aria-labelledby="billing-portal-title"
      className="rounded-xl border bg-card p-5 shadow-sm"
    >
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="space-y-1.5">
          <h2 id="billing-portal-title" className="flex items-center gap-2 text-sm font-semibold">
            <CreditCard className="size-4 text-primary" aria-hidden="true" />
            Správa predplatného
          </h2>
          <p className="max-w-xl text-sm text-muted-foreground">
            Otvorte zákaznícky portál Stripe pre platobné metódy, faktúry a správu predplatného.
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          className="gap-2"
          disabled={opening}
          onClick={onOpen}
        >
          {opening ? (
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          ) : (
            <ExternalLink className="size-4" aria-hidden="true" />
          )}
          {opening ? "Otváram portál…" : "Spravovať predplatné"}
        </Button>
      </div>
    </section>
  );
}
