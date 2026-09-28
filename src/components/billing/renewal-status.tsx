import type { BillingInterval } from "@/lib/database.types";

function formatDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

// Shared by CurrentPlanCard (Settings) and /billing - both read the same
// three profiles columns the webhook writes (see api/stripe/webhook), so
// the wording can't drift between the two places a subscriber sees it.
// Renders nothing for a free account or before a webhook has populated
// these columns for an existing subscriber (see pricing-cards.tsx's own
// comment on that gap) - same as showing nothing today.
export function RenewalStatus({
  billingInterval,
  currentPeriodEnd,
  cancelAtPeriodEnd,
}: {
  billingInterval: BillingInterval | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
}) {
  if (!currentPeriodEnd) return null;

  if (cancelAtPeriodEnd) {
    return (
      <p className="text-xs text-destructive">
        Cancels on {formatDate(currentPeriodEnd)}
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
