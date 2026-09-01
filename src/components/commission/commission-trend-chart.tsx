import type { TrendBucket } from "@/lib/commission-overview";

function formatCurrency(amount: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(amount);
}

// Hand-rolled SVG line chart, not a charting library - same reasoning as
// invoice-pdf.ts skipping the autotable plugin: two lines and a handful of
// buckets (at most a few dozen even for a year of daily data) doesn't
// justify a new dependency. Colors come from the theme's dedicated chart
// palette (--chart-1/--chart-2, already defined in globals.css but unused
// until now) via inline styles rather than Tailwind's stroke-*/fill-*
// utilities, to avoid depending on whether those get generated for custom
// theme tokens.
export function CommissionTrendChart({ buckets }: { buckets: TrendBucket[] }) {
  if (buckets.length === 0) {
    return (
      <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">
        No commission activity in this range.
      </div>
    );
  }

  const width = 600;
  const height = 220;
  const padding = { top: 12, right: 12, bottom: 24, left: 12 };
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;

  // Guards against a divide-by-zero when every bucket is $0 (e.g. a range
  // with logged entries that all net to zero somehow) - a flat zero line
  // is still a valid, meaningful chart.
  const maxValue = Math.max(
    1,
    ...buckets.map((b) => Math.max(b.totalSales, b.totalCommissionOwed)),
  );

  const stepX = buckets.length > 1 ? plotWidth / (buckets.length - 1) : 0;

  function xFor(index: number): number {
    return padding.left + (buckets.length > 1 ? index * stepX : plotWidth / 2);
  }

  function yFor(value: number): number {
    return padding.top + plotHeight - (value / maxValue) * plotHeight;
  }

  function pointsFor(key: "totalSales" | "totalCommissionOwed"): string {
    return buckets.map((b, i) => `${xFor(i)},${yFor(b[key])}`).join(" ");
  }

  // Thin labels out once there are more than ~6 buckets, so they don't
  // overlap into an unreadable smear along the x-axis.
  const labelEvery = Math.max(1, Math.ceil(buckets.length / 6));

  return (
    <div className="space-y-2">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="h-auto w-full"
        role="img"
        aria-label="Total Sales and Total Commission Owed over time"
      >
        <polyline
          points={pointsFor("totalSales")}
          fill="none"
          stroke="var(--color-chart-1)"
          strokeWidth={2}
        />
        <polyline
          points={pointsFor("totalCommissionOwed")}
          fill="none"
          stroke="var(--color-chart-2)"
          strokeWidth={2}
        />
        {buckets.map((b, i) => (
          <g key={b.bucketStart}>
            <circle cx={xFor(i)} cy={yFor(b.totalSales)} r={2.5} fill="var(--color-chart-1)" />
            <circle
              cx={xFor(i)}
              cy={yFor(b.totalCommissionOwed)}
              r={2.5}
              fill="var(--color-chart-2)"
            />
            {i % labelEvery === 0 && (
              <text
                x={xFor(i)}
                y={height - 6}
                textAnchor="middle"
                style={{ fill: "var(--color-muted-foreground)", fontSize: 9 }}
              >
                {b.label}
              </text>
            )}
          </g>
        ))}
      </svg>
      <div className="flex items-center justify-center gap-4 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span
            className="h-2 w-2 rounded-full"
            style={{ backgroundColor: "var(--color-chart-1)" }}
          />
          Total Sales
        </span>
        <span className="flex items-center gap-1.5">
          <span
            className="h-2 w-2 rounded-full"
            style={{ backgroundColor: "var(--color-chart-2)" }}
          />
          Total Commission Owed
        </span>
      </div>
      <p className="sr-only">
        {buckets
          .map((b) => `${b.label}: sales ${formatCurrency(b.totalSales)}, commission owed ${formatCurrency(b.totalCommissionOwed)}`)
          .join("; ")}
      </p>
    </div>
  );
}
