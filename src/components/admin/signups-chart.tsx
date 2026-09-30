import type { SignupBucket } from "@/lib/admin-data";

// Same hand-rolled SVG line approach as ExpenseTrendChart (a 30-point series
// isn't worth a charting-library dependency) - one series, so a single
// chart-1 line with a matching dot per day.
export function SignupsChart({ buckets }: { buckets: SignupBucket[] }) {
  const width = 600;
  const height = 200;
  const padding = { top: 12, right: 12, bottom: 24, left: 12 };
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;

  const maxValue = Math.max(1, ...buckets.map((b) => b.count));
  const stepX = buckets.length > 1 ? plotWidth / (buckets.length - 1) : 0;
  const xFor = (i: number) => padding.left + (buckets.length > 1 ? i * stepX : plotWidth / 2);
  const yFor = (v: number) => padding.top + plotHeight - (v / maxValue) * plotHeight;
  const labelEvery = Math.max(1, Math.ceil(buckets.length / 6));

  return (
    <div className="space-y-2">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="h-auto w-full"
        role="img"
        aria-label="New signups per day over the last 30 days"
      >
        <polyline
          points={buckets.map((b, i) => `${xFor(i)},${yFor(b.count)}`).join(" ")}
          fill="none"
          stroke="var(--color-chart-1)"
          strokeWidth={2}
        />
        {buckets.map((b, i) => (
          <g key={b.date}>
            <circle cx={xFor(i)} cy={yFor(b.count)} r={2.5} fill="var(--color-chart-1)" />
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
      <p className="sr-only">
        {buckets.map((b) => `${b.label}: ${b.count} signups`).join("; ")}
      </p>
    </div>
  );
}
