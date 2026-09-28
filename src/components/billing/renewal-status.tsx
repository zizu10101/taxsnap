import { PRICING_PLANS } from "@/lib/pricing-plans";
import type { BillingInterval, SubscriptionStatus } from "@/lib/database.types";

function formatDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

// Shared by CurrentPlanCard (Settings) and /billing - both read the same
// profiles columns the webhook writes (see api/stripe/webhook), so the
// wording can't drift between the two places a subscriber sees it.
// Renders nothing for a free account or before a webhook has populated
// these columns for an existing subscriber (see pricing-cards.tsx's own
// comment on that gap) - same as showing nothing today.
export function RenewalStatus({
  billingInterval,
  currentPeriodEnd,
  cancelAtPeriodEnd,
  pendingTier = null,
  pendingChangeEffectiveAt = null,
}: {
  billingInterval: BillingInterval | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  // Set once a Stripe Subscription Schedule is attached (a downgrade -
  // cheaper tier or shorter/cheaper interval - defers to period end
  // instead of applying immediately; see CLAUDE.md's Stripe note for how
  // that was verified). Takes precedence over the plain "Renews on" line,
  // but not over cancellation - a scheduled downgrade a customer then
  // cancels shows "Cancels on", not both.
  pendingTier?: SubscriptionStatus | null;
  pendingChangeEffectiveAt?: string | null;
}) {
  if (!currentPeriodEnd) return null;

  if (cancelAtPeriodEnd) {
    return (
      <p className="text-xs text-destructive">
        Cancels on {formatDate(currentPeriodEnd)}
      </p>
    );
  }

  if (pendingTier && pendingChangeEffectiveAt) {
    // Reuses PRICING_PLANS as the single source of truth for tier display
    // names rather than adding yet another local TIER_LABEL map.
    const name = PRICING_PLANS.find((p) => p.tier === pendingTier)?.name ?? pendingTier;
    return (
      <p className="text-xs text-muted-foreground">
        Changes to {name} on {formatDate(pendingChangeEffectiveAt)}
      </p>
    );
  }

  const cadence = billingInterval === "yearly" ? "annually" : "monthly";
  return (
    <p className="text-xs text-muted-foreground">
      Renews {cadence} on {formatDate(currentPeriodEnd)}
    </p>
  );
}
