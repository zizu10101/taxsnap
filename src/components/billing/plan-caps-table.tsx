import { cn } from "@/lib/utils";
import { PLAN_LIMITS } from "@/lib/plan-limits";
import type { SubscriptionStatus } from "@/lib/database.types";

const TIER_LABEL: Record<SubscriptionStatus, string> = {
  free: "Free",
  basic: "Basic",
  pro: "Pro",
};

const ROWS: { label: string; key: keyof (typeof PLAN_LIMITS)["free"] }[] = [
  { label: "Receipt scans / month", key: "scansPerMonth" },
  { label: "Invoices / month", key: "invoicesPerMonth" },
  { label: "Clients", key: "clients" },
  { label: "Jobs", key: "jobs" },
  { label: "Employees", key: "employees" },
  { label: "Active services (salon)", key: "activeServices" },
  { label: "Active stylists (salon)", key: "activeStylists" },
];

function formatCap(n: number | null): string {
  return n === null ? "Unlimited" : String(n);
}

// The numeric-caps counterpart to the old feature-checkmark comparison -
// every tier gets every feature now (see src/lib/plan-limits.ts), so a
// checkmark grid no longer says anything useful; what differs is how much
// of each. Reads straight from PLAN_LIMITS so this can never drift out of
// sync with what the API actually enforces. Estimates are omitted - they're
// unlimited/free at every tier, so there's no cap to show.
export function PlanCapsTable({
  currentTier,
}: {
  /** Highlights this tier's column - omit to show all three unhighlighted (e.g. a signed-out context). */
  currentTier?: SubscriptionStatus;
}) {
  const tiers: SubscriptionStatus[] = ["free", "basic", "pro"];

  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full min-w-[420px] border-collapse text-sm">
        <thead>
          <tr className="border-b border-border bg-muted/40">
            <th className="p-3 text-left font-heading font-bold">Included</th>
            {tiers.map((tier) => (
              <th
                key={tier}
                className={cn(
                  "p-3 text-center font-heading font-bold",
                  tier === currentTier && "bg-primary/10 text-primary",
                )}
              >
                {TIER_LABEL[tier]}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {ROWS.map((row) => (
            <tr key={row.key}>
              <td className="p-3 text-foreground">{row.label}</td>
              {tiers.map((tier) => (
                <td
                  key={tier}
                  className={cn(
                    "p-3 text-center tabular-nums",
                    tier === currentTier && "bg-primary/5 font-medium",
                  )}
                >
                  {formatCap(PLAN_LIMITS[tier][row.key])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
