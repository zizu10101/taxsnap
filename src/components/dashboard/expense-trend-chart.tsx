import type { ExpenseTrendBucket } from "@/lib/expense-overview";

function formatCurrency(amount: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(amount);
}

// General-business analogue of CommissionTrendChart - same hand-rolled SVG
// approach for the same reason (a couple dozen points at most, not worth a
// charting-library dependency). Three lines instead of two - Total Sales
// (paid invoices only, see expense-overview-query.ts) uses the theme's
// third chart color token, previously unused anywhere in the app.
export function ExpenseTrendChart({ buckets }: { buckets: ExpenseTrendBucket[] }) {
  if (buckets.length === 0) {
    return (
      <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">
        No activity in this range.
      </div>
    );
  }

  const width = 600;
  const height = 220;
  const padding = { top: 12, right: 12, bottom: 24, left: 12 };
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;

  const maxValue = Math.max(
    1,
    ...buckets.map((b) => Math.max(b.totalExpenses, b.deductibleSpend, b.totalSales)),
  );

  const stepX = buckets.length > 1 ? plotWidth / (buckets.length - 1) : 0;

  function xFor(index: number): number {
    return padding.left + (buckets.length > 1 ? index * stepX : plotWidth / 2);
  }

  function yFor(value: number): number {
    return padding.top + plotHeight - (value / maxValue) * plotHeight;
  }

  function pointsFor(key: "totalExpenses" | "deductibleSpend" | "totalSales"): string {
    return buckets.map((b, i) => `${xFor(i)},${yFor(b[key])}`).join(" ");
  }

  const labelEvery = Math.max(1, Math.ceil(buckets.length / 6));

  return (
    <div className="space-y-2">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="h-auto w-full"
        role="img"
        aria-label="Total Sales, Total Expenses, and Deductible Spend over time"
      >
        <polyline
          points={pointsFor("totalSales")}
          fill="none"
          stroke="var(--color-chart-3)"
          strokeWidth={2}
        />
        <polyline
          points={pointsFor("totalExpenses")}
          fill="none"
          stroke="var(--color-chart-1)"
          strokeWidth={2}
        />
        <polyline
          points={pointsFor("deductibleSpend")}
          fill="none"
          stroke="var(--color-chart-2)"
          strokeWidth={2}
        />
        {buckets.map((b, i) => (
          <g key={b.bucketStart}>
            <circle cx={xFor(i)} cy={yFor(b.totalSales)} r={2.5} fill="var(--color-chart-3)" />
            <circle cx={xFor(i)} cy={yFor(b.totalExpenses)} r={2.5} fill="var(--color-chart-1)" />
            <circle
              cx={xFor(i)}
              cy={yFor(b.deductibleSpend)}
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
      <div className="flex flex-wrap items-center justify-center gap-4 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span
            className="h-2 w-2 rounded-full"
            style={{ backgroundColor: "var(--color-chart-3)" }}
          />
          Total Sales
        </span>
        <span className="flex items-center gap-1.5">
          <span
            className="h-2 w-2 rounded-full"
            style={{ backgroundColor: "var(--color-chart-1)" }}
          />
          Total Expenses
        </span>
        <span className="flex items-center gap-1.5">
          <span
            className="h-2 w-2 rounded-full"
            style={{ backgroundColor: "var(--color-chart-2)" }}
          />
          Deductible Spend
        </span>
      </div>
      <p className="sr-only">
        {buckets
          .map(
            (b) =>
              `${b.label}: total sales ${formatCurrency(b.totalSales)}, total expenses ${formatCurrency(b.totalExpenses)}, deductible spend ${formatCurrency(b.deductibleSpend)}`,
          )
          .join("; ")}
      </p>
    </div>
  );
}
