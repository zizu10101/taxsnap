"use client";

import Link from "next/link";
import { ArrowLeft, Printer } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDocumentNumber } from "@/lib/document-number";
import type { DocumentStatus } from "@/lib/database.types";

const STATUS_VARIANT: Record<DocumentStatus, "outline" | "secondary" | "default"> = {
  draft: "outline",
  sent: "secondary",
  partial: "secondary",
  paid: "default",
};

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

export interface SummaryDrawPayment {
  id: string;
  amount: number;
  paidDate: string;
}

export interface SummaryDraw {
  id: string;
  documentNumber: number;
  drawNumber: number | null;
  status: DocumentStatus;
  issueDate: string;
  totalAmount: number;
  description: string | null;
  percentComplete: number | null;
  receivedAmount: number;
  payments: SummaryDrawPayment[];
  runningReceivedToDate: number;
  runningRemainingBalance: number;
}

export function ProgressBillingSummary({
  job,
  invoicedToDate,
  receivedToDate,
  remainingBalance,
  draws,
}: {
  job: { id: string; name: string; contractValue: number };
  invoicedToDate: number;
  receivedToDate: number;
  remainingBalance: number;
  draws: SummaryDraw[];
}) {
  return (
    <div className="mx-auto w-full max-w-2xl p-4">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2 print:hidden">
        <Link
          href="/dashboard/progress-billing"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Progress Billing
        </Link>
        <Button variant="outline" size="sm" onClick={() => window.print()}>
          <Printer className="h-4 w-4" />
          Print
        </Button>
      </div>

      <div className="mb-4">
        <p className="text-sm text-muted-foreground">Progress Billing Summary</p>
        <h1 className="text-2xl font-bold">{job.name}</h1>
      </div>

      <Card>
        <CardContent className="py-4">
          <div className="grid grid-cols-2 gap-2 text-center sm:grid-cols-4">
            <div>
              <p className="text-xs text-muted-foreground">Contract Value</p>
              <p className="font-semibold tabular-nums">{formatCurrency(job.contractValue)}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Invoiced to Date</p>
              <p className="font-semibold tabular-nums">{formatCurrency(invoicedToDate)}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Received to Date</p>
              <p className="font-semibold tabular-nums text-success">
                {formatCurrency(receivedToDate)}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Remaining Balance</p>
              <p className="font-semibold tabular-nums">{formatCurrency(remainingBalance)}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="mt-4">
        <CardHeader>
          <CardTitle className="text-base">Draw History</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {draws.length === 0 ? (
            <p className="text-sm text-muted-foreground">No draws recorded yet.</p>
          ) : (
            draws.map((draw) => (
              <div key={draw.id} className="space-y-2 rounded-lg border p-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Link
                    href={`/dashboard/invoices/${draw.id}`}
                    className="font-medium hover:underline print:no-underline"
                  >
                    Draw #{draw.drawNumber ?? "?"} —{" "}
                    {formatDocumentNumber("invoice", draw.documentNumber)}
                  </Link>
                  <Badge variant={STATUS_VARIANT[draw.status]}>{draw.status}</Badge>
                </div>
                <p className="text-xs text-muted-foreground">{formatDate(draw.issueDate)}</p>

                <div className="grid grid-cols-2 gap-2 text-center sm:grid-cols-4">
                  <div>
                    <p className="text-xs text-muted-foreground">This Draw</p>
                    <p className="font-medium tabular-nums">{formatCurrency(draw.totalAmount)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Received</p>
                    <p className="font-medium tabular-nums text-success">
                      {formatCurrency(draw.receivedAmount)}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Received to Date</p>
                    <p className="font-medium tabular-nums">
                      {formatCurrency(draw.runningReceivedToDate)}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Remaining</p>
                    <p className="font-medium tabular-nums">
                      {formatCurrency(draw.runningRemainingBalance)}
                    </p>
                  </div>
                </div>

                {draw.payments.length > 0 && (
                  <div className="border-t pt-2">
                    <p className="text-xs font-medium text-muted-foreground">Payments</p>
                    {draw.payments.map((payment) => (
                      <p key={payment.id} className="text-xs text-success">
                        {formatDate(payment.paidDate)} · {formatCurrency(payment.amount)}
                      </p>
                    ))}
                  </div>
                )}

                {(draw.description || draw.percentComplete !== null) && (
                  <div className="border-t pt-2 text-xs text-muted-foreground">
                    {draw.percentComplete !== null && <p>{draw.percentComplete}% complete</p>}
                    {draw.description && <p>{draw.description}</p>}
                  </div>
                )}
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
