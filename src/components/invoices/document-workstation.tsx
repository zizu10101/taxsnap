"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowRightLeft, CheckCircle2, DollarSign, FileStack } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { ShareDocumentButton } from "@/components/invoices/share-document-button";
import { LogoImage } from "@/components/invoices/business-logo";
import { formatDocumentNumber } from "@/lib/document-number";
import { cn } from "@/lib/utils";
import type { BusinessInfo } from "@/components/invoices/document-detail";
import type { DocumentStatus, DocumentType, DocumentWithRelations } from "@/lib/database.types";
import { documentLabel } from "@/lib/document-label";
import { drawBadgeLabel } from "@/lib/document-filter";
import { RecordPaymentDialog } from "@/components/invoices/record-payment-dialog";
import type { UpdatedDocument } from "@/components/invoices/payment-form";
import { canRecordPayment, COLLECT_BALANCE_LABEL, mergeUpdatedDocument } from "@/lib/payment-form";
import { useSyncedState } from "@/lib/use-synced-state";
import { invoiceDetailHref } from "@/lib/invoice-back";
import { LineLabel } from "@/components/invoices/line-label";
import { formatQuantity, lineDescription, lineName } from "@/lib/line-format";

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

// lg+ replacement for the plain "New {label}" button + stacked card list
// (rendered by DocumentList itself - see that file) - a list-plus-live-
// preview pane so a contractor with real invoice/estimate history can scan
// and preview without leaving the page. The period KPIs and the New
// {label} button already exist as their own full-width sections above this
// component (InvoiceBillingSummary + the button rendered by DocumentList,
// visible at every width)
// for invoices - this only replaces the list itself, it doesn't duplicate
// those. Shared between Invoices and Estimates (`type` drives the few real
// differences: convert-to-invoice affordance, paid/balance rows). Creating,
// editing, recording payments, changing status, and deleting all still go
// through the existing New/Edit/Detail pages (DocumentBuilder,
// DocumentDetail) via the "View full details" link below - this is a
// browsing/preview layer on top, not a parallel document system.
/** Stable empty lookup (a `= {}` default in the props would be a new object every render). */
const NO_CONVERSIONS: Record<string, string> = {};

