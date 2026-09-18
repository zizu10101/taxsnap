"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FileText, Plus, Receipt } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { DocumentBuilder } from "@/components/invoices/document-builder";
import { StartProgressBillingDialog } from "@/components/jobs/start-progress-billing-dialog";
import { formatDocumentNumber } from "@/lib/document-number";
import type { Client, DocumentStatus, Job, LineItem } from "@/lib/database.types";

const STATUS_VARIANT: Record<DocumentStatus, "outline" | "secondary" | "default"> = {
  draft: "outline",
  sent: "secondary",
  partial: "secondary",
  paid: "default",
};

function formatDate(dateStr: string) {
  return new Date(`${dateStr}T00:00:00`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatCurrency(amount: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(amount);
}

export interface ProgressDrawSummary {
  id: string;
  documentNumber: number;
  drawNumber: number | null;
  status: DocumentStatus;
  issueDate: string;
  totalAmount: number;
  receivedAmount: number;
}

export interface ProgressJobSummary {
  job: Job;
  invoicedToDate: number;
  receivedToDate: number;
  remainingBalance: number;
  draws: ProgressDrawSummary[];
}

export function ProgressBillingList({
  initialSummaries,
  eligibleJobs,
  jobs,
  clients,
  lineItems,
}: {
  initialSummaries: ProgressJobSummary[];
  // Jobs without a contract_value yet - offered in "Start Progress
  // Billing"'s job picker.
  eligibleJobs: Job[];
  // Every job (progress-billed or not) - DocumentBuilder's own job Select
  // needs the full list even though "New Draw" locks it to one job,
  // since the same component also renders the (hidden, in draw mode)
  // regular job picker.
  jobs: { id: string; name: string }[];
  clients: Client[];
  lineItems: LineItem[];
}) {
  const router = useRouter();
  const [startOpen, setStartOpen] = useState(false);
  const [drawJob, setDrawJob] = useState<{ name: string } | null>(null);
  const [drawOpen, setDrawOpen] = useState(false);

  return (
    <div className="space-y-4">
      <Button className="w-full" onClick={() => setStartOpen(true)}>
        <Plus className="h-4 w-4" />
        Start Progress Billing
      </Button>

      {initialSummaries.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-10 text-center text-muted-foreground">
            <Receipt className="h-8 w-8" />
            <p className="text-sm">
              No progress-billed jobs yet. Start one above to track draws
              against a contract value.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {initialSummaries.map(({ job, invoicedToDate, receivedToDate, remainingBalance, draws }) => (
            <Card key={job.id}>
              <CardContent className="space-y-3 py-4">
                <div className="flex items-center justify-between gap-2">
                  <Link
                    href={`/dashboard/jobs/${job.id}`}
                    className="min-w-0 truncate font-medium hover:underline"
                  >
                    {job.name}
                  </Link>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setDrawJob({ name: job.name });
                      setDrawOpen(true);
                    }}
                  >
                    <FileText className="h-4 w-4" />
                    New Draw
                  </Button>
                </div>
                <div className="grid grid-cols-2 gap-2 text-center sm:grid-cols-4">
                  <div>
                    <p className="text-xs text-muted-foreground">Contract Value</p>
                    <p className="font-semibold tabular-nums">
                      {formatCurrency(job.contract_value ?? 0)}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Invoiced to Date</p>
                    <p className="font-semibold tabular-nums">
                      {formatCurrency(invoicedToDate)}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Received to Date</p>
                    <p className="font-semibold tabular-nums text-success">
                      {formatCurrency(receivedToDate)}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Remaining Balance</p>
                    <p className="font-semibold tabular-nums">
                      {formatCurrency(remainingBalance)}
                    </p>
                  </div>
                </div>

                {draws.length > 0 && (
                  <div className="space-y-1.5 border-t pt-3">
                    <p className="text-xs font-medium text-muted-foreground">Draws</p>
                    {draws.map((draw) => {
                      // Per-draw received % and remaining balance -
                      // distinct from the job-level Received to
                      // Date/Remaining Balance stats above, which roll up
                      // every invoice on the job. These are just this one
                      // draw's own payments against its own total.
                      const receivedPercent =
                        draw.totalAmount > 0
                          ? Math.round((draw.receivedAmount / draw.totalAmount) * 100)
                          : 0;
                      const remainingAmount =
                        Math.round(
                          (draw.totalAmount - draw.receivedAmount + Number.EPSILON) * 100,
                        ) / 100;
                      return (
                        <Link
                          key={draw.id}
                          href={`/dashboard/invoices/${draw.id}`}
                          className="flex items-center justify-between gap-3 rounded-md px-2 py-1.5 -mx-2 hover:bg-muted/50"
                        >
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <p className="truncate text-sm font-medium">
                                Draw #{draw.drawNumber ?? "?"} —{" "}
                                {formatDocumentNumber("invoice", draw.documentNumber)}
                              </p>
                              <Badge variant={STATUS_VARIANT[draw.status]} className="shrink-0">
                                {draw.status}
                              </Badge>
                            </div>
                            <p className="text-xs text-muted-foreground">
                              {formatDate(draw.issueDate)}
                            </p>
                            <p className="text-xs font-medium text-success">
                              {formatCurrency(draw.receivedAmount)} received ({receivedPercent}%)
                            </p>
                          </div>
                          {/* Mirrors the job-level summary grid's
                              label-over-value column shape above, just
                              scoped to this one draw. */}
                          <div className="flex shrink-0 gap-3 text-right">
                            <div>
                              <p className="text-xs text-muted-foreground">Total</p>
                              <p className="font-semibold tabular-nums">
                                {formatCurrency(draw.totalAmount)}
                              </p>
                            </div>
                            <div>
                              <p className="text-xs text-muted-foreground">Remaining</p>
                              <p className="font-semibold tabular-nums">
                                {formatCurrency(remainingAmount)}
                              </p>
                            </div>
                          </div>
                        </Link>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <StartProgressBillingDialog
        open={startOpen}
        onOpenChange={setStartOpen}
        eligibleJobs={eligibleJobs}
        onStarted={() => router.refresh()}
      />

      <DocumentBuilder
        key={drawJob?.name ?? "none"}
        open={drawOpen}
        onOpenChange={setDrawOpen}
        defaultType="invoice"
        clients={clients}
        jobs={jobs}
        savedLineItems={lineItems}
        progressDrawJob={drawJob}
        onSaved={() => router.refresh()}
        onClientCreated={() => router.refresh()}
      />
    </div>
  );
}
