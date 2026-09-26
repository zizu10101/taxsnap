"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { formatDocumentNumber } from "@/lib/document-number";
import { cn } from "@/lib/utils";
import { getEmptyClientSummary } from "@/lib/client-summary";
import type { Client, DocumentStatus } from "@/lib/database.types";
import type { ClientSummary } from "@/lib/client-summary";

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

const STATUS_VARIANT: Record<DocumentStatus, "outline" | "secondary" | "default"> = {
  draft: "outline",
  sent: "secondary",
  partial: "secondary",
  paid: "default",
};

export interface ClientHistoryDoc {
  id: string;
  type: "invoice" | "estimate";
  status: DocumentStatus;
  document_number: number;
  issue_date: string;
  total_amount: number;
  // Carried along just so a "Recent activity" row can drill into its own
  // ticket-style mini preview in place, inside the same panel, instead of
  // navigating straight to the real invoice/estimate page - see
  // DocPreviewPanel below. Real editing still only happens on that real
  // page, reached via this mini preview's own "View full details" button.
  subtotal: number;
  hst_amount: number;
  payments: { amount: number }[];
  items: { id: string; description: string; quantity: number; unit_price: number }[];
}

// lg+ replacement for the plain "New client" button + stacked card list
// (rendered by ClientList itself - see that file) - same "list | preview"
// pattern as the Invoices/Estimates DocumentWorkstation and the Jobs
// JobWorkstation. summaries and recentDocsByClient are computed once by the
// server page, so switching the selected client is instant with no extra
// fetch. Editing a client's contact info and browsing their full history
// still go through the existing /dashboard/clients/[id] detail page via
// "View full details" - this is a browsing/preview layer on top.
export function ClientWorkstation({
  clients,
  summaries,
  recentDocsByClient,
}: {
  clients: Client[];
  summaries: Record<string, ClientSummary>;
  recentDocsByClient: Record<string, ClientHistoryDoc[]>;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(clients[0]?.id ?? null);
  const selected = clients.find((c) => c.id === selectedId) ?? null;

  if (clients.length === 0) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-2 py-10 text-center text-muted-foreground">
          <Users className="h-8 w-8" />
          <p className="text-sm">No clients yet. Add one to start invoicing.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="grid grid-cols-[minmax(0,1fr)_26rem] items-start gap-4">
      <div className="max-h-[calc(100vh-14rem)] space-y-2 overflow-y-auto pr-1">
        {clients.map((client) => {
          const summary = summaries[client.id] ?? getEmptyClientSummary();
          return (
            <Card
              key={client.id}
              role="button"
              tabIndex={0}
              onClick={() => setSelectedId(client.id)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  setSelectedId(client.id);
                }
              }}
              className={cn(
                "cursor-pointer gap-0 py-0 outline-none transition-colors hover:bg-muted/50 focus-visible:bg-muted/50",
                client.id === selectedId && "border-primary bg-primary/5",
              )}
            >
              <CardContent className="flex items-center justify-between gap-3 p-3">
                <div className="flex min-w-0 items-center gap-2">
                  <Users className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{client.name}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {summary.invoiceCount} invoice{summary.invoiceCount === 1 ? "" : "s"}
                    </p>
                  </div>
                </div>
                <span className="shrink-0 text-sm font-semibold text-success tabular-nums">
                  {formatCurrency(summary.totalRevenue)}
                </span>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <div className="sticky top-4">
        {selected && (
          <ClientPreviewPanel
            key={selected.id}
            client={selected}
            summary={summaries[selected.id] ?? getEmptyClientSummary()}
            recentDocs={recentDocsByClient[selected.id] ?? []}
          />
        )}
      </div>
    </div>
  );
}

function ClientPreviewPanel({
  client,
  summary,
  recentDocs,
}: {
  client: Client;
  summary: ClientSummary;
  recentDocs: ClientHistoryDoc[];
}) {
  // Which recent-activity row (if any) is drilled into - reset for free
  // whenever the parent switches clients, since ClientWorkstation remounts
  // this whole panel via `key={selected.id}`.
  const [previewDoc, setPreviewDoc] = useState<ClientHistoryDoc | null>(null);

  if (previewDoc) {
    return (
      <DocPreviewPanel
        doc={previewDoc}
        clientName={client.name}
        onBack={() => setPreviewDoc(null)}
      />
    );
  }

  return (
    <Card className="gap-0 py-0">
      <CardContent className="space-y-4 p-4">
        <div className="flex items-center justify-between">
          <span className="font-mono text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
            Client History Preview
          </span>
        </div>

        <div>
          <p className="truncate font-heading text-lg font-semibold">{client.name}</p>
          {(client.email || client.address) && (
            <p className="truncate text-xs text-muted-foreground">
              {[client.email, client.address].filter(Boolean).join(" · ")}
            </p>
          )}
        </div>

        <div className="space-y-1.5 rounded-lg border border-sidebar-border bg-sidebar p-3 font-mono text-xs text-sidebar-foreground">
          <div className="flex items-center justify-between">
            <span className="text-sidebar-foreground/60">Invoices</span>
            <span>{summary.invoiceCount}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sidebar-foreground/60">Estimates</span>
            <span>{summary.estimateCount}</span>
          </div>
          <div className="flex items-center justify-between border-t border-sidebar-border pt-1.5">
            <span className="text-sidebar-foreground/60">Total invoiced</span>
            <span>{formatCurrency(summary.totalInvoiced)}</span>
          </div>
          <div className="flex items-center justify-between text-sm font-semibold">
            <span>Revenue collected</span>
            <span className="text-sidebar-primary">{formatCurrency(summary.totalRevenue)}</span>
          </div>
          {summary.outstandingBalance > 0 && (
            <div className="flex items-center justify-between pt-1">
              <span className="text-sidebar-foreground/60">Outstanding</span>
              <span>{formatCurrency(summary.outstandingBalance)}</span>
            </div>
          )}
        </div>

        {recentDocs.length === 0 ? (
          <p className="rounded-lg border bg-muted/20 p-3 text-xs text-muted-foreground">
            No invoices or estimates for this client yet.
          </p>
        ) : (
          <div className="space-y-1.5 rounded-lg border bg-muted/20 p-2">
            <p className="px-1 pt-1 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
              Recent activity
            </p>
            {recentDocs.map((doc) => (
              <button
                key={doc.id}
                type="button"
                onClick={() => setPreviewDoc(doc)}
                className="flex w-full items-center justify-between gap-2 rounded-md px-1 py-1.5 text-left text-xs hover:bg-muted"
              >
                <div className="min-w-0">
                  <p className="truncate font-medium">
                    {formatDocumentNumber(doc.type, doc.document_number)}
                  </p>
                  <p className="text-[11px] text-muted-foreground">{formatDate(doc.issue_date)}</p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Badge variant={STATUS_VARIANT[doc.status]} className="capitalize">
                    {doc.status}
                  </Badge>
                  <span className="font-semibold tabular-nums">
                    {formatCurrency(doc.total_amount)}
                  </span>
                </div>
              </button>
            ))}
          </div>
        )}

        <Separator />

        <Button
          variant="outline"
          size="sm"
          className="w-full"
          nativeButton={false}
          render={<Link href={`/dashboard/clients/${client.id}`} />}
        >
          View full details
        </Button>
      </CardContent>
    </Card>
  );
}

// The "preview inside the preview" a Recent activity row drills into - same
// ticket-style totals block + item table as DocumentWorkstation's own
// DocumentPreviewPanel (invoices/document-workstation.tsx), just without
// that one's business letterhead section, since "Bill to" is already
// implied by being inside this client's own panel. Its own "View full
// details" points at the real invoice/estimate page, not back to the
// client - editing, payments, and status changes only ever happen there.
function DocPreviewPanel({
  doc,
  clientName,
  onBack,
}: {
  doc: ClientHistoryDoc;
  clientName: string;
  onBack: () => void;
}) {
  const label = doc.type === "invoice" ? "Invoice" : "Estimate";
  const paidToDate = doc.payments.reduce((sum, p) => sum + p.amount, 0);
  const balanceDue = doc.total_amount - paidToDate;

  return (
    <Card className="gap-0 py-0">
      <CardContent className="space-y-4 p-4">
        <div className="flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={onBack}
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Back to {clientName}
          </button>
          <Badge variant={STATUS_VARIANT[doc.status]} className="capitalize">
            {doc.status}
          </Badge>
        </div>

        <div>
          <p className="text-xs font-bold tracking-tight uppercase">{label}</p>
          <p className="font-mono text-[11px] text-primary">
            {formatDocumentNumber(doc.type, doc.document_number)}
          </p>
          <p className="text-xs text-muted-foreground">{formatDate(doc.issue_date)}</p>
        </div>

        <div className="space-y-1.5 rounded-lg border border-sidebar-border bg-sidebar p-3 font-mono text-xs text-sidebar-foreground">
          <div className="flex items-center justify-between">
            <span className="text-sidebar-foreground/60">Subtotal</span>
            <span>{formatCurrency(doc.subtotal)}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sidebar-foreground/60">HST</span>
            <span>{formatCurrency(doc.hst_amount)}</span>
          </div>
          <div className="flex items-center justify-between border-t border-sidebar-border pt-1.5 text-sm font-semibold">
            <span>Total</span>
            <span className="text-sidebar-primary">{formatCurrency(doc.total_amount)}</span>
          </div>
          {paidToDate > 0 && (
            <div className="flex items-center justify-between pt-1">
              <span className="text-sidebar-foreground/60">Paid to date</span>
              <span>{formatCurrency(paidToDate)}</span>
            </div>
          )}
          {doc.type === "invoice" && paidToDate > 0 && (
            <div className="flex items-center justify-between font-semibold">
              <span>Balance due</span>
              <span>{formatCurrency(Math.max(balanceDue, 0))}</span>
            </div>
          )}
        </div>

        {doc.items.length > 0 && (
          <div className="max-h-[16rem] overflow-y-auto rounded-lg border bg-muted/20 p-3">
            <table className="w-full text-[11px]">
              <thead>
                <tr className="text-left text-muted-foreground">
                  <th className="pb-1 font-normal uppercase">Item</th>
                  <th className="pb-1 text-right font-normal uppercase">Amount</th>
                </tr>
              </thead>
              <tbody>
                {doc.items.map((item) => (
                  <tr key={item.id} className="border-t">
                    <td className="truncate py-1 pr-2">{item.description}</td>
                    <td className="py-1 text-right tabular-nums">
                      {formatCurrency(item.quantity * item.unit_price)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <Separator />

        <Button
          variant="outline"
          size="sm"
          className="w-full"
          nativeButton={false}
          render={
            <Link href={`/dashboard/${doc.type === "invoice" ? "invoices" : "estimates"}/${doc.id}`} />
          }
        >
          View full details
        </Button>
      </CardContent>
    </Card>
  );
}
