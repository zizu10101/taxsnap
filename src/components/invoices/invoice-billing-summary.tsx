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

      {/* Same responsive hero/3-column pattern as the Dashboard's
          ReceiptsSummary - mobile: Collected full-width hero on top
          (money-positive figure, ledger green), the other two 2-up below;
          desktop (sm+): three equal columns, Collected last. */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 sm:gap-3">
        <Card className="order-1 col-span-2 border-success/30 bg-success/5 sm:order-3 sm:col-span-1">
          <CardContent className="flex items-center gap-3 p-4 sm:flex-col sm:items-start sm:gap-1">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-success/15 sm:hidden">
              <CheckCircle2 className="h-5 w-5 text-success" />
            </div>
            <div className="hidden items-center gap-1.5 font-mono text-[11px] font-semibold tracking-wider text-success/70 sm:flex">
              <CheckCircle2 className="h-3.5 w-3.5" />
              COLLECTED
            </div>
            <div className="min-w-0">
              <p className="text-xs text-muted-foreground sm:hidden">Collected</p>
              <p className="truncate text-2xl font-bold tabular-nums text-success sm:text-3xl">
                {formatCurrency(stats.collected)}
              </p>
            </div>
          </CardContent>
        </Card>
        <Card className="order-2 sm:order-1">
          <CardContent className="flex items-center gap-2 p-3 sm:flex-col sm:items-start sm:gap-1 sm:p-5">
            <FileStack className="h-4 w-4 shrink-0 text-muted-foreground sm:hidden" />
            <p className="hidden font-mono text-[11px] font-semibold tracking-wider text-muted-foreground sm:block">
              INVOICES THIS PERIOD
            </p>
            <div className="min-w-0">
              <p className="font-semibold tabular-nums sm:text-3xl">{stats.count}</p>
              <p className="text-[11px] text-muted-foreground sm:mt-1 sm:text-xs">
                <span className="sm:hidden">Invoices · </span>
                {rangeLabel}
              </p>
            </div>
          </CardContent>
        </Card>
        <Card className="order-3 sm:order-2">
          <CardContent className="flex items-center gap-2 p-3 sm:flex-col sm:items-start sm:gap-1 sm:p-5">
            <TrendingUp className="h-4 w-4 shrink-0 text-muted-foreground sm:hidden" />
            <p className="hidden font-mono text-[11px] font-semibold tracking-wider text-muted-foreground sm:block">
              TOTAL BILLED
            </p>
            <div className="min-w-0">
              <p className="truncate font-semibold tabular-nums sm:text-3xl">
                {formatCurrency(stats.billed)}
              </p>
              <p className="text-[11px] text-muted-foreground sm:hidden">Total billed</p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
