"use client";

import { useMemo } from "react";
import { PiggyBank, Receipt as ReceiptIcon, TrendingUp } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { computeExpenseSummary } from "@/lib/expense-summary";
import type { Receipt } from "@/lib/database.types";

function formatCurrency(amount: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(amount);
}

// Receipts passed in are already filtered to the selected date range by the
// parent - this component just totals whatever it's given.
export function ReceiptsSummary({
  receipts,
  rangeLabel,
}: {
  receipts: Receipt[];
  rangeLabel: string;
}) {
  // Same computeExpenseSummary() the Overview page and accountant export
  // use - this card previously summed raw total_amount for "Deductible
  // spend" and derived "Est. tax savings" from that same unrestricted
  // figure, which overstated both for a period with Meals expenses (that
  // category gets only a 50% deduction, same restriction as its HST ITC -
  // see lib/hst.ts). Using the shared function keeps this card's numbers
  // from disagreeing with the more detailed views elsewhere in the app.
  const stats = useMemo(() => {
    const summary = computeExpenseSummary(receipts);
    return {
      count: receipts.length,
      deductibleSpend: summary.deductibleSpend,
      totalExpenses: summary.totalExpenses,
      estHstReclaimable: summary.estHstReclaimable,
    };
  }, [receipts]);

  // Meals & entertainment's 50% restriction (see lib/hst.ts) is the only
  // reason this can be under 100% - real, computed from the same shared
  // summary the HST card and accountant export use, not a fabricated
  // "awaiting category" figure (no such status exists on a receipt row).
  const claimablePct =
    stats.totalExpenses > 0 ? Math.round((stats.deductibleSpend / stats.totalExpenses) * 100) : 100;

  return (
    // Mobile: HST full-width hero on top, Receipts/Deductible 2-up below
    // (order-1/2/3 puts HST first in source-independent order). Desktop
    // (sm+): three equal columns, HST last/right like the mockup's
    // 3-column stat row - same cards, same data, just re-flowed via grid
    // placement instead of two separate layouts.
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
      <Card className="relative order-1 col-span-2 overflow-hidden border-success/30 bg-success/5 sm:order-3 sm:col-span-1">
        <div className="absolute inset-y-0 right-0 hidden w-1.5 bg-success sm:block" />
        <CardContent className="flex items-center gap-3 p-4 sm:flex-col sm:items-start sm:gap-1">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-success/15">
            <PiggyBank className="h-5 w-5 text-success" />
          </div>
          <div className="hidden items-center gap-1.5 pt-1 font-mono text-[11px] font-semibold tracking-wider text-success/70 sm:flex">
            EST. HST RECLAIMABLE
          </div>
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground sm:hidden">Est. HST reclaimable</p>
            <p className="truncate text-2xl font-bold tabular-nums text-success sm:text-3xl">
              {formatCurrency(stats.estHstReclaimable)}
            </p>
            <p className="text-xs text-muted-foreground">
              {rangeLabel} · {stats.count} receipt{stats.count === 1 ? "" : "s"}
            </p>
          </div>
        </CardContent>
      </Card>
      <Card className="order-2 sm:order-1">
        <CardContent className="flex items-center gap-2 p-3 sm:flex-col sm:items-start sm:gap-1.5 sm:p-5">
          <div className="hidden h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted sm:flex">
            <ReceiptIcon className="h-4 w-4 text-muted-foreground" />
          </div>
          <ReceiptIcon className="h-4 w-4 shrink-0 text-muted-foreground sm:hidden" />
          <p className="hidden pt-1 font-mono text-[11px] font-semibold tracking-wider text-muted-foreground sm:block">
            RECEIPTS THIS PERIOD
          </p>
          <div className="min-w-0">
            <p className="font-semibold tabular-nums sm:text-3xl">{stats.count}</p>
            <p className="text-[11px] text-muted-foreground sm:hidden">Receipts</p>
          </div>
        </CardContent>
      </Card>
      <Card className="relative order-3 overflow-hidden border-primary/20 sm:order-2">
        <div className="absolute inset-y-0 right-0 hidden w-1.5 bg-primary sm:block" />
        <CardContent className="flex items-center gap-2 p-3 sm:flex-col sm:items-start sm:gap-1.5 sm:p-5">
          <div className="hidden h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 sm:flex">
            <TrendingUp className="h-4 w-4 text-primary" />
          </div>
          <TrendingUp className="h-4 w-4 shrink-0 text-muted-foreground sm:hidden" />
          <p className="hidden pt-1 font-mono text-[11px] font-semibold tracking-wider text-primary sm:block">
            DEDUCTIBLE SPEND
          </p>
          <div className="min-w-0">
            <p className="truncate font-semibold tabular-nums sm:text-3xl">
              {formatCurrency(stats.deductibleSpend)}
            </p>
            <p className="text-[11px] text-muted-foreground sm:mt-1 sm:text-xs">
              <span className="sm:hidden">Deductible spend · </span>
              of {formatCurrency(stats.totalExpenses)} logged · {claimablePct}% claimable
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