export function DocumentWorkstation({
  type,
  documents,
  business,
  logoPath,
  basePath,
  convertedMap,
  onConvert,
}: {
  type: DocumentType;
  documents: DocumentWithRelations[];
  business: BusinessInfo;
  logoPath: string | null;
  basePath: string;
  /** estimate id -> id of the invoice it was converted into (estimates only) */
  convertedMap?: Record<string, string>;
  onConvert?: (id: string) => void;
}) {
  // A local copy that follows the server list (router.refresh() hands down new data and wins),
  // but is updated at once when a payment is recorded from the preview.
  const convertedLookup = convertedMap ?? NO_CONVERSIONS;
  const [localDocs, setLocalDocs] = useSyncedState(documents);
  const [selectedId, setSelectedId] = useState<string | null>(documents[0]?.id ?? null);
  // The selected row can fall out of the list (the Type filter changed); show the first one then.
  const selected = localDocs.find((d) => d.id === selectedId) ?? localDocs[0] ?? null;
  const label = type === "invoice" ? "Invoice" : "Estimate";

  function handlePaymentSaved(updated: UpdatedDocument) {
    setLocalDocs((prev) => prev.map((d) => (d.id === updated.id ? mergeUpdatedDocument(d, updated) : d)));
  }

  if (localDocs.length === 0) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-2 py-10 text-center text-muted-foreground">
          <FileStack className="h-8 w-8" />
          <p className="text-sm">No {label.toLowerCase()}s yet.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="grid grid-cols-[minmax(0,1fr)_26rem] items-start gap-4">
      <div className="max-h-[calc(100vh-14rem)] space-y-2 overflow-y-auto pr-1">
        {localDocs.map((doc) => {
          const paidToDate = doc.payments.reduce((sum, p) => sum + p.amount, 0);
          const balanceDue = doc.total_amount - paidToDate;
          const convertedToId = type === "estimate" ? convertedLookup[doc.id] : undefined;
          return (
            <Card
              key={doc.id}
              role="button"
              tabIndex={0}
              onClick={() => setSelectedId(doc.id)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  setSelectedId(doc.id);
                }
              }}
              className={cn(
                "cursor-pointer gap-0 py-0 outline-none transition-colors hover:bg-muted/50 focus-visible:bg-muted/50",
                doc.id === selectedId && "border-primary bg-primary/5",
              )}
            >
              <CardContent className="flex items-center justify-between gap-3 p-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="truncate text-sm font-medium">
                      {documentLabel(doc.client?.name, doc.job?.name)}
                    </p>
                    {convertedToId ? (
                      <Badge className="border-transparent bg-success text-success-foreground">
                        Converted
                      </Badge>
                    ) : (
                      <Badge variant={STATUS_VARIANT[doc.status]}>{doc.status}</Badge>
                    )}
                    {drawBadgeLabel(doc) && <Badge variant="outline">{drawBadgeLabel(doc)}</Badge>}
                  </div>
                  <p className="truncate text-xs text-muted-foreground">
                    {formatDocumentNumber(doc.type, doc.document_number)} ·{" "}
                    {formatDate(doc.issue_date)}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <span className="block text-sm font-semibold tabular-nums">
                    {formatCurrency(doc.total_amount)}
                  </span>
                  {doc.status === "partial" && (
                    <span className="block text-[11px] text-muted-foreground tabular-nums">
                      {formatCurrency(balanceDue)} due
                    </span>
                  )}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <div className="sticky top-4">
        {selected && (
          <DocumentPreviewPanel
            key={selected.id}
            doc={selected}
            label={label}
            business={business}
            logoPath={logoPath}
            basePath={basePath}
            convertedToId={type === "estimate" ? convertedLookup[selected.id] : undefined}
            onConvert={onConvert}
            onPaymentSaved={handlePaymentSaved}
          />
        )}
      </div>
    </div>
  );
}

function DocumentPreviewPanel({
  doc,
  label,
  business,
  logoPath,
  basePath,
  convertedToId,
  onConvert,
  onPaymentSaved,
}: {
  doc: DocumentWithRelations;
  label: string;
  business: BusinessInfo;
  logoPath: string | null;
  basePath: string;
  convertedToId?: string;
  onConvert?: (id: string) => void;
  onPaymentSaved: (updated: UpdatedDocument) => void;
}) {
  const [paymentOpen, setPaymentOpen] = useState(false);
  const paidToDate = doc.payments.reduce((sum, p) => sum + p.amount, 0);
  const balanceDue = doc.total_amount - paidToDate;
  const shortId = formatDocumentNumber(doc.type, doc.document_number);

  return (
    <Card className="gap-0 py-0">
      <CardContent className="space-y-4 p-4">
        <div className="flex items-center justify-between">
          <span className="font-mono text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
            {label} Preview
          </span>
          <div className="flex items-center gap-2">
          {convertedToId ? (
            <Badge className="border-transparent bg-success text-success-foreground">
              Converted
            </Badge>
          ) : (
            <Badge variant={STATUS_VARIANT[doc.status]} className="capitalize">
              {doc.status}
            </Badge>
          )}
          {drawBadgeLabel(doc) && <Badge variant="outline">{drawBadgeLabel(doc)}</Badge>}
          </div>
        </div>

        {/* Dark ticket-style totals strip, same sidebar tokens the
            progress-billing summary panel uses in document-detail.tsx - a
            deliberate accent, not the general card treatment. */}
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

        <div className="max-h-[24rem] overflow-y-auto rounded-lg border bg-muted/20 p-4">
          {logoPath && (
            <LogoImage
              key={logoPath}
              path={logoPath}
              className="mb-2 h-8 max-w-[160px] object-contain object-left"
            />
          )}
          <p className="text-xs font-bold tracking-tight uppercase">{label}</p>
          <p className="font-mono text-[11px] text-primary">{shortId}</p>

          <div className="mt-3 grid grid-cols-2 gap-3 text-[11px]">
            <div className="min-w-0">
              <p className="text-muted-foreground uppercase">From</p>
              <p className="truncate font-medium">{business.name ?? business.email}</p>
            </div>
            <div className="min-w-0">
              <p className="text-muted-foreground uppercase">Bill to</p>
              <p className="truncate font-medium">{doc.client?.name ?? "—"}</p>
              {doc.job?.name && (
                <p className="truncate text-muted-foreground">Job: {doc.job.name}</p>
              )}
            </div>
          </div>

          <Separator className="my-3" />

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
                  <td className="py-1 pr-2">
                    <LineLabel name={lineName(item)} description={lineDescription(item)} />
                  </td>
                  <td className="py-1 text-right tabular-nums">
                    {formatCurrency(item.quantity * item.unit_price)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <Button
            variant="outline"
            size="sm"
            className="col-span-2"
            nativeButton={false}
            render={<Link href={doc.type === "invoice" ? invoiceDetailHref(doc.id, "invoices") : `${basePath}/${doc.id}`} />}
          >
            View full details
          </Button>
          {doc.type === "estimate" &&
            (convertedToId ? (
              <Button
                variant="outline"
                size="sm"
                className="col-span-2 text-success hover:text-success"
                nativeButton={false}
                render={<Link href={`/dashboard/invoices/${convertedToId}`} />}
              >
                <CheckCircle2 className="h-4 w-4" />
                View Invoice
              </Button>
            ) : (
              <Button
                variant="outline"
                size="sm"
                className="col-span-2"
                onClick={() => onConvert?.(doc.id)}
              >
                <ArrowRightLeft className="h-4 w-4" />
                Convert to Invoice
              </Button>
            ))}
          {canRecordPayment(doc) && (
            <Button
              size="sm"
              className="col-span-2"
              onClick={() => setPaymentOpen(true)}
            >
              <DollarSign className="h-4 w-4" />
              {COLLECT_BALANCE_LABEL}
            </Button>
          )}
          <ShareDocumentButton document={doc} business={business} logoPath={logoPath} />
        </div>
      </CardContent>
      <RecordPaymentDialog
        open={paymentOpen}
        onOpenChange={setPaymentOpen}
        document={doc}
        documentLabel={shortId}
        onSaved={onPaymentSaved}
      />
    </Card>
  );
}
