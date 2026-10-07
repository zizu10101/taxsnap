"use client";

import { useEffect, useMemo, useState } from "react";
import { ImageOff, Loader2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { DateRangeFilter } from "@/components/dashboard/date-range-filter";
import { isCalculated, TAX_BASIS_LABELS, taxBasis } from "@/lib/tax-codes";
import { ReceiptFile } from "@/components/dashboard/receipt-file";
import { formatCurrency, formatDate } from "@/components/accountant-portal/format";
import { getPresetRange, filterByRange, type DateRange, type RangePreset } from "@/lib/date-range";
import { NOT_SPECIFIED } from "@/lib/account-spending";
import type { Receipt } from "@/lib/database.types";

const ALL = "all";

// Every receipt/expense, read-only. Filters are client-side over the full list
// the server already loaded (same approach as the owner's receipts page).
export function AccountantExpensesView({
  receipts,
  accounts,
}: {
  receipts: Receipt[];
  accounts: { id: string; name: string }[];
}) {
  const [preset, setPreset] = useState<RangePreset>("this-year");
  const [range, setRange] = useState<DateRange>(() => getPresetRange("this-year"));
  const [category, setCategory] = useState(ALL);
  const [account, setAccount] = useState(ALL);
  const [selected, setSelected] = useState<Receipt | null>(null);

  const accountNames = useMemo(() => new Map(accounts.map((a) => [a.id, a.name])), [accounts]);

  const categories = useMemo(
    () => [...new Set(receipts.map((r) => r.tax_category))].sort((a, b) => a.localeCompare(b)),
    [receipts],
  );
  const categoryItems = useMemo(
    () => ({ [ALL]: "All categories", ...Object.fromEntries(categories.map((c) => [c, c])) }),
    [categories],
  );
  const accountItems = useMemo(
    () => ({
      [ALL]: "All accounts",
      [NOT_SPECIFIED]: "Not specified",
      ...Object.fromEntries(accounts.map((a) => [a.id, a.name])),
    }),
    [accounts],
  );

  const visible = useMemo(() => {
    return filterByRange(receipts, range, "transaction_date").filter((r) => {
      if (category !== ALL && r.tax_category !== category) return false;
      if (account === NOT_SPECIFIED) return !r.paid_with_account_id;
      if (account !== ALL) return r.paid_with_account_id === account;
      return true;
    });
  }, [receipts, range, category, account]);

  const totals = useMemo(
    () =>
      visible.reduce(
        (sum, r) => ({ total: sum.total + r.total_amount, tax: sum.tax + r.tax_amount }),
        { total: 0, tax: 0 },
      ),
    [visible],
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
        <DateRangeFilter
          preset={preset}
          range={range}
          onChange={(nextPreset, nextRange) => {
            setPreset(nextPreset);
            setRange(nextRange);
          }}
        />
        <Select items={categoryItems} value={category} onValueChange={(v) => setCategory(v ?? ALL)}>
          <SelectTrigger className="w-full lg:w-56" aria-label="Category">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All categories</SelectItem>
            {categories.map((c) => (
              <SelectItem key={c} value={c}>
                {c}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select items={accountItems} value={account} onValueChange={(v) => setAccount(v ?? ALL)}>
          <SelectTrigger className="w-full lg:w-56" aria-label="Paid with">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All accounts</SelectItem>
            <SelectItem value={NOT_SPECIFIED}>Not specified</SelectItem>
            {accounts.map((a) => (
              <SelectItem key={a.id} value={a.id}>
                {a.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 text-sm text-muted-foreground">
        <span>
          {visible.length} expense{visible.length === 1 ? "" : "s"}
        </span>
        <span>
          Total{" "}
          <span className="font-medium text-foreground tabular-nums">
            {formatCurrency(totals.total)}
          </span>
          {" · "}HST/tax{" "}
          <span className="font-medium text-foreground tabular-nums">
            {formatCurrency(totals.tax)}
          </span>
        </span>
      </div>

      <Card>
        <CardContent className="overflow-x-auto p-0">
          {visible.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              No expenses match these filters.
            </p>
          ) : (
            <table className="w-full min-w-[40rem] text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th className="px-3 py-2 font-medium">Date</th>
                  <th className="px-3 py-2 font-medium">Merchant</th>
                  <th className="px-3 py-2 font-medium">Category</th>
                  <th className="px-3 py-2 font-medium">Job</th>
                  <th className="px-3 py-2 font-medium">Paid with</th>
                  <th className="px-3 py-2 text-right font-medium">Tax</th>
                  <th className="px-3 py-2 text-right font-medium">Total</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((r) => (
                  <tr key={r.id} className="border-b last:border-0 hover:bg-muted/40">
                    <td className="whitespace-nowrap px-3 py-2">
                      <button
                        type="button"
                        onClick={() => setSelected(r)}
                        className="text-left font-medium text-primary underline-offset-4 hover:underline"
                      >
                        {formatDate(r.transaction_date)}
                      </button>
                    </td>
                    <td className="px-3 py-2">{r.merchant_name}</td>
                    <td className="px-3 py-2">{r.tax_category}</td>
                    <td className="px-3 py-2 text-muted-foreground">{r.job_name ?? "—"}</td>
                    <td className="px-3 py-2 text-muted-foreground">
                      {r.paid_with_account_id
                        ? (accountNames.get(r.paid_with_account_id) ?? "—")
                        : "—"}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {formatCurrency(r.tax_amount)}
                      {isCalculated(r) && (
                        <span className="ml-1 text-[10px] text-muted-foreground">calc.</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right font-medium tabular-nums">
                      {formatCurrency(r.total_amount)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      <Dialog open={selected !== null} onOpenChange={(open) => !open && setSelected(null)}>
        <DialogContent>
          {selected && (
            <ReceiptDetail
              key={selected.id}
              receipt={selected}
              paidWith={
                selected.paid_with_account_id
                  ? (accountNames.get(selected.paid_with_account_id) ?? null)
                  : null
              }
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

type PhotoState = { status: "loading" } | { status: "ready"; url: string } | { status: "none" };

// Keyed by receipt id by the caller, so each receipt remounts and fetches its
// own fresh signed URL (same pattern as the owner's ReceiptImage).
function ReceiptDetail({ receipt, paidWith }: { receipt: Receipt; paidWith: string | null }) {
  const [photo, setPhoto] = useState<PhotoState>(
    receipt.image_url ? { status: "loading" } : { status: "none" },
  );

  // setState only happens inside the fetch callbacks, never synchronously in the
  // effect body (react-hooks/set-state-in-effect); the caller keys this component
  // by receipt id, so there is nothing to reset between receipts.
  useEffect(() => {
    if (!receipt.image_url) return;
    let cancelled = false;
    fetch(`/api/accountant-portal/receipts/${receipt.id}/image`)
      .then((res) => (res.ok ? res.json() : Promise.reject()))
      .then((json: { url: string }) => {
        if (!cancelled) setPhoto({ status: "ready", url: json.url });
      })
      .catch(() => {
        if (!cancelled) setPhoto({ status: "none" });
      });
    return () => {
      cancelled = true;
    };
  }, [receipt.id, receipt.image_url]);

  return (
    <>
      <DialogHeader>
        <DialogTitle>{receipt.merchant_name}</DialogTitle>
        <DialogDescription>
          {formatDate(receipt.transaction_date)} · {receipt.tax_category}
        </DialogDescription>
      </DialogHeader>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
        <dt className="text-muted-foreground">Total</dt>
        <dd className="text-right font-medium tabular-nums">{formatCurrency(receipt.total_amount)}</dd>
        <dt className="text-muted-foreground">HST/tax</dt>
        <dd className="text-right tabular-nums">
          {formatCurrency(receipt.tax_amount)}
          <span className="block text-[11px] text-muted-foreground">{TAX_BASIS_LABELS[taxBasis(receipt)]}</span>
        </dd>
        <dt className="text-muted-foreground">Job</dt>
        <dd className="text-right">{receipt.job_name ?? "—"}</dd>
        <dt className="text-muted-foreground">Paid with</dt>
        <dd className="text-right">{paidWith ?? "—"}</dd>
      </dl>

      {receipt.items && receipt.items.length > 0 && (
        <div className="space-y-1 text-sm">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Items</p>
          {receipt.items.map((item, i) => (
            <div key={i} className="flex justify-between gap-3">
              <span className="min-w-0 truncate">{item.name}</span>
              <span className="tabular-nums">{formatCurrency(item.amount)}</span>
            </div>
          ))}
        </div>
      )}

      <div className="min-h-24">
        {photo.status === "loading" && (
          <div className="flex justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        )}
        {photo.status === "ready" && receipt.image_url && (
          // A photo or a PDF: ReceiptFile tells which and shows it either way.
          <ReceiptFile
            url={photo.url}
            path={receipt.image_url}
            className="flex items-center justify-center"
            imgClassName="max-h-96 w-full rounded-md border object-contain"
          />
        )}
        {photo.status === "none" && (
          <div className="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground">
            <ImageOff className="h-4 w-4" />
            {receipt.image_url ? "Couldn't load the original receipt." : "No receipt file for this expense."}
          </div>
        )}
      </div>
    </>
  );
}
