"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  ArrowRightLeft,
  CheckCircle2,
  DollarSign,
  Loader2,
  Pencil,
  Printer,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NumberInput } from "@/components/ui/number-input";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DocumentBuilder } from "@/components/invoices/document-builder";
import { LogoImage } from "@/components/invoices/business-logo";
import { PaidStamp } from "@/components/invoices/paid-stamp";
import { ShareDocumentButton } from "@/components/invoices/share-document-button";
import { formatDocumentNumber } from "@/lib/document-number";
import { calculateRemainingBalance } from "@/lib/progress-billing";
import type { PriorDraw } from "@/lib/invoice-pdf";
import type {
  Client,
  DocumentStatus,
  DocumentWithRelations,
  LineItem,
  Payment,
} from "@/lib/database.types";

function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function formatCurrency(amount: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(amount);
}

function formatDate(dateStr: string) {
  return new Date(`${dateStr}T00:00:00`).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

export interface BusinessInfo {
  name: string | null;
  email: string;
  phone: string | null;
  address: string | null;
}

export function DocumentDetail({
  document,
  clients,
  jobs = [],
  lineItems = [],
  priorDraws = [],
  business,
  logoPath,
  basePath,
  convertedToInvoiceId = null,
}: {
  document: DocumentWithRelations;
  clients: Client[];
  jobs?: { id: string; name: string }[];
  lineItems?: LineItem[];
  // Other draws on the same job - for the "Previous Billed" figure in
  // both the on-screen and PDF progress-billing summary. Only meaningful
  // when document.is_progress_draw.
  priorDraws?: PriorDraw[];
  business: BusinessInfo;
  logoPath: string | null;
  basePath: string;
  convertedToInvoiceId?: string | null;
}) {
  const router = useRouter();
  const [doc, setDoc] = useState(document);
  const [allClients, setAllClients] = useState(clients);
  const [editorOpen, setEditorOpen] = useState(false);
  const [statusSaving, setStatusSaving] = useState(false);
  const [converting, setConverting] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const [paymentAmount, setPaymentAmount] = useState(0);
  // % mode is a separate entry field, not a live conversion of
  // paymentAmount - switching modes doesn't try to reverse-derive one
  // from the other, it just enters the other one blank. The % basis is
  // this document's own total_amount (a draw's total, not the overall
  // contract value - "90%" means 90% of *this invoice*, matching how an
  // owner actually talks about a partial payment).
  const [paymentMode, setPaymentMode] = useState<"dollar" | "percent">("dollar");
  const [paymentPercent, setPaymentPercent] = useState(0);
  const [paymentDate, setPaymentDate] = useState(() => toIsoDate(new Date()));
  const [paymentMethod, setPaymentMethod] = useState("");
  const [paymentNote, setPaymentNote] = useState("");
  const [addingPayment, setAddingPayment] = useState(false);
  const [deletingPaymentId, setDeletingPaymentId] = useState<string | null>(
    null,
  );
  // Set while editing an existing payment - the same amount/date/method/
  // note fields double as the edit form, PATCHing instead of POSTing on
  // save. Null means the form is in its normal "add a new payment" mode.
  const [editingPaymentId, setEditingPaymentId] = useState<string | null>(null);

  const label = doc.is_progress_draw
    ? "Progress Invoice"
    : doc.type === "invoice"
      ? "Invoice"
      : "Estimate";
  // A progress draw was opened from the Progress Billing tab, not the
  // regular Invoices list basePath always points at - back navigation
  // (and the post-delete redirect) should return there instead, not to
  // Invoices.
  const backHref = doc.is_progress_draw ? "/dashboard/progress-billing" : basePath;
  const backLabel = doc.is_progress_draw ? "Progress Billing" : `${label.toLowerCase()}s`;
  const shortId = doc.is_progress_draw
    ? `${formatDocumentNumber(doc.type, doc.document_number)} — Draw #${doc.draw_number}`
    : formatDocumentNumber(doc.type, doc.document_number);
  const paidToDate = doc.payments.reduce((sum, p) => sum + p.amount, 0);
  const balanceDue = doc.total_amount - paidToDate;

  const paymentAmountFromPercent =
    Math.round(((paymentPercent / 100) * doc.total_amount + Number.EPSILON) * 100) / 100;
  const effectivePaymentAmount =
    paymentMode === "percent" ? paymentAmountFromPercent : paymentAmount;

  // While editing an existing payment, that payment's current amount is
  // still counted in paidToDate/balanceDue above - add it back so editing
  // a payment doesn't immediately read as "over the balance" against its
  // own prior value.
  const paymentBeingEdited = editingPaymentId
    ? (doc.payments.find((p) => p.id === editingPaymentId) ?? null)
    : null;
  const effectiveBalanceDue = balanceDue + (paymentBeingEdited?.amount ?? 0);

  // Same pre-tax (subtotal) math as generateDocumentPdf's Progress
  // Billing Summary, kept in sync by hand since one is jsPDF drawing
  // calls and the other JSX - not worth a shared renderer for five rows.
  const contractValue = doc.job?.contract_value ?? 0;
  const previousBilled = priorDraws
    .filter((d) => (d.draw_number ?? 0) < (doc.draw_number ?? 0))
    .reduce((sum, d) => sum + d.subtotal, 0);
  const totalBilledToDate = previousBilled + doc.subtotal;
  const remainingBalance = calculateRemainingBalance(contractValue, totalBilledToDate);

  async function handleStatusChange(status: DocumentStatus) {
    setStatusSaving(true);
    try {
      const res = await fetch(`/api/documents/${doc.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to update status");
      setDoc((prev) => ({ ...prev, status: data.document.status }));
      toast.success(`Marked as ${status}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setStatusSaving(false);
    }
  }

  async function handleConvert() {
    setConverting(true);
    try {
      const res = await fetch(`/api/documents/${doc.id}/convert`, {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to convert");
      toast.success("Converted to a draft invoice");
      router.push(`/dashboard/invoices/${data.document.id}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setConverting(false);
    }
  }

  function startEditPayment(payment: Payment) {
    setEditingPaymentId(payment.id);
    setPaymentMode("dollar");
    setPaymentAmount(payment.amount);
    setPaymentPercent(0);
    setPaymentDate(payment.paid_date);
    setPaymentMethod(payment.method ?? "");
    setPaymentNote(payment.note ?? "");
  }

  function cancelEditPayment() {
    setEditingPaymentId(null);
    setPaymentAmount(0);
    setPaymentPercent(0);
    setPaymentDate(toIsoDate(new Date()));
    setPaymentMethod("");
    setPaymentNote("");
  }

  async function handleSavePayment() {
    const isEditing = !!editingPaymentId;
    if (effectivePaymentAmount <= 0) {
      toast.error(
        paymentMode === "percent"
          ? "Enter a percentage greater than 0%."
          : "Enter a payment amount greater than $0.",
      );
      return;
    }
    // Instant feedback before the round trip - the server enforces this
    // too (authoritative, catches a stale balanceDue or a direct API
    // call), see POST/PATCH /api/documents/[id]/payments's own comment.
    if (effectivePaymentAmount > effectiveBalanceDue + 0.001) {
      const over = effectivePaymentAmount - effectiveBalanceDue;
      toast.error(
        `This payment would exceed the invoice total by ${formatCurrency(over)} — edit the invoice or adjust the payment amount.`,
      );
      return;
    }
    setAddingPayment(true);
    try {
      const res = await fetch(
        isEditing
          ? `/api/documents/${doc.id}/payments/${editingPaymentId}`
          : `/api/documents/${doc.id}/payments`,
        {
          method: isEditing ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            amount: effectivePaymentAmount,
            paid_date: paymentDate,
            method: paymentMethod,
            note: paymentNote,
          }),
        },
      );
      const data = await res.json();
      if (!res.ok)
        throw new Error(data.error || `Failed to ${isEditing ? "update" : "record"} payment`);
      setDoc((prev) => ({ ...prev, ...data.document, items: prev.items }));
      cancelEditPayment();
      toast.success(isEditing ? "Payment updated" : "Payment recorded");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setAddingPayment(false);
    }
  }

  async function handleDeletePayment(paymentId: string) {
    setDeletingPaymentId(paymentId);
    try {
      const res = await fetch(
        `/api/documents/${doc.id}/payments/${paymentId}`,
        { method: "DELETE" },
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to delete payment");
      setDoc((prev) => ({ ...prev, ...data.document, items: prev.items }));
      if (editingPaymentId === paymentId) cancelEditPayment();
      toast.success("Payment removed");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setDeletingPaymentId(null);
    }
  }

  async function handleDelete() {
    setDeleting(true);
    try {
      const res = await fetch(`/api/documents/${doc.id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to delete");
      }
      toast.success(`${label} deleted`);
      router.push(backHref);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Something went wrong");
      setDeleting(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-2xl p-4">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2 print:hidden">
        <Link
          href={backHref}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to {backLabel}
        </Link>
        {doc.job && (
          <Link
            href={`/dashboard/jobs/${doc.job.id}`}
            className="text-sm text-muted-foreground hover:text-foreground"
          >
            Job: <span className="font-medium underline underline-offset-2">{doc.job.name}</span>
          </Link>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <Select
            value={doc.status}
            onValueChange={(v) => v && handleStatusChange(v as DocumentStatus)}
          >
            <SelectTrigger className="h-8 w-28" disabled={statusSaving}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="draft">Draft</SelectItem>
              <SelectItem value="sent">Sent</SelectItem>
              <SelectItem value="partial">Partial</SelectItem>
              <SelectItem value="paid">Paid</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" onClick={() => setEditorOpen(true)}>
            <Pencil className="h-4 w-4" />
            Edit
          </Button>
          {doc.type === "estimate" &&
            (convertedToInvoiceId ? (
              <Button
                variant="outline"
                size="sm"
                className="text-success hover:text-success"
                nativeButton={false}
                render={<Link href={`/dashboard/invoices/${convertedToInvoiceId}`} />}
              >
                <CheckCircle2 className="h-4 w-4" />
                View Invoice
              </Button>
            ) : (
              <Button
                variant="outline"
                size="sm"
                onClick={handleConvert}
                disabled={converting}
              >
                {converting ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <ArrowRightLeft className="h-4 w-4" />
                )}
                Convert to Invoice
              </Button>
            ))}
          <Button variant="outline" size="sm" onClick={() => window.print()}>
            <Printer className="h-4 w-4" />
            Print
          </Button>
          <ShareDocumentButton
            document={doc}
            business={business}
            logoPath={logoPath}
            priorDraws={priorDraws}
          />
          <Button
            variant="outline"
            size="sm"
            onClick={handleDelete}
            disabled={deleting}
            className="text-destructive hover:text-destructive"
          >
            {deleting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Trash2 className="h-4 w-4" />
            )}
            Delete
          </Button>
        </div>
      </div>

      {convertedToInvoiceId && (
        <div className="mb-4 flex items-center gap-2 rounded-lg bg-success/10 p-3 text-sm text-success print:hidden">
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          This estimate was converted to{" "}
          <Link
            href={`/dashboard/invoices/${convertedToInvoiceId}`}
            className="font-medium underline underline-offset-2"
          >
            an invoice
          </Link>
          .
        </div>
      )}

      <Card className="print:border-none print:shadow-none">
        <CardContent className="relative space-y-6 p-6 print:p-0">
          {/* Same stamp graphic as the downloaded PDF (see PaidStamp's own
              comment) - not print:hidden like the plain status badge below,
              since this one is meant to look like it's actually on the
              page, on screen or printed, matching the PDF either way. */}
          {doc.status === "paid" && (
            <PaidStamp className="pointer-events-none absolute top-2 right-2 h-20 w-20 sm:h-28 sm:w-28" />
          )}

          {logoPath && (
            <LogoImage
              key={logoPath}
              path={logoPath}
              className="h-20 max-w-[260px] object-contain object-left"
            />
          )}

          <div className="flex items-start justify-between">
            <div>
              <p className="text-2xl font-bold uppercase tracking-tight">
                {label}
              </p>
              <p className="text-sm text-muted-foreground">{shortId}</p>
            </div>
            {doc.status !== "paid" && (
              <Badge className="print:hidden">{doc.status}</Badge>
            )}
          </div>

          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <p className="text-xs text-muted-foreground uppercase">From</p>
              <p className="font-medium">{business.name ?? business.email}</p>
              {business.name && <p>{business.email}</p>}
              {business.phone && <p>{business.phone}</p>}
              {business.address && <p>{business.address}</p>}
            </div>
            <div>
              <p className="text-xs text-muted-foreground uppercase">Bill To</p>
              <p className="font-medium">{doc.client?.name ?? "—"}</p>
              {doc.client?.email && <p>{doc.client.email}</p>}
              {doc.client?.address && <p>{doc.client.address}</p>}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <p className="text-xs text-muted-foreground uppercase">
                Issue date
              </p>
              <p>{formatDate(doc.issue_date)}</p>
            </div>
            {doc.due_date && (
              <div>
                <p className="text-xs text-muted-foreground uppercase">
                  Due date
                </p>
                <p>{formatDate(doc.due_date)}</p>
              </div>
            )}
          </div>

          <Separator />

          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted-foreground uppercase">
                <th className="pb-2">Description</th>
                <th className="pb-2 text-right">Qty</th>
                <th className="pb-2 text-right">Unit Price</th>
                <th className="pb-2 text-right">Amount</th>
              </tr>
            </thead>
            <tbody>
              {doc.items.map((item) => (
                <tr key={item.id} className="border-t">
                  <td className="py-2">{item.description}</td>
                  <td className="py-2 text-right tabular-nums">{item.quantity}</td>
                  <td className="py-2 text-right tabular-nums">
                    {formatCurrency(item.unit_price)}
                  </td>
                  <td className="py-2 text-right tabular-nums">
                    {formatCurrency(item.quantity * item.unit_price)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <Separator />

          <div className="ml-auto max-w-xs space-y-1 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Subtotal</span>
              <span className="tabular-nums">{formatCurrency(doc.subtotal)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">HST (13%)</span>
              <span className="tabular-nums">
                {formatCurrency(doc.hst_amount)}
              </span>
            </div>
            <div className="flex items-center justify-between text-base font-semibold">
              <span>Total</span>
              <span className="tabular-nums">
                {formatCurrency(doc.total_amount)}
              </span>
            </div>
            {doc.type === "invoice" && paidToDate > 0 && (
              <>
                <div className="flex items-center justify-between text-success">
                  <span>Paid to date</span>
                  <span className="tabular-nums">
                    {formatCurrency(paidToDate)}
                  </span>
                </div>
                <div className="flex items-center justify-between text-base font-semibold">
                  <span>Balance due</span>
                  <span className="tabular-nums">
                    {formatCurrency(Math.max(balanceDue, 0))}
                  </span>
                </div>
              </>
            )}
          </div>

          {doc.is_progress_draw && (
            <>
              <Separator />
              <div className="space-y-2 text-sm">
                <p className="font-heading font-semibold">Progress Billing Summary</p>
                <div className="grid max-w-xs gap-1">
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Original Contract Value</span>
                    <span className="tabular-nums">{formatCurrency(contractValue)}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Previous Billed</span>
                    <span className="tabular-nums">{formatCurrency(previousBilled)}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">This Invoice</span>
                    <span className="tabular-nums">{formatCurrency(doc.subtotal)}</span>
                  </div>
                  <div className="flex items-center justify-between font-semibold">
                    <span>Total Billed to Date</span>
                    <span className="tabular-nums">{formatCurrency(totalBilledToDate)}</span>
                  </div>
                  <div className="flex items-center justify-between font-semibold">
                    <span>Remaining Balance</span>
                    <span className="tabular-nums">{formatCurrency(remainingBalance)}</span>
                  </div>
                </div>
                {doc.draw_percent_complete !== null && (
                  <p>Progress: {doc.draw_percent_complete}% complete</p>
                )}
                {doc.draw_description && (
                  <div>
                    <p className="text-xs text-muted-foreground uppercase">
                      Work completed for this draw
                    </p>
                    <p>{doc.draw_description}</p>
                  </div>
                )}
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {doc.type === "invoice" && (
        <Card className="mt-4 print:hidden">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <DollarSign className="h-4 w-4 text-success" />
              Payment History
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {doc.payments.length > 0 && (
              <div className="space-y-2">
                {[...doc.payments]
                  .sort((a, b) => (a.paid_date < b.paid_date ? 1 : -1))
                  .map((payment: Payment) => (
                    <div
                      key={payment.id}
                      className={`flex items-center justify-between gap-2 rounded-lg border p-2.5 text-sm ${
                        editingPaymentId === payment.id ? "border-primary bg-primary/5" : ""
                      }`}
                    >
                      <div className="min-w-0">
                        <p className="font-medium tabular-nums">
                          {formatCurrency(payment.amount)}
                        </p>
                        <p className="truncate text-xs text-muted-foreground">
                          {formatDate(payment.paid_date)}
                          {payment.method && ` · ${payment.method}`}
                          {payment.note && ` · ${payment.note}`}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          onClick={() => startEditPayment(payment)}
                          disabled={deletingPaymentId === payment.id}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-destructive hover:text-destructive"
                          onClick={() => handleDeletePayment(payment.id)}
                          disabled={deletingPaymentId === payment.id}
                        >
                          {deletingPaymentId === payment.id ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Trash2 className="h-4 w-4" />
                          )}
                        </Button>
                      </div>
                    </div>
                  ))}
              </div>
            )}

            <Separator />

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <Label htmlFor="payment-amount">
                    {paymentMode === "percent" ? "Amount (%)" : "Amount ($)"}
                  </Label>
                  <Tabs
                    value={paymentMode}
                    onValueChange={(v) => v && setPaymentMode(v as "dollar" | "percent")}
                  >
                    <TabsList className="h-6 p-[2px]">
                      <TabsTrigger value="dollar" className="h-5 px-2 text-xs">
                        $
                      </TabsTrigger>
                      <TabsTrigger value="percent" className="h-5 px-2 text-xs">
                        %
                      </TabsTrigger>
                    </TabsList>
                  </Tabs>
                </div>
                {paymentMode === "percent" ? (
                  <>
                    <NumberInput
                      id="payment-amount"
                      step="0.1"
                      value={paymentPercent}
                      onValueChange={setPaymentPercent}
                    />
                    <p className="text-xs text-muted-foreground tabular-nums">
                      = {formatCurrency(paymentAmountFromPercent)} of{" "}
                      {formatCurrency(doc.total_amount)}
                    </p>
                  </>
                ) : (
                  <NumberInput
                    id="payment-amount"
                    step="0.01"
                    value={paymentAmount}
                    onValueChange={setPaymentAmount}
                  />
                )}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="payment-date">Date</Label>
                <Input
                  id="payment-date"
                  type="date"
                  value={paymentDate}
                  onChange={(e) => setPaymentDate(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="payment-method">Method (optional)</Label>
                <Input
                  id="payment-method"
                  placeholder="e.g. E-transfer"
                  value={paymentMethod}
                  onChange={(e) => setPaymentMethod(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="payment-note">Note (optional)</Label>
                <Input
                  id="payment-note"
                  placeholder="e.g. Deposit"
                  value={paymentNote}
                  onChange={(e) => setPaymentNote(e.target.value)}
                />
              </div>
            </div>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={handleSavePayment}
                disabled={addingPayment}
              >
                {addingPayment && <Loader2 className="h-4 w-4 animate-spin" />}
                {editingPaymentId ? "Update Payment" : "Record Payment"}
              </Button>
              {editingPaymentId && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={cancelEditPayment}
                  disabled={addingPayment}
                >
                  Cancel
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      <DocumentBuilder
        open={editorOpen}
        onOpenChange={setEditorOpen}
        defaultType={doc.type}
        document={doc}
        clients={allClients}
        jobs={jobs}
        savedLineItems={lineItems}
        onSaved={(updated) => setDoc(updated)}
        onClientCreated={(client) => setAllClients((prev) => [...prev, client])}
      />
    </div>
  );
}
