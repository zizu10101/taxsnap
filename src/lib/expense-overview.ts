import { startOfWeek, toIsoDate } from "@/lib/date-range";
import type { TrendGranularity } from "@/lib/commission-overview";
import type { ExpenseTrendPoint, SalesTrendPoint } from "@/lib/expense-overview-query";

// granularityForRange (commission-overview.ts) only depends on the range
// preset/span, not on what's being bucketed, so it's reused as-is (see
// expense-overview.tsx's import) rather than duplicated here - this file
// only owns the bucketing itself, which does differ: receipts.
// transaction_date and payments.paid_date are already plain local
// YYYY-MM-DD strings (unlike commission_entries.created_at, a
// timestamptz), so there's no UTC-instant round trip to worry about -
// `new Date(\`${date}T00:00:00\`)` reads it straight as a local calendar
// date, same convention date-range.ts's own formatDateLabel already uses.
export interface ExpenseTrendBucket {
  bucketStart: string; // local YYYY-MM-DD, also the sort/react key
  label: string;
  totalExpenses: number;
  deductibleSpend: number;
  totalSales: number;
}

// Merges two point sets (receipts by transaction_date, recognized invoice
// payments by paid_date) into one bucket per period - a bucket with sales
// but no expenses (or vice versa) is real and expected, not an error, so
// buckets are created from the union of both sets' dates, each field
// defaulting to 0 until something actually lands in it.
export function bucketExpenseTrendPoints(
  expensePoints: ExpenseTrendPoint[],
  salesPoints: SalesTrendPoint[],
  granularity: TrendGranularity,
): ExpenseTrendBucket[] {
  const buckets = new Map<string, ExpenseTrendBucket>();

  function bucketFor(date: Date): ExpenseTrendBucket {
    const bucketStart = startOfBucket(date, granularity);
    const key = toIsoDate(bucketStart);
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = {
        bucketStart: key,
        label: formatBucketLabel(bucketStart, granularity),
        totalExpenses: 0,
        deductibleSpend: 0,
        totalSales: 0,
      };
      buckets.set(key, bucket);
    }
    return bucket;
  }

  for (const point of expensePoints) {
    const bucket = bucketFor(new Date(`${point.transactionDate}T00:00:00`));
    bucket.totalExpenses += point.totalAmount;
    bucket.deductibleSpend += point.deductibleAmount;
  }

  for (const point of salesPoints) {
    const bucket = bucketFor(new Date(`${point.paidDate}T00:00:00`));
    bucket.totalSales += point.subtotalAmount;
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
