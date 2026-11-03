"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { formatMoney } from "@/lib/statement-format";
import { invoiceDetailHref } from "@/lib/invoice-back";
import { UNPAID_INVOICES_HREF, type DepositHint } from "@/lib/statement-invoice-hints";

// Display and links only: nothing here records a payment. "Record payment" opens the invoice's own page, where the one
// payment form lives (it can not be opened prefilled from here: the invoice page reads no amount or date from its link).

export function DepositsBanner({ text }: { text: string }) {
  return (
    <p className="mt-2 rounded-md border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
      {text}{" "}
      <Link href={UNPAID_INVOICES_HREF} className="text-primary underline underline-offset-2">
        See your invoices
      </Link>
    </p>
  );
}

export function DepositHintNote({ hint }: { hint: DepositHint }) {
  if (hint.kind === "many") {
    return (
      <p className="mt-1 text-xs text-muted-foreground">
        {hint.count} unpaid invoices match this amount.{" "}
        <Link href={UNPAID_INVOICES_HREF} className="text-primary underline underline-offset-2">
          See your invoices
        </Link>
      </p>
    );
  }
  const { invoice } = hint;
  return (
    <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
      <span>
        Matches unpaid invoice {invoice.number}, {invoice.client_name}, {formatMoney(invoice.balance_due)}
      </span>
      <Button size="sm" variant="outline" nativeButton={false} render={<Link href={invoiceDetailHref(invoice.id)} />}>
        Record payment
      </Button>
    </div>
  );
}
