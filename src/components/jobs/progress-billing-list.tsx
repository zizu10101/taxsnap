"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ClipboardList, FileText, Plus, Receipt } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { DocumentBuilder } from "@/components/invoices/document-builder";
import { StartProgressBillingDialog } from "@/components/jobs/start-progress-billing-dialog";
import { formatDocumentNumber } from "@/lib/document-number";
import { formatContractNumber } from "@/lib/contract-number";
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

export interface ProgressDrawPayment {
  id: string;
  amount: number;
  paidDate: string;
}

export interface ProgressDrawSummary {
  id: string;
  documentNumber: number;
  drawNumber: number | null;
  status: DocumentStatus;
  issueDate: string;
  totalAmount: number;
  receivedAmount: number;
  payments: ProgressDrawPayment[];
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
  eligibleJobStats,
  jobs,
  clients,
  lineItems,
}: {
  initialSummaries: ProgressJobSummary[];
  // Jobs without a contract_value yet - offered in "Start Progress
  // Billing"'s job picker.
  eligibleJobs: Job[];
  // Existing invoices already tagged to an eligible job, keyed by job id -
  // surfaced as a warning in the picker (see StartProgressBillingDialog).
  eligibleJobStats: Record<
    string,
    { count: number; invoicedTotal: number; receivedTotal: number }
  >;
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
      <Button className="w-full lg:max-w-xs" onClick={() => setStartOpen(true)}>
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
        // Each card already shows its own full draw history inline (no
        // separate list+preview split needed, unlike Jobs/Invoices) - at
        // lg+ this just lays multiple progress-billed jobs out two per
        // row instead of one long single-width stack, so the wider page
        // doesn't leave a card floating in a mostly-empty row.
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {initialSummaries.map(({ job, invoicedToDate, receivedToDate, remainingBalance, draws }) => (
            <Card key={job.id}>
              <CardContent className="space-y-3 py-4">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <Link
                      href={`/dashboard/jobs/${job.id}`}
                      className="block truncate font-medium hover:underline"
                    >
                      {job.name}
                    </Link>
                    {job.contract_number !== null && (
                      <p className="text-xs text-muted-foreground">
                        {formatContractNumber(job.contract_number)}
                      </p>
                    )}
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      nativeButton={false}
                      render={<Link href={`/dashboard/progress-billing/${job.id}`} />}
                    >
                      <ClipboardList className="h-4 w-4" />
                      Summary
                    </Button>
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
                          className="grid grid-cols-2 items-center gap-2 rounded-md px-2 py-1.5 -mx-2 hover:bg-muted/50 sm:grid-cols-4"
                        >
                          {/* Title+date live inside the same grid as
                              Received/Remaining (columns 1-2, matching
                              Contract Value + Invoiced to Date's combined
                              width) rather than stacked above it as a
                              separate block - that's what keeps this row
                              vertically centered against Received/Remaining
                              instead of sitting below them, while the grid
                              itself (same columns/gap as the job summary
                              above) is what lines Received up under
                              "Received to Date" and Remaining under
                              "Remaining Balance". */}
                          <div className="col-span-2 min-w-0 text-left">
                            <div className="flex items-center gap-2">
                              <p className="truncate text-sm font-medium">
                                Draw #{draw.drawNumber ?? "?"} —{" "}
                                {formatDocumentNumber("invoice", draw.documentNumber)} ·{" "}
                                {formatCurrency(draw.totalAmount)}
                              </p>
                              <Badge variant={STATUS_VARIANT[draw.status]} className="shrink-0">
                                {draw.status}
                              </Badge>
                            </div>
                            <p className="text-xs text-muted-foreground">
                              {formatDate(draw.issueDate)}
                            </p>
                          </div>
                          <div className="text-center">
                            {draw.payments.length > 1 ? (
                              <div className="space-y-0.5">
                                {draw.payments.map((payment) => (
                                  <p key={payment.id} className="text-xs font-medium text-success">
                                    {formatDate(payment.paidDate)} · {formatCurrency(payment.amount)}
                                  </p>
                                ))}
                              </div>
                            ) : (
                              <p className="text-xs font-medium text-success">
                                {formatCurrency(draw.receivedAmount)} ({receivedPercent}%)
                              </p>
                            )}
                          </div>
                          <div className="text-center">
                            <p className="text-xs font-medium">{formatCurrency(remainingAmount)}</p>
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
        eligibleJobStats={eligibleJobStats}
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
