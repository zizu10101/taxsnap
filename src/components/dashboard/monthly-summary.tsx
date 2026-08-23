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

export function MonthlySummary({ receipts }: { receipts: Receipt[] }) {
  const stats = useMemo(() => {
    const now = new Date();
    const monthReceipts = receipts.filter((r) => {
      const d = new Date(`${r.transaction_date}T00:00:00`);
      return (
        d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear()
      );
    });

    const totalDeductible = monthReceipts.reduce(
      (sum, r) => sum + r.total_amount,
      0,
    );
    const estimatedSavings = totalDeductible * ESTIMATED_TAX_RATE;

    return {
      count: monthReceipts.length,
      totalDeductible,
      estimatedSavings,
    };
  }, [receipts]);

  const monthLabel = new Date().toLocaleDateString("en-US", {
    month: "long",
  });

  return (
    <div className="grid grid-cols-3 gap-3">
      <Card>
        <CardContent className="flex flex-col items-center gap-1 p-4 text-center">
          <ReceiptIcon className="h-4 w-4 text-muted-foreground" />
          <span className="text-xl font-bold tabular-nums">{stats.count}</span>
          <span className="text-xs text-muted-foreground">
            Receipts in {monthLabel}
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
      <Card className="border-primary/30 bg-primary/5">
        <CardContent className="flex flex-col items-center gap-1 p-4 text-center">
          <PiggyBank className="h-4 w-4 text-primary" />
          <span className="text-xl font-bold tabular-nums text-primary">
            {formatCurrency(stats.estimatedSavings)}
          </span>
          <span className="text-xs text-muted-foreground">Est. tax savings</span>
        </CardContent>
      </Card>
    </div>
  );
}
