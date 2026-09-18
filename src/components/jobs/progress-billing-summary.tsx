"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, CircleDollarSign, Pencil, Printer } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DocumentBuilder } from "@/components/invoices/document-builder";
import { EditContractValueDialog } from "@/components/jobs/edit-contract-value-dialog";
import { formatDocumentNumber } from "@/lib/document-number";
import type { Client, DocumentStatus, LineItem } from "@/lib/database.types";

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

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
  jobs,
  clients,
  lineItems,
}: {
  job: { id: string; name: string; contractValue: number };
  invoicedToDate: number;
  receivedToDate: number;
  remainingBalance: number;
  draws: SummaryDraw[];
  // DocumentBuilder's own requirements for the "Bill Remaining Balance"
  // draw it opens - same three lists the parent tab's New Draw already
  // needs.
  jobs: { id: string; name: string }[];
  clients: Client[];
  lineItems: LineItem[];
}) {
  const router = useRouter();
  const [billOpen, setBillOpen] = useState(false);
  const [editValueOpen, setEditValueOpen] = useState(false);
  // The part of the contract that's never been invoiced at all - not
  // remainingBalance above (contractValue - receivedToDate), which also
  // includes any already-invoiced draw that's just sitting unpaid.
  // Billing that portion again as a *new* draw would double-invoice it;
  // an unpaid existing draw still gets collected by opening that draw
  // itself, not through this button.
  const notYetInvoiced = round2(job.contractValue - invoicedToDate);

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

      <Tabs defaultValue="overview">
        <TabsList className="mb-4 grid w-full grid-cols-2 print:hidden">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="ledger">Ledger</TabsTrigger>
        </TabsList>

        <TabsContent value="overview">
          <Card>
            <CardContent className="py-4">
              <div className="grid grid-cols-2 gap-2 text-center sm:grid-cols-4">
                <div>
                  <div className="flex items-center justify-center gap-1">
                    <p className="text-xs text-muted-foreground">Contract Value</p>
                    <button
                      type="button"
                      onClick={() => setEditValueOpen(true)}
                      className="text-muted-foreground hover:text-foreground print:hidden"
                      title="Edit contract value"
                    >
                      <Pencil className="h-3 w-3" />
                    </button>
                  </div>
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
              {notYetInvoiced > 0.01 && (
                <Button
                  className="mt-4 w-full print:hidden"
                  variant="outline"
                  onClick={() => setBillOpen(true)}
                >
                  <CircleDollarSign className="h-4 w-4" />
                  Bill Remaining Balance ({formatCurrency(notYetInvoiced)})
                </Button>
              )}
            </CardContent>
          </Card>

          <Card className="mt-4">
            <CardHeader>
              <CardTitle className="text-base">Draws</CardTitle>
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
                        <p className="font-medium tabular-nums">
                          {formatCurrency(draw.totalAmount)}
                        </p>
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
        </TabsContent>

        <TabsContent value="ledger">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Draw Ledger</CardTitle>
            </CardHeader>
            <CardContent>
              {draws.length === 0 ? (
                <p className="text-sm text-muted-foreground">No draws recorded yet.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-left text-xs text-muted-foreground">
                        <th className="py-2 pr-3 font-medium">Draw #</th>
                        <th className="py-2 pr-3 font-medium">Invoice #</th>
                        <th className="py-2 pr-3 font-medium">Date</th>
                        <th className="py-2 pr-3 text-right font-medium">Amount</th>
                        <th className="py-2 pr-3 text-right font-medium">Received</th>
                        <th className="py-2 pr-3 text-right font-medium">Remaining</th>
                        <th className="py-2 font-medium">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {draws.map((draw) => {
                        const drawRemaining = round2(draw.totalAmount - draw.receivedAmount);
                        return (
                          <tr
                            key={draw.id}
                            role="button"
                            tabIndex={0}
                            onClick={() => router.push(`/dashboard/invoices/${draw.id}`)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter" || e.key === " ") {
                                e.preventDefault();
                                router.push(`/dashboard/invoices/${draw.id}`);
                              }
                            }}
                            className="cursor-pointer border-b outline-none last:border-0 hover:bg-muted/50 focus-visible:bg-muted/50"
                          >
                            <td className="py-2 pr-3 tabular-nums">{draw.drawNumber ?? "?"}</td>
                            <td className="py-2 pr-3 whitespace-nowrap tabular-nums">
                              {formatDocumentNumber("invoice", draw.documentNumber)}
                            </td>
                            <td className="py-2 pr-3 whitespace-nowrap">
                              {formatDate(draw.issueDate)}
                            </td>
                            <td className="py-2 pr-3 text-right tabular-nums">
                              {formatCurrency(draw.totalAmount)}
                            </td>
                            <td className="py-2 pr-3 text-right tabular-nums text-success">
                              {formatCurrency(draw.receivedAmount)}
                            </td>
                            <td className="py-2 pr-3 text-right tabular-nums">
                              {formatCurrency(drawRemaining)}
                            </td>
                            <td className="py-2">
                              <Badge variant={STATUS_VARIANT[draw.status]}>{draw.status}</Badge>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <EditContractValueDialog
        open={editValueOpen}
        onOpenChange={setEditValueOpen}
        jobId={job.id}
        currentValue={job.contractValue}
        onSaved={() => router.refresh()}
      />

      <DocumentBuilder
        open={billOpen}
        onOpenChange={setBillOpen}
        defaultType="invoice"
        clients={clients}
        jobs={jobs}
        savedLineItems={lineItems}
        progressDrawJob={{ name: job.name }}
        presetItems={[
          { description: "Remaining balance", quantity: 1, unit_price: notYetInvoiced },
        ]}
        onSaved={(saved) => router.push(`/dashboard/invoices/${saved.id}`)}
        onClientCreated={() => router.refresh()}
      />
    </div>
  );
}
