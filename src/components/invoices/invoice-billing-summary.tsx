"use client";

import { useMemo, useState } from "react";
import { CheckCircle2, FileStack, TrendingUp } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { DateRangeFilter } from "@/components/dashboard/date-range-filter";
import {
  describeRange,
  filterByRange,
  getPresetRange,
  type DateRange,
  type RangePreset,
} from "@/lib/date-range";
import type { DocumentWithClient } from "@/lib/database.types";

function formatCurrency(amount: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(amount);
}

// Independent of the list below it, same as the HST card - a contractor
// might be browsing all invoices while checking billing totals for just
// one quarter or year.
export function InvoiceBillingSummary({
  documents,
}: {
  documents: DocumentWithClient[];
}) {
  const [preset, setPreset] = useState<RangePreset>("this-month");
  const [range, setRange] = useState<DateRange>(getPresetRange("this-month"));

  const filtered = useMemo(
    () => filterByRange(documents, range, "issue_date"),
    [documents, range],
  );
  const rangeLabel = useMemo(() => describeRange(preset, range), [preset, range]);

  const stats = useMemo(() => {
    // Drafts aren't really "billed" yet - only count what's actually been
    // issued to the client.
    const issued = filtered.filter((d) => d.status !== "draft");
    const billed = issued.reduce((sum, d) => sum + d.total_amount, 0);
    // Sum actual payments received rather than only fully-"paid" invoices,
    // so a deposit on a partially-paid invoice still counts here.
    const collected = filtered.reduce(
      (sum, d) => sum + d.payments.reduce((s, p) => s + p.amount, 0),
      0,
    );
    return { count: filtered.length, billed, collected };
  }, [filtered]);

  function handleRangeChange(nextPreset: RangePreset, nextRange: DateRange) {
    setPreset(nextPreset);
    setRange(nextRange);
  }

  return (
    <div className="space-y-3">
      <DateRangeFilter preset={preset} range={range} onChange={handleRangeChange} />

      <div className="grid grid-cols-3 gap-3">
        <Card>
          <CardContent className="flex flex-col items-center gap-1 p-4 text-center">
            <FileStack className="h-4 w-4 text-muted-foreground" />
            <span className="text-xl font-bold tabular-nums">{stats.count}</span>
            <span className="text-xs text-muted-foreground">
              Invoices in {rangeLabel}
            </span>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex flex-col items-center gap-1 p-4 text-center">
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
            <span className="text-xl font-bold tabular-nums">
              {formatCurrency(stats.billed)}
            </span>
            <span className="text-xs text-muted-foreground">Total billed</span>
          </CardContent>
        </Card>
        <Card className="border-success/30 bg-success/5">
          <CardContent className="flex flex-col items-center gap-1 p-4 text-center">
            <CheckCircle2 className="h-4 w-4 text-success" />
            <span className="text-xl font-bold tabular-nums text-success">
              {formatCurrency(stats.collected)}
            </span>
            <span className="text-xs text-muted-foreground">Collected</span>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
