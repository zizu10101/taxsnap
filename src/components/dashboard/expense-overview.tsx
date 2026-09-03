"use client";

import { useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ExpenseTrendChart } from "@/components/dashboard/expense-trend-chart";
import { DateRangeFilter } from "@/components/dashboard/date-range-filter";
import { getPresetRange, type DateRange, type RangePreset } from "@/lib/date-range";
import { granularityForRange } from "@/lib/commission-overview";
import { bucketExpenseTrendPoints } from "@/lib/expense-overview";
import type { ExpenseOverviewData } from "@/lib/expense-overview-query";

function formatCurrency(amount: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(amount);
}

function SummaryCard({
  label,
  value,
  highlight,
  className,
}: {
  label: string;
  value: number;
  highlight?: boolean;
  className?: string;
}) {
  return (
    <Card className={className}>
      <CardContent className="space-y-1 py-4 text-center">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p
          className={`text-lg font-semibold tabular-nums ${
            value < 0 ? "text-destructive" : highlight ? "text-primary" : ""
          }`}
        >
          {formatCurrency(value)}
        </p>
      </CardContent>
    </Card>
  );
}

function TotalsRow({
  label,
  value,
  emphasize,
}: {
  label: string;
  value: number;
  emphasize?: boolean;
}) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className={emphasize ? "font-semibold" : "text-muted-foreground"}>{label}</span>
      <span
        className={`tabular-nums ${
          value < 0 ? "text-destructive" : emphasize ? "text-lg font-bold text-primary" : "font-medium"
        }`}
      >
        {formatCurrency(value)}
      </span>
    </div>
  );
}

const EMPTY_DATA: ExpenseOverviewData = {
  totalExpenses: 0,
  deductibleSpend: 0,
  estHstReclaimable: 0,
  nonDeductibleSpend: 0,
  totalSales: 0,
  estProfit: 0,
  trendPoints: [],
  salesTrendPoints: [],
};

// Route-level Pro-gate happens one level up (dashboard/overview/page.tsx) -
// this component only ever renders once that's already true, same
// precedent as CommissionOverview.
export function ExpenseOverview({
  initialRangeData,
}: {
  initialRangeData: ExpenseOverviewData;
}) {
  const [preset, setPreset] = useState<RangePreset>("this-month");
  const [range, setRange] = useState<DateRange>(getPresetRange("this-month"));
  // initialRangeData only seeds first paint - it is NOT used to skip the
  // mount fetch below. Same reasoning as CommissionOverview: Next's
  // client-side router cache can serve a stale RSC payload when navigating
  // here right after logging a new receipt elsewhere, so skipping the
  // fetch would show stale totals.
  const [data, setData] = useState<ExpenseOverviewData>(initialRangeData);
  const [loading, setLoading] = useState(false);

  // setLoading(true) happens in handleRangeChange below, a real event
  // handler - not this effect's own synchronous body (react-hooks/set-
  // state-in-effect, same convention this project follows elsewhere). The
  // mount-time run of this effect never sets it, so the initial fetch
  // silently swaps in fresh data with no spinner flash.
  useEffect(() => {
    const params = new URLSearchParams();
    // Plain inclusive "YYYY-MM-DD" bounds, not rangeToUtcBounds - see
    // getExpenseOverviewData's own comment for why transaction_date/
    // paid_date use a different convention than commission_entries'
    // timestamptz-based from/to.
    if (range.start) params.set("from", range.start);
    if (range.end) params.set("to", range.end);

    fetch(`/api/expenses/overview?${params.toString()}`)
      .then((res) => (res.ok ? res.json() : Promise.reject()))
      .then((json: ExpenseOverviewData) => setData(json))
      .catch(() => {
        toast.error("Failed to load overview for this range");
        setData(EMPTY_DATA);
      })
      .finally(() => setLoading(false));
  }, [range]);

  function handleRangeChange(nextPreset: RangePreset, nextRange: DateRange) {
    setLoading(true);
    setPreset(nextPreset);
    setRange(nextRange);
  }

  const granularity = useMemo(() => granularityForRange(preset, range), [preset, range]);
  const buckets = useMemo(
    () => bucketExpenseTrendPoints(data.trendPoints, data.salesTrendPoints, granularity),
    [data.trendPoints, data.salesTrendPoints, granularity],
  );

  return (
    <div className="space-y-4">
      <DateRangeFilter preset={preset} range={range} onChange={handleRangeChange} />

      <div className="grid grid-cols-2 gap-3">
        <SummaryCard label="Total Sales" value={data.totalSales} />
        <SummaryCard label="Total Expenses" value={data.totalExpenses} />
        <SummaryCard label="Deductible Spend" value={data.deductibleSpend} highlight />
        <SummaryCard label="Est. HST Reclaimable" value={data.estHstReclaimable} />
        <SummaryCard label="Non-Deductible Spend" value={data.nonDeductibleSpend} className="col-span-2" />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Expense Trend</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex h-40 items-center justify-center">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <ExpenseTrendChart buckets={buckets} />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Totals Summary</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <TotalsRow label="Total Sales" value={data.totalSales} />
          <TotalsRow label="Total Expenses" value={data.totalExpenses} />
          <TotalsRow label="Est. HST Reclaimable" value={data.estHstReclaimable} />
          <TotalsRow label="Non-Deductible Spend" value={data.nonDeductibleSpend} />
          <div className="mt-2 rounded-lg bg-primary/10 p-3">
            <TotalsRow label="Est. Profit" value={data.estProfit} emphasize />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
