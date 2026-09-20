"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  CircleDollarSign,
  FileEdit,
  LayoutDashboard,
  Pencil,
  Printer,
  Table2,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DocumentBuilder } from "@/components/invoices/document-builder";
import { LogContractChangeDialog } from "@/components/jobs/log-contract-change-dialog";
import { formatDocumentNumber } from "@/lib/document-number";
import { cn } from "@/lib/utils";
import type { Client, ContractChange, DocumentStatus, LineItem } from "@/lib/database.types";

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

// Boxed stat treatment (bordered/tinted mini-card, bold figure, uppercase
// tracked label) used for both the job-level stat row and each draw
// card's own sub-stats - "lg" for the former (more prominent), "sm" for
// the latter (secondary detail inside a draw card).
function StatBox({
  label,
  value,
  tone = "default",
  size = "sm",
  action,
}: {
  label: string;
  value: string;
  tone?: "default" | "success";
  size?: "sm" | "lg";
  action?: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border bg-muted/30 p-2.5 text-center">
      <div className="flex items-center justify-center gap-1">
        <p className="text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
          {label}
        </p>
        {action}
      </div>
      <p
        className={cn(
          "mt-0.5 font-semibold tabular-nums",
          size === "lg" ? "text-lg" : "text-sm",
          tone === "success" && "text-success",
        )}
      >
        {value}
      </p>
    </div>
  );
}

