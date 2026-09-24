"use client";

import { useState } from "react";
import Link from "next/link";
import { Briefcase } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import type { Job } from "@/lib/database.types";
import type { JobCostSummary } from "@/lib/job-revenue";

function formatCurrency(amount: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(amount);
}

const EMPTY_SUMMARY: JobCostSummary = {
  totalExpenses: 0,
  totalLaborCost: 0,
  totalLaborRevenue: 0,
  linkedInvoiceCount: 0,
  jobRevenue: 0,
  totalJobCost: 0,
  estProfit: 0,
};

// lg+ replacement for the plain "New job" button + stacked card list
// (rendered by JobList itself - see that file) - a list-plus-live-preview
// pane, same "list | preview" pattern as the Invoices/Estimates
// DocumentWorkstation. costSummaries is computed once for every job by the
// server page (see buildJobCostSummaries in lib/job-revenue.ts), so
// switching the selected job is instant with no extra fetch. Editing hours,
// tagging expenses, and creating an invoice for a job all still go through
// the existing /dashboard/jobs/[id] detail page via "View full details" -
// this is a browsing/preview layer on top, not a parallel job cost system.
export function JobWorkstation({
  jobs,
  costSummaries,
}: {
  jobs: Job[];
  costSummaries: Record<string, JobCostSummary>;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(jobs[0]?.id ?? null);
  const selected = jobs.find((j) => j.id === selectedId) ?? null;

  if (jobs.length === 0) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-2 py-10 text-center text-muted-foreground">
          <Briefcase className="h-8 w-8" />
          <p className="text-sm">
            No jobs yet. Tag a receipt with a job name or create one here.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="grid grid-cols-[minmax(0,1fr)_24rem] items-start gap-4">
      <div className="max-h-[calc(100vh-14rem)] space-y-2 overflow-y-auto pr-1">
        {jobs.map((job) => {
          const summary = costSummaries[job.id] ?? EMPTY_SUMMARY;
          return (
            <Card
              key={job.id}
              role="button"
              tabIndex={0}
              onClick={() => setSelectedId(job.id)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  setSelectedId(job.id);
                }
              }}
              className={cn(
                "cursor-pointer gap-0 py-0 outline-none transition-colors hover:bg-muted/50 focus-visible:bg-muted/50",
                job.id === selectedId && "border-primary bg-primary/5",
              )}
            >
              <CardContent className="flex items-center justify-between gap-3 p-3">
                <div className="flex min-w-0 items-center gap-2">
                  <Briefcase className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <p className="truncate text-sm font-medium">{job.name}</p>
                </div>
                <span className="shrink-0 text-sm font-semibold tabular-nums">
                  {formatCurrency(summary.totalJobCost)}
                </span>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <div className="sticky top-4">
        {selected && (
          <JobPreviewPanel
            key={selected.id}
            job={selected}
            summary={costSummaries[selected.id] ?? EMPTY_SUMMARY}
          />
        )}
      </div>
    </div>
  );
}

function JobPreviewPanel({ job, summary }: { job: Job; summary: JobCostSummary }) {
  return (
    <Card className="gap-0 py-0">
      <CardContent className="space-y-4 p-4">
        <div className="flex items-center justify-between">
          <span className="font-mono text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
            Job Cost Preview
          </span>
        </div>

        <div>
          <p className="truncate font-heading text-lg font-semibold">{job.name}</p>
        </div>

        <div className="space-y-1.5 rounded-lg border border-sidebar-border bg-sidebar p-3 font-mono text-xs text-sidebar-foreground">
          <div className="flex items-center justify-between">
            <span className="text-sidebar-foreground/60">Expenses</span>
            <span>{formatCurrency(summary.totalExpenses)}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sidebar-foreground/60">Labor</span>
            <span>{formatCurrency(summary.totalLaborCost)}</span>
          </div>
          <div className="flex items-center justify-between border-t border-sidebar-border pt-1.5 text-sm font-semibold">
            <span>Total cost</span>
            <span className="text-sidebar-primary">{formatCurrency(summary.totalJobCost)}</span>
          </div>
        </div>

        {summary.linkedInvoiceCount === 0 ? (
          <p className="rounded-lg border bg-muted/20 p-3 text-xs text-muted-foreground">
            No invoices linked to this job yet.
          </p>
        ) : (
          <div className="rounded-lg border bg-muted/20 p-3 text-xs">
            <p className="mb-2 font-semibold tracking-wide text-muted-foreground uppercase">
              Est. profit
            </p>
            <div className="grid grid-cols-3 gap-2 text-center">
              <div>
                <p className="text-[10px] text-muted-foreground">Revenue</p>
                <p className="font-semibold text-success tabular-nums">
                  {formatCurrency(summary.jobRevenue)}
                </p>
              </div>
              <div>
                <p className="text-[10px] text-muted-foreground">Cost</p>
                <p className="font-semibold tabular-nums">{formatCurrency(summary.totalJobCost)}</p>
              </div>
              <div>
                <p className="text-[10px] text-muted-foreground">Profit</p>
                <p
                  className={cn(
                    "font-semibold tabular-nums",
                    summary.estProfit >= 0 ? "text-success" : "text-destructive",
                  )}
                >
                  {formatCurrency(summary.estProfit)}
                </p>
              </div>
            </div>
          </div>
        )}

        {summary.totalLaborRevenue > 0 && (
          <div className="rounded-lg border bg-muted/20 p-3 text-xs">
            <p className="mb-2 font-semibold tracking-wide text-muted-foreground uppercase">
              Labor billable value
            </p>
            <div className="grid grid-cols-2 gap-2 text-center">
              <div>
                <p className="text-[10px] text-muted-foreground">Billable value</p>
                <p className="font-semibold tabular-nums">
                  {formatCurrency(summary.totalLaborRevenue)}
                </p>
              </div>
              <div>
                <p className="text-[10px] text-muted-foreground">Margin</p>
                <p
                  className={cn(
                    "font-semibold tabular-nums",
                    summary.totalLaborRevenue - summary.totalLaborCost >= 0
                      ? "text-success"
                      : "text-destructive",
                  )}
                >
                  {formatCurrency(summary.totalLaborRevenue - summary.totalLaborCost)}
                </p>
              </div>
            </div>
          </div>
        )}

        <Separator />

        <Button
          variant="outline"
          size="sm"
          className="w-full"
          nativeButton={false}
          render={<Link href={`/dashboard/jobs/${job.id}`} />}
        >
          View full details
        </Button>
      </CardContent>
    </Card>
  );
}
