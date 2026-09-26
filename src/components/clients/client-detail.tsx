"use client";

import { useState } from "react";
import Link from "next/link";
import { Mail, MapPin, Pencil, Receipt } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EditClientDialog } from "@/components/clients/edit-client-dialog";
import { formatDocumentNumber } from "@/lib/document-number";
import type { Client, DocumentStatus } from "@/lib/database.types";
import type { ClientSummary } from "@/lib/client-summary";

// This flat history list only ever links straight out to the real
// invoice/estimate page (no in-place preview here, unlike the Clients
// list's ClientWorkstation) - so it only needs the same subset
// ClientWorkstation's own row uses, not the fuller ClientHistoryDoc shape
// that carries items/subtotal/hst_amount for its drill-down preview.
export interface ClientDocRow {
  id: string;
  type: "invoice" | "estimate";
  status: DocumentStatus;
  document_number: number;
  issue_date: string;
  total_amount: number;
}

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

export function ClientDetail({
  initialClient,
  summary,
  documents,
}: {
  initialClient: Client;
  summary: ClientSummary;
  documents: ClientDocRow[];
}) {
  const [client, setClient] = useState(initialClient);
  const [editOpen, setEditOpen] = useState(false);

  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-3 lg:items-start">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2">
            <CardTitle>Contact</CardTitle>
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setEditOpen(true)}>
              <Pencil className="h-4 w-4" />
            </Button>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {client.email ? (
              <div className="flex items-center gap-2 text-muted-foreground">
                <Mail className="h-4 w-4 shrink-0" />
                <span className="truncate">{client.email}</span>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">No email on file.</p>
            )}
            {client.address && (
              <div className="flex items-center gap-2 text-muted-foreground">
                <MapPin className="h-4 w-4 shrink-0" />
                <span className="truncate">{client.address}</span>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>History</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-3 gap-2 text-center">
            <div>
              <p className="text-xs text-muted-foreground">Invoices</p>
              <p className="font-semibold tabular-nums">{summary.invoiceCount}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Estimates</p>
              <p className="font-semibold tabular-nums">{summary.estimateCount}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Invoiced</p>
              <p className="font-semibold text-primary tabular-nums">
                {formatCurrency(summary.totalInvoiced)}
              </p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Revenue</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-2 text-center">
            <div>
              <p className="text-xs text-muted-foreground">Collected</p>
              <p className="font-semibold text-success tabular-nums">
                {formatCurrency(summary.totalRevenue)}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Outstanding</p>
              <p
                className={`font-semibold tabular-nums ${summary.outstandingBalance > 0 ? "text-destructive" : ""}`}
              >
                {formatCurrency(summary.outstandingBalance)}
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Invoices &amp; estimates</CardTitle>
        </CardHeader>
        <CardContent>
          {documents.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-8 text-center text-muted-foreground">
              <Receipt className="h-8 w-8" />
              <p className="text-sm">Nothing billed to this client yet.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {documents.map((doc) => (
                <Link
                  key={doc.id}
                  href={`/dashboard/${doc.type === "invoice" ? "invoices" : "estimates"}/${doc.id}`}
                  className="flex items-center justify-between gap-3 rounded-lg border p-3 hover:bg-muted/50"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="truncate text-sm font-medium">
                        {formatDocumentNumber(doc.type, doc.document_number)}
                      </p>
                      <Badge variant={STATUS_VARIANT[doc.status]} className="capitalize">
                        {doc.status}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground">{formatDate(doc.issue_date)}</p>
                  </div>
                  <span className="shrink-0 text-sm font-semibold tabular-nums">
                    {formatCurrency(doc.total_amount)}
                  </span>
                </Link>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <EditClientDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        client={client}
        onSaved={setClient}
      />
    </div>
  );
}
