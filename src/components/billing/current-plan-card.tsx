import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PLAN_LIMITS } from "@/lib/plan-limits";
import type { SubscriptionStatus } from "@/lib/database.types";

const TIER_LABEL: Record<SubscriptionStatus, string> = {
  free: "Free",
  basic: "Basic",
  pro: "Pro",
};

function formatCap(n: number | null): string {
  return n === null ? "Unlimited" : String(n);
}

// Compact, single-tier counterpart to PlanCapsTable (the full three-column
// comparison on /billing) - Settings only needs "what do I actually have
// right now", not a plan-shopping comparison, so this shows just the
// caller's own tier's numbers plus a link to /billing for the full picture
// or an upgrade.
export function CurrentPlanCard({ tier }: { tier: SubscriptionStatus }) {
  const limits = PLAN_LIMITS[tier];
  const rows: { label: string; value: number | null }[] = [
    { label: "Receipt scans / month", value: limits.scansPerMonth },
    { label: "Invoices / month", value: limits.invoicesPerMonth },
    { label: "Clients", value: limits.clients },
    { label: "Jobs", value: limits.jobs },
    { label: "Employees", value: limits.employees },
    { label: "Active services (salon)", value: limits.activeServices },
    { label: "Active stylists (salon)", value: limits.activeStylists },
  ];

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>Your plan</CardTitle>
          <Badge variant={tier === "free" ? "outline" : "default"}>
            {TIER_LABEL[tier]}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <ul className="space-y-1.5 text-sm">
          {rows.map((row) => (
            <li key={row.label} className="flex items-center justify-between">
              <span className="text-muted-foreground">{row.label}</span>
              <span className="font-medium tabular-nums">{formatCap(row.value)}</span>
            </li>
          ))}
        </ul>
        {tier !== "pro" && (
          <Button
            variant="outline"
            size="sm"
            className="w-full border-primary text-primary hover:bg-primary/10"
            nativeButton={false}
            render={<Link href="/billing" />}
          >
            Compare plans & upgrade
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
