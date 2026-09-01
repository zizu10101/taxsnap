"use client";

import { useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CommissionNav } from "@/components/commission/commission-nav";
import { CommissionTrendChart } from "@/components/commission/commission-trend-chart";
import { DateRangeFilter } from "@/components/dashboard/date-range-filter";
import {
  getPresetRange,
  rangeToUtcBounds,
  type DateRange,
  type RangePreset,
} from "@/lib/date-range";
import { bucketTrendPoints, granularityForRange } from "@/lib/commission-overview";
import type { CommissionOverviewData } from "@/lib/commission-overview-query";

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
  // "Total Commission Owed" gets the same text-primary treatment the
  // per-stylist Reports card already uses for its own commission figure.
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

const EMPTY_DATA: CommissionOverviewData = {
  totalSales: 0,
  totalCommissionOwed: 0,
  ownersCut: 0,
  commissionPaid: 0,
  commissionUnpaid: 0,
  trendPoints: [],
};

// Route-level Pro-gate happens one level up (dashboard/commission/overview/
// page.tsx) - isPro here is only threaded through to CommissionNav, and is
// always true whenever this component actually renders.
export function CommissionOverview({
  isPro,
  initialRangeData,
}: {
  isPro: boolean;
  initialRangeData: CommissionOverviewData;
}) {
  const [preset, setPreset] = useState<RangePreset>("this-month");
  const [range, setRange] = useState<DateRange>(getPresetRange("this-month"));
  // initialRangeData only seeds first paint (avoids a flash of zeros before
  // the effect below resolves) - it is NOT used to skip that first fetch.
  // CommissionReports hit this exact bug once already (see its own
  // comment): Next's client-side router cache can serve a stale RSC
  // payload when navigating here from another commission tab right after
  // logging a new entry, so skipping the mount fetch showed stale totals.
  const [data, setData] = useState<CommissionOverviewData>(initialRangeData);
  const [loading, setLoading] = useState(false);

  // setLoading(true) happens in handleRangeChange below, not here - a
  // real event handler, not this effect's own synchronous body (the
  // react-hooks/set-state-in-effect rule this project also follows
  // elsewhere). The mount-time run of this same effect never sets it, so
  // the initial fetch silently swaps in fresh data with no spinner flash,
  // same as CommissionReports' own range-driven fetches.
  useEffect(() => {
    const { from, to } = rangeToUtcBounds(range);
    const params = new URLSearchParams();
    if (from) params.set("from", from);
    if (to) params.set("to", to);

    fetch(`/api/commission/overview?${params.toString()}`)
      .then((res) => (res.ok ? res.json() : Promise.reject()))
      .then((json: CommissionOverviewData) => setData(json))
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
    () => bucketTrendPoints(data.trendPoints, granularity),
    [data.trendPoints, granularity],
  );

  return (
    <div className="space-y-4">
      <CommissionNav active="overview" isPro={isPro} />

      <DateRangeFilter preset={preset} range={range} onChange={handleRangeChange} />

      <div className="grid grid-cols-2 gap-3">
        <SummaryCard label="Total Sales" value={data.totalSales} />
        <SummaryCard label="Owner's Cut" value={data.ownersCut} />
        <SummaryCard label="Total Commission Owed" value={data.totalCommissionOwed} highlight />
        <SummaryCard label="Commission Paid" value={data.commissionPaid} />
        <SummaryCard
          label="Commission Outstanding"
          value={data.commissionUnpaid}
          className="col-span-2"
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Sales &amp; Commission Trend</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex h-40 items-center justify-center">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <CommissionTrendChart buckets={buckets} />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
