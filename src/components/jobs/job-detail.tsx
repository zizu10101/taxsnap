"use client";

import { useState } from "react";
import { Plus, Receipt as ReceiptIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { HourEntryDialog } from "@/components/hours/hour-entry-dialog";
import type {
  Employee,
  HourEntryWithRelations,
  Job,
  Receipt,
} from "@/lib/database.types";

function formatCurrency(amount: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(amount);
}

function formatDate(dateStr: string) {
  return new Date(`${dateStr}T00:00:00`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

type JobReceipt = Pick<
  Receipt,
  "id" | "merchant_name" | "transaction_date" | "total_amount" | "tax_category"
>;

export function JobDetail({
  job,
  initialReceipts,
  initialHourEntries,
  employees,
  jobs,
  linkedInvoiceCount,
  jobRevenue,
}: {
  job: Job;
  initialReceipts: JobReceipt[];
  initialHourEntries: HourEntryWithRelations[];
  employees: Employee[];
  jobs: Job[];
  linkedInvoiceCount: number;
  jobRevenue: number;
}) {
  const [hourEntries, setHourEntries] = useState(initialHourEntries);
  const [dialogOpen, setDialogOpen] = useState(false);
  const receipts = initialReceipts;

  const totalExpenses = receipts.reduce((sum, r) => sum + r.total_amount, 0);
  const totalLaborCost = hourEntries.reduce((sum, h) => sum + h.labor_cost, 0);
  const totalJobCost = totalExpenses + totalLaborCost;
  const estProfit = jobRevenue - totalJobCost;

  function upsertEntry(entry: HourEntryWithRelations) {
    setHourEntries((prev) => {
      const exists = prev.some((e) => e.id === entry.id);
      return exists ? prev.map((e) => (e.id === entry.id ? entry : e)) : [entry, ...prev];
    });
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Job cost</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-3 gap-2 text-center">
          <div>
            <p className="text-xs text-muted-foreground">Expenses</p>
            <p className="font-semibold tabular-nums">{formatCurrency(totalExpenses)}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Labor</p>
            <p className="font-semibold tabular-nums">{formatCurrency(totalLaborCost)}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Total cost</p>
            <p className="font-semibold text-primary tabular-nums">
              {formatCurrency(totalJobCost)}
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Est. profit</CardTitle>
        </CardHeader>
        <CardContent>
          {linkedInvoiceCount === 0 ? (
            <p className="text-sm text-muted-foreground">
              No invoices linked to this job yet — pick this job when
              creating or editing an invoice to track revenue here.
            </p>
          ) : (
            <div className="grid grid-cols-3 gap-2 text-center">
              <div>
                <p className="text-xs text-muted-foreground">Revenue</p>
                <p className="font-semibold text-success tabular-nums">
                  {formatCurrency(jobRevenue)}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Cost</p>
                <p className="font-semibold tabular-nums">
                  {formatCurrency(totalJobCost)}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Est. profit</p>
                <p
                  className={`font-semibold tabular-nums ${estProfit >= 0 ? "text-success" : "text-destructive"}`}
                >
                  {formatCurrency(estProfit)}
                </p>
              </div>
            </div>
          )}
          {linkedInvoiceCount > 0 && (
            <p className="mt-2 text-[11px] text-muted-foreground">
              Revenue counts only payments actually received on invoices
              linked to this job, pro-rated for deposits — not the full
              invoice total.
            </p>
          )}
        </CardContent>
      </Card>

      <div className="flex items-center justify-between">
        <h2 className="font-heading text-lg font-semibold">Hours logged</h2>
        <Button size="sm" onClick={() => setDialogOpen(true)}>
          <Plus className="h-4 w-4" />
          Log hours
        </Button>
      </div>

      {hourEntries.length === 0 ? (
        <Card>
          <CardContent className="py-6 text-center text-sm text-muted-foreground">
            No hours logged for this job yet.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {hourEntries.map((entry) => (
            <Card key={entry.id}>
              <CardContent className="flex items-center justify-between gap-3 py-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{entry.employee.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {formatDate(entry.work_date)} · {entry.hours}h @{" "}
                    {formatCurrency(entry.rate)}/hr
                  </p>
                </div>
                <span className="font-semibold tabular-nums">
                  {formatCurrency(entry.labor_cost)}
                </span>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <h2 className="font-heading text-lg font-semibold">Tagged expenses</h2>
      {receipts.length === 0 ? (
        <Card>
          <CardContent className="py-6 text-center text-sm text-muted-foreground">
            No expenses tagged to this job yet.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {receipts.map((r) => (
            <Card key={r.id}>
              <CardContent className="flex items-center justify-between gap-3 py-3">
                <div className="flex min-w-0 flex-1 items-center gap-2">
                  <ReceiptIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{r.merchant_name}</p>
                    <p className="text-xs text-muted-foreground">
                      {formatDate(r.transaction_date)} · {r.tax_category}
                    </p>
                  </div>
                </div>
                <span className="font-semibold tabular-nums">
                  {formatCurrency(r.total_amount)}
                </span>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <HourEntryDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        employees={employees}
        jobs={jobs}
        defaultJobId={job.id}
        onSaved={upsertEntry}
      />
    </div>
  );
}
