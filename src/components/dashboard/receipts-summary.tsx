"use client";

import { useMemo } from "react";
import { PiggyBank, Receipt as ReceiptIcon, TrendingUp } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import type { Receipt } from "@/lib/database.types";

// Rough blended self-employment + federal tax rate used to estimate
// "money saved" from a deduction. This is an estimate for motivation, not
// tax advice - actual savings depend on the user's bracket and situation.
const ESTIMATED_TAX_RATE = 0.3;

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
  const stats = useMemo(() => {
    const totalDeductible = receipts.reduce((sum, r) => sum + r.total_amount, 0);
    return {
      count: receipts.length,
      totalDeductible,
      estimatedSavings: totalDeductible * ESTIMATED_TAX_RATE,
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
            {formatCurrency(stats.totalDeductible)}
          </span>
          <span className="text-xs text-muted-foreground">Deductible spend</span>
        </CardContent>
      </Card>
      <Card className="border-success/30 bg-success/5">
        <CardContent className="flex flex-col items-center gap-1 p-4 text-center">
          <PiggyBank className="h-4 w-4 text-success" />
          <span className="text-xl font-bold tabular-nums text-success">
            {formatCurrency(stats.estimatedSavings)}
          </span>
          <span className="text-xs text-muted-foreground">Est. tax savings</span>
        </CardContent>
      </Card>
    </div>
  );
}
