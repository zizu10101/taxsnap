import { startOfWeek, toIsoDate, type DateRange, type RangePreset } from "@/lib/date-range";

export type TrendGranularity = "day" | "week" | "month";

// Named presets map to a fixed granularity; "custom" derives one from the
// actual span, since it has no fixed name to key off of.
export function granularityForRange(preset: RangePreset, range: DateRange): TrendGranularity {
  switch (preset) {
    case "today":
    case "this-week":
    case "this-month":
    case "last-month":
      return "day";
    case "this-quarter":
      return "week";
    case "this-year":
    case "all-time":
      return "month";
    case "custom":
    default: {
      if (!range.start || !range.end) return "month";
      const days = daysBetween(range.start, range.end);
      if (days <= 31) return "day";
      if (days <= 180) return "week";
      return "month";
    }
  }
}

function daysBetween(startIso: string, endIso: string): number {
  const start = new Date(`${startIso}T00:00:00`);
  const end = new Date(`${endIso}T00:00:00`);
  return Math.round((end.getTime() - start.getTime()) / 86_400_000);
}

export interface TrendPoint {
  createdAt: string;
  priceCharged: number;
  commissionOwed: number;
}

export interface TrendBucket {
  bucketStart: string; // local YYYY-MM-DD, also the sort/react key
  label: string;
  totalSales: number;
  totalCommissionOwed: number;
}

// `new Date(isoUtcString)` and its getFullYear/getMonth/getDate expose the
// browser's *local* calendar reading of that instant - the same local-not-
// UTC extraction date-range.ts uses throughout (see its own comments on
// toIsoDate/localDateToUtcInstant for why: the server has no idea what the
// shop's local offset is, only the browser does, so bucketing has to
// happen here, not in the API route that fetched these points).
export function bucketTrendPoints(
  points: TrendPoint[],
  granularity: TrendGranularity,
): TrendBucket[] {
  const buckets = new Map<string, TrendBucket>();

  for (const point of points) {
    const local = new Date(point.createdAt);
    const bucketStart = startOfBucket(local, granularity);
    const key = toIsoDate(bucketStart);
    const existing = buckets.get(key);
    if (existing) {
      existing.totalSales += point.priceCharged;
      existing.totalCommissionOwed += point.commissionOwed;
    } else {
      buckets.set(key, {
        bucketStart: key,
        label: formatBucketLabel(bucketStart, granularity),
        totalSales: point.priceCharged,
        totalCommissionOwed: point.commissionOwed,
      });
    }
  }

  return [...buckets.values()].sort((a, b) => (a.bucketStart < b.bucketStart ? -1 : 1));
}

function startOfBucket(date: Date, granularity: TrendGranularity): Date {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  if (granularity === "day") return d;
  if (granularity === "week") return startOfWeek(d);
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function formatBucketLabel(date: Date, granularity: TrendGranularity): string {
  if (granularity === "month") {
    return date.toLocaleDateString("en-US", { month: "short", year: "numeric" });
  }
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
