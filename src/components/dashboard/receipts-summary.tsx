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
      estHstReclaimable: summary.estHstReclaimable,
    };
  }, [receipts]);

  return (
    <div className="grid grid-cols-3 gap-3">
      <Card>
        <CardContent className="flex flex-col items-center gap-1 p-4 text-center">
          <ReceiptIcon className="h-4 w-4 text-muted-foreground" />
          <span className="text-xl font-bold tabular-nums">{stats.count}</span>
          <span className="text-xs text-muted-foreground">
            Receipts in {rangeLabel}
          </span>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="flex flex-col items-center gap-1 p-4 text-center">
          <TrendingUp className="h-4 w-4 text-muted-foreground" />
          <span className="text-xl font-bold tabular-nums">
            {formatCurrency(stats.deductibleSpend)}
          </span>
          <span className="text-xs text-muted-foreground">Deductible spend</span>
        </CardContent>
      </Card>
      <Card className="border-success/30 bg-success/5">
        <CardContent className="flex flex-col items-center gap-1 p-4 text-center">
          <PiggyBank className="h-4 w-4 text-success" />
          <span className="text-xl font-bold tabular-nums text-success">
            {formatCurrency(stats.estHstReclaimable)}
          </span>
          <span className="text-xs text-muted-foreground">Est. HST reclaimable</span>
        </CardContent>
      </Card>
    </div>
  );
}
