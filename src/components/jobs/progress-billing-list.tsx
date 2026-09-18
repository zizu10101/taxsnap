"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FileText, Plus, Receipt } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { DocumentBuilder } from "@/components/invoices/document-builder";
import { StartProgressBillingDialog } from "@/components/jobs/start-progress-billing-dialog";
import type { Client, Job, LineItem } from "@/lib/database.types";

function formatCurrency(amount: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(amount);
}

export interface ProgressJobSummary {
  job: Job;
  invoicedToDate: number;
  receivedToDate: number;
  remainingBalance: number;
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
          {initialSummaries.map(({ job, invoicedToDate, receivedToDate, remainingBalance }) => (
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
