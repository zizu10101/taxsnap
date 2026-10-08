"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { DollarSign, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NumberInput } from "@/components/ui/number-input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { BankAccountSelect } from "@/components/invoices/bank-account-select";
import { isFuturePaymentDate, localIsoDate } from "@/lib/payment-date";
import {
  balanceDue,
  checkPaymentAmount,
  percentToAmount,
  prefillBalanceAmount,
  canRecordPayment,
  COLLECT_BALANCE_LABEL,
} from "@/lib/payment-form";
import type { DocumentWithRelations, Payment } from "@/lib/database.types";

function formatCurrency(amount: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(amount);
}

function formatDate(dateStr: string) {
  return new Date(`${dateStr}T00:00:00`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/** What PaymentForm needs to know about the invoice. */
export interface PaymentFormDocument {
  id: string;
  type: string;
  total_amount: number;
  payments: Payment[];
}

/** The payments API's answer: the document without its line items. */
export type UpdatedDocument = Omit<DocumentWithRelations, "items">;

// The ONE payment form: add a payment, edit one, or "Collect remaining balance". Used inline on
// the invoice detail page and inside the "Record payment" dialog on the Invoices preview panel,
// so amount ($ or %), date, method, "deposited to", note, the overpayment check, the future-date
// warning and the local-date default exist in exactly one place.
//
// It saves by itself (POST / PATCH /api/documents/[id]/payments), toasts, calls
// router.refresh() so every list and page that shows this invoice re-reads it, and hands the
// updated document to onSaved so the caller can update what is on screen immediately.
export function PaymentForm({
  document: doc,
  editingPayment = null,
  onCancelEdit,
  onSaved,
  prefillBalance = false,
  showBalanceBar = true,
  idPrefix = "payment",
}: {
  document: PaymentFormDocument;
  /** A payment being edited (null = adding a new one). Controlled by the caller. */
  editingPayment?: Payment | null;
  onCancelEdit?: () => void;
  onSaved: (updated: UpdatedDocument) => void;
  /** Start with the whole unpaid balance in the amount box (the dialog does). */
  prefillBalance?: boolean;
  /** The "Balance due $X [Collect remaining balance]" row above the fields. */
  showBalanceBar?: boolean;
  idPrefix?: string;
}) {
  const router = useRouter();

  const [mode, setMode] = useState<"dollar" | "percent">("dollar");
  const [amount, setAmount] = useState(prefillBalance ? prefillBalanceAmount(doc) : 0);
  // The % box is its own field, not a live conversion of the $ box: switching modes enters
  // the other one blank. Its basis is this document's total_amount.
  const [percent, setPercent] = useState(0);
  // Local calendar date, not UTC (UTC is "tomorrow" in the evening in Ontario).
  const [date, setDate] = useState(() => localIsoDate());
  const [method, setMethod] = useState("");
  const [note, setNote] = useState("");
  // "" = not specified. Optional on every payment.
  const [bankAccountId, setBankAccountId] = useState("");
  const [saving, setSaving] = useState(false);
  // Set after Save on a future date: an inline "Record anyway?" step (not a second modal, so it
  // also works inside the dialog).
  const [confirmFuture, setConfirmFuture] = useState(false);

  function resetFields() {
    setMode("dollar");
    setAmount(0);
    setPercent(0);
    setDate(localIsoDate());
    setMethod("");
    setNote("");
    setBankAccountId("");
    setConfirmFuture(false);
  }

  // Follow the payment the caller selected for editing (render-time "adjust state from props",
  // not an effect): load its values when one is picked, blank the form when it is cleared.
  const editingId = editingPayment?.id ?? null;
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  if (editingId !== loadedFor) {
    setLoadedFor(editingId);
    if (editingPayment) {
      setMode("dollar");
      setAmount(editingPayment.amount);
      setPercent(0);
      setDate(editingPayment.paid_date);
      setMethod(editingPayment.method ?? "");
      setNote(editingPayment.note ?? "");
      setBankAccountId(editingPayment.bank_account_id ?? "");
      setConfirmFuture(false);
    } else {
      resetFields();
    }
  }

  const isEditing = editingPayment !== null;
  const balance = balanceDue(doc);
  // While editing, that payment's own amount isn't "already paid" against the new value.
  const effectiveBalance = balance + (editingPayment?.amount ?? 0);
  const amountFromPercent = percentToAmount(percent, doc.total_amount);
  const futureDate = isFuturePaymentDate(date);

  // "Collect remaining balance": dollars mode, today, the whole unpaid balance.
  function collectRemainingBalance() {
    setMode("dollar");
    setAmount(prefillBalanceAmount(doc));
    setPercent(0);
    setDate(localIsoDate());
    setConfirmFuture(false);
    const el = window.document.getElementById(`${idPrefix}-amount`);
    el?.scrollIntoView({ block: "center", behavior: "smooth" });
    el?.focus({ preventScroll: true });
  }

  async function save(futureConfirmed = false) {
    // Instant feedback before the round trip - the server enforces this too (authoritative:
    // it catches a stale balance or a direct API call).
    const check = checkPaymentAmount({
      mode,
      amount,
      percent,
      total: doc.total_amount,
      effectiveBalance,
    });
    if (check.error) {
      toast.error(check.error);
      return;
    }
    // A date after today is usually a typo (and would count as revenue in a period that hasn't
    // happened). Warn, but allow it: post-dated payments are real.
    if (!futureConfirmed && futureDate) {
      setConfirmFuture(true);
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(
        isEditing
          ? `/api/documents/${doc.id}/payments/${editingPayment!.id}`
          : `/api/documents/${doc.id}/payments`,
        {
          method: isEditing ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            amount: check.amount,
            paid_date: date,
            method,
            note,
            bank_account_id: bankAccountId,
          }),
        },
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Failed to ${isEditing ? "update" : "record"} payment`);
      resetFields();
      toast.success(isEditing ? "Payment updated" : "Payment recorded");
      onSaved(data.document as UpdatedDocument);
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      {showBalanceBar && canRecordPayment({ ...doc }) && !isEditing && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-muted/50 p-2.5 text-sm">
          <span>
            Balance due <span className="font-semibold tabular-nums">{formatCurrency(balance)}</span>
          </span>
          <Button type="button" size="sm" onClick={collectRemainingBalance}>
            <DollarSign className="h-4 w-4" />
            {COLLECT_BALANCE_LABEL}
          </Button>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <Label htmlFor={`${idPrefix}-amount`}>{mode === "percent" ? "Amount (%)" : "Amount ($)"}</Label>
            <Tabs value={mode} onValueChange={(v) => v && setMode(v as "dollar" | "percent")}>
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
          {mode === "percent" ? (
            <>
              <NumberInput id={`${idPrefix}-amount`} step="0.1" value={percent} onValueChange={setPercent} />
              <p className="text-xs text-muted-foreground tabular-nums">
                = {formatCurrency(amountFromPercent)} of {formatCurrency(doc.total_amount)}
              </p>
            </>
          ) : (
            <NumberInput id={`${idPrefix}-amount`} step="0.01" value={amount} onValueChange={setAmount} />
          )}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`${idPrefix}-date`}>Date</Label>
          <Input
            id={`${idPrefix}-date`}
            type="date"
            value={date}
            onChange={(e) => {
              setDate(e.target.value);
              setConfirmFuture(false);
            }}
          />
          {futureDate && (
            <p className="text-xs text-warning" role="status">
              This date is in the future. Check the year and month.
            </p>
          )}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`${idPrefix}-method`}>Method (optional)</Label>
          <Input
            id={`${idPrefix}-method`}
            placeholder="e.g. E-transfer"
            value={method}
            onChange={(e) => setMethod(e.target.value)}
          />
        </div>
        <BankAccountSelect id={`${idPrefix}-bank-account`} value={bankAccountId} onChange={setBankAccountId} />
        <div className="space-y-1.5">
          <Label htmlFor={`${idPrefix}-note`}>Note (optional)</Label>
          <Input
            id={`${idPrefix}-note`}
            placeholder="e.g. Deposit"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </div>
      </div>

      {confirmFuture && (
        <div className="space-y-2 rounded-lg border border-warning/40 bg-warning/10 p-2.5 text-sm" role="alert">
          <p>
            This payment is dated <span className="font-medium">{formatDate(date)}</span>, which is after today.
            It will count as revenue in that period, not this one.
          </p>
          <div className="flex gap-2">
            <Button size="sm" onClick={() => save(true)} disabled={saving}>
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              Record anyway
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirmFuture(false)} disabled={saving}>
              Change date
            </Button>
          </div>
        </div>
      )}

      <div className="flex gap-2">
        <Button size="sm" variant="outline" onClick={() => save()} disabled={saving || confirmFuture}>
          {saving && !confirmFuture && <Loader2 className="h-4 w-4 animate-spin" />}
          {isEditing ? "Update Payment" : "Record Payment"}
        </Button>
        {isEditing && (
          <Button size="sm" variant="ghost" onClick={onCancelEdit} disabled={saving}>
            Cancel
          </Button>
        )}
      </div>
    </div>
  );
}
