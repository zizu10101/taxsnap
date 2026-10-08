"use client";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { PaymentForm, type PaymentFormDocument, type UpdatedDocument } from "@/components/invoices/payment-form";
import { balanceDue, COLLECT_BALANCE_LABEL } from "@/lib/payment-form";

function formatCurrency(amount: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(amount);
}

// "Collect remaining balance" from the Invoices preview panel, so a payment doesn't need a trip to
// "View full details". It is the SAME PaymentForm the invoice page uses (not a second form),
// opened with the whole unpaid balance already in the amount box (still editable, for a partial
// payment) - the same prefill as the invoice page's button. The form saves, toasts and calls router.refresh() itself; this dialog just
// hands the updated document to the preview (so paid amount, balance and status change on
// screen at once) and closes.
export function RecordPaymentDialog({
  open,
  onOpenChange,
  document: doc,
  documentLabel,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  document: PaymentFormDocument;
  /** e.g. "INV-1004" */
  documentLabel: string;
  onSaved: (updated: UpdatedDocument) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{COLLECT_BALANCE_LABEL}</DialogTitle>
          <DialogDescription>
            {documentLabel} · Balance due {formatCurrency(balanceDue(doc))}
          </DialogDescription>
        </DialogHeader>
        {/* Mounted only while open, so every opening starts from the current balance. */}
        <PaymentForm
          document={doc}
          prefillBalance
          showBalanceBar={false}
          idPrefix="preview-payment"
          onSaved={(updated) => {
            onSaved(updated);
            onOpenChange(false);
          }}
        />
      </DialogContent>
    </Dialog>
  );
}
