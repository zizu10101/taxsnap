import Link from "next/link";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { nextTierFor } from "@/lib/plan-limits";
import type { SubscriptionStatus } from "@/lib/database.types";

const TIER_LABEL: Record<"basic" | "pro", string> = { basic: "Basic", pro: "Pro" };

// Shared proactive usage indicator for every capped resource (invoices,
// clients, jobs, active employees/services/stylists - see
// src/lib/plan-limits.ts) - shown near the "New X" button on every list so
// a user sees where they stand before they hit the cap, not just after
// (the reactive FREE_LIMIT_REACHED toast on create/reactivate is a
// separate, still-necessary backstop - this is the proactive half). Not
// wired to a shared server round-trip: every caller already has `current`
// and `limit` in hand from data it fetched for its own list, so this stays
// a pure display component.
export function UsageLimitBar({
  tier,
  current,
  limit,
  noun,
  pluralNoun,
  period,
}: {
  tier: SubscriptionStatus;
  current: number;
  /** null = unlimited at this tier - the bar renders nothing. */
  limit: number | null;
  /** Singular noun, e.g. "client", "job", "active employee" - pluralized here when limit !== 1. */
  noun: string;
  /** Explicit plural form for a noun that doesn't just take an "s" (e.g. "entry" -> "entries"). */
  pluralNoun?: string;
  /** e.g. "this month", for monthly caps like invoices. */
  period?: string;
}) {
  if (limit === null) return null;

  const atCap = current >= limit;
  const nounLabel = limit === 1 ? noun : (pluralNoun ?? `${noun}s`);
  const nextTier = nextTierFor(tier);

  return (
    <div
      className={cn(
        "flex items-center justify-between gap-2 rounded-lg border px-3 py-2 text-xs",
        atCap
          ? "border-destructive/40 bg-destructive/10 text-destructive"
          : "border-border bg-muted/40 text-muted-foreground",
      )}
    >
      <span className="tabular-nums">
        {current} of {limit} {nounLabel} used{period ? ` ${period}` : ""}
      </span>
      {atCap && (
        <Button
          variant="link"
          size="sm"
          className="h-auto p-0 text-xs text-destructive underline"
          nativeButton={false}
          render={<Link href="/billing" />}
        >
          Upgrade to {TIER_LABEL[nextTier]}
        </Button>
      )}
    </div>
  );
}