// The small numbered chip identifying a draw - replaces plain "Draw #2"
// text with a colored badge, same idea as the reference layout's
// numbered pay-application chip.
function DrawChip({ n }: { n: number | null }) {
  return (
    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary/10 text-sm font-bold text-primary">
      {n ?? "?"}
    </span>
  );
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
  changes,
  jobs,
  clients,
  lineItems,
}: {
  job: { id: string; name: string; contractValue: number };
  invoicedToDate: number;
  receivedToDate: number;
  remainingBalance: number;
  draws: SummaryDraw[];
  changes: ContractChange[];
  // DocumentBuilder's own requirements for the "Bill Remaining Balance"
  // draw it opens - same three lists the parent tab's New Draw already
  // needs.
  jobs: { id: string; name: string }[];
  clients: Client[];
  lineItems: LineItem[];
}) {
  const router = useRouter();
  const [billOpen, setBillOpen] = useState(false);
  const [logChangeOpen, setLogChangeOpen] = useState(false);
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

      <Card className="mb-4">
        <CardContent className="flex flex-wrap items-center justify-between gap-3 py-4">
          <div>
            <p className="text-sm text-muted-foreground">Progress Billing Summary</p>
            <h1 className="text-xl font-bold sm:text-2xl">{job.name}</h1>
          </div>
          {notYetInvoiced > 0.01 && (
            <Button variant="outline" className="print:hidden" onClick={() => setBillOpen(true)}>
              <CircleDollarSign className="h-4 w-4" />
              Bill Remaining Balance ({formatCurrency(notYetInvoiced)})
            </Button>
          )}
        </CardContent>
      </Card>

      <Tabs defaultValue="overview">
        <TabsList className="mb-4 grid h-11 w-full grid-cols-3 gap-1 p-1 print:hidden">
          <TabsTrigger value="overview" className="gap-1.5">
            <LayoutDashboard className="h-4 w-4" />
            Overview
          </TabsTrigger>
          <TabsTrigger value="ledger" className="gap-1.5">
            <Table2 className="h-4 w-4" />
            Ledger
          </TabsTrigger>
          <TabsTrigger value="changes" className="gap-1.5">
            <FileEdit className="h-4 w-4" />
            Change Orders
            {changes.length > 0 && (
              <span className="ml-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold text-primary-foreground">
                {changes.length}
              </span>
            )}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="overview">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <StatBox
              label="Contract Value"
              value={formatCurrency(job.contractValue)}
              size="lg"
              action={
                <button
                  type="button"
                  onClick={() => setLogChangeOpen(true)}
                  className="text-muted-foreground hover:text-foreground print:hidden"
                  title="Log a change order"
                >
                  <Pencil className="h-3 w-3" />
                </button>
              }
            />
            <StatBox label="Invoiced to Date" value={formatCurrency(invoicedToDate)} size="lg" />
            <StatBox
              label="Received to Date"
              value={formatCurrency(receivedToDate)}
              size="lg"
              tone="success"
            />
            <StatBox label="Remaining Balance" value={formatCurrency(remainingBalance)} size="lg" />
          </div>

          <Card className="mt-4">
            <CardHeader>
              <CardTitle className="text-base">Draws</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {draws.length === 0 ? (
                <p className="text-sm text-muted-foreground">No draws recorded yet.</p>
              ) : (
                draws.map((draw) => {
                  const drawRemaining = round2(draw.totalAmount - draw.receivedAmount);
                  const isSettled = drawRemaining <= 0.01;
                  return (
                    <div key={draw.id} className="overflow-hidden rounded-lg border">
                      <div className="flex flex-wrap items-start justify-between gap-3 p-3">
                        <div className="flex min-w-0 items-start gap-2.5">
                          <DrawChip n={draw.drawNumber} />
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <Link
                                href={`/dashboard/invoices/${draw.id}`}
                                className="font-medium hover:underline print:no-underline"
                              >
                                {formatDocumentNumber("invoice", draw.documentNumber)}
                              </Link>
                              <Badge variant={STATUS_VARIANT[draw.status]}>{draw.status}</Badge>
                            </div>
                            <p className="text-xs text-muted-foreground">
                              {formatDate(draw.issueDate)}
                            </p>
                          </div>
                        </div>
                        <div className="shrink-0 text-right">
                          <p className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
                            Remaining
                          </p>
                          <p
                            className={cn(
                              "text-2xl font-bold tabular-nums",
                              isSettled ? "text-success" : "text-primary",
                            )}
                          >
                            {formatCurrency(drawRemaining)}
                          </p>
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-2 border-t p-3 sm:grid-cols-4">
                        <StatBox label="This Draw" value={formatCurrency(draw.totalAmount)} />
                        <StatBox
                          label="Received"
                          value={formatCurrency(draw.receivedAmount)}
                          tone="success"
                        />
                        <StatBox
                          label="Received to Date"
                          value={formatCurrency(draw.runningReceivedToDate)}
                        />
                        <StatBox
                          label="Remaining to Date"
                          value={formatCurrency(draw.runningRemainingBalance)}
                        />
                      </div>

                      {draw.payments.length > 0 && (
                        <div className="border-t p-3">
                          <p className="text-xs font-medium text-muted-foreground">Payments</p>
                          {draw.payments.map((payment) => (
                            <p key={payment.id} className="text-xs text-success">
                              {formatDate(payment.paidDate)} · {formatCurrency(payment.amount)}
                            </p>
                          ))}
                        </div>
                      )}

                      {(draw.description || draw.percentComplete !== null) && (
                        <div className="border-t p-3 text-xs text-muted-foreground">
                          {draw.percentComplete !== null && (
                            <p>{draw.percentComplete}% complete</p>
                          )}
                          {draw.description && <p>{draw.description}</p>}
                        </div>
                      )}
                    </div>
                  );
                })
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

        <TabsContent value="changes">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Change Orders</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {changes.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No change orders logged yet.
                </p>
              ) : (
                changes.map((change) => (
                  <div
                    key={change.id}
                    className="flex items-center justify-between gap-3 rounded-lg border p-3 text-sm"
                  >
                    <div className="min-w-0">
                      <p className="font-medium">{change.reason}</p>
                      <p className="text-xs text-muted-foreground">
                        {formatDate(change.changed_at)}
                      </p>
                    </div>
                    <span
                      className={`shrink-0 font-semibold tabular-nums ${
                        change.amount >= 0 ? "text-success" : "text-destructive"
                      }`}
                    >
                      {change.amount >= 0 ? "+" : ""}
                      {formatCurrency(change.amount)}
                    </span>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <LogContractChangeDialog
        open={logChangeOpen}
        onOpenChange={setLogChangeOpen}
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
