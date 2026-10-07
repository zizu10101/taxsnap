"use client";

import { useMemo, useState } from "react";
import { Check, Link2, Pencil, Undo2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NumberInput } from "@/components/ui/number-input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
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
import { useBankAccounts } from "@/components/owner-lists-provider";
import { accountDisplayName, paidWithAccounts } from "@/lib/accounts";
import { LINE_KINDS } from "@/lib/statement-lines";
import { cleanMerchantName } from "@/lib/merchant-name";
import { lineTax } from "@/lib/statement-tax";
import {
  buildCategoryDefaults,
  codeFromRow,
  codeKeyOf,
  TAX_CODE_KEYS,
  TAX_CODE_LABELS,
  type TaxSource,
} from "@/lib/tax-codes";
import type { ReviewGroup } from "@/lib/statement-review-model";
import type { ReviewLineData } from "@/lib/statement-review-data";
import type { StatementLineKind } from "@/lib/database.types";

export type PatchFn = (ids: string[], patch: Record<string, unknown>) => Promise<boolean>;

export function formatMoney(amount: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(amount);
}

export function formatDay(dateStr: string) {
  return new Date(`${dateStr}T00:00:00`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

const KIND_LABELS: Record<StatementLineKind, string> = {
  purchase: "Purchase",
  payment: "Payment to the card",
  refund: "Refund / credit",
  fee: "Fee",
  interest: "Interest",
  other: "Other",
};

const PLACEHOLDER = "__choose__";
const AUTO = "__auto__";

// Why a calculated tax is what it is, in the owner's words.
const SOURCE_COPY: Record<TaxSource, string> = {
  line: "your choice",
  rule: "your vendor rule",
  foreign_currency: "foreign currency, no tax assumed",
  category: "this category's default",
  kind: "fees and interest carry no tax",
};

export function LineRow({
  line,
  group,
  categories,
  cardId,
  bankChargesCategory,
  disabled,
  onPatch,
}: {
  line: ReviewLineData;
  group: ReviewGroup;
  categories: string[];
  cardId: string;
  bankChargesCategory: string | null;
  disabled: boolean;
  onPatch: PatchFn;
}) {
  const accounts = useBankAccounts();
  const [editing, setEditing] = useState(false);
  const [showMatches, setShowMatches] = useState(group === "possible_matches");
  const [hst, setHst] = useState(Math.abs(line.tax_amount));

  const categoryItems = useMemo(() => {
    const map: Record<string, string> = { [PLACEHOLDER]: "Choose a category" };
    for (const c of categories) map[c] = c;
    return map;
  }, [categories]);

  const paidWithValue = line.paid_with_account_id ?? cardId;
  const paidOptions = useMemo(() => paidWithAccounts(accounts, paidWithValue), [accounts, paidWithValue]);
  const paidItems = useMemo(() => {
    const map: Record<string, string> = {};
    for (const a of paidOptions) map[a.id] = accountDisplayName(a, { withType: true });
    return map;
  }, [paidOptions]);

  // What this line would be saved with, tax-wise: the owner's pick, else a clear default, else
  // nothing (it needs a tax code). Derived here the same way the commit step derives it.
  const tax = useMemo(
    () => lineTax(line, buildCategoryDefaults({ bankChargesName: bankChargesCategory })),
    [line, bankChargesCategory],
  );
  const taxItems = useMemo(() => {
    const map: Record<string, string> = { [AUTO]: "Automatic" };
    for (const k of TAX_CODE_KEYS) map[k] = TAX_CODE_LABELS[k];
    return map;
  }, []);
  const pickedCode = line.tax_source === "line" ? codeKeyOf(codeFromRow(line)) : null;

  const id = line.id;
  const categoryValue = line.category ?? line.suggested_category ?? PLACEHOLDER;
  const isSuggestion = !line.category_confirmed && !!(line.category ?? line.suggested_category);
  const isExpenseGroup = group === "new" || group === "bank_charges" || group === "refunds";
  // The merchant name the expense will be saved under (the line keeps the original).
  const savedAs = cleanMerchantName(line.description);

  return (
    <li className="border-b py-3 last:border-b-0">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{line.description}</p>
          <p className="text-xs text-muted-foreground">
            {formatDay(line.txn_date)} · page {line.page}
            {line.original_amount !== null && line.original_currency && (
              <span>
                {" "}
                · {line.original_amount.toFixed(2)} {line.original_currency}
              </span>
            )}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span
            className={`font-semibold tabular-nums ${line.amount < 0 ? "text-success" : ""}`}
          >
            {formatMoney(line.amount)}
          </span>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-muted-foreground"
            aria-label="Edit line"
            disabled={disabled}
            onClick={() => setEditing(true)}
          >
            <Pencil className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {/* Already imported: shown, never silently dropped. */}
      {group === "already_imported" && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Badge variant="secondary">Already imported</Badge>
          <span className="text-xs text-muted-foreground">
            Skipped, because an earlier statement already saved this charge.
          </span>
          <Button
            size="sm"
            variant="outline"
            disabled={disabled}
            onClick={() => onPatch([id], { duplicate_override: true })}
          >
            Import anyway
          </Button>
        </div>
      )}

      {group === "matched" && (
        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
          <Badge variant="secondary">
            <Link2 /> Matched
          </Badge>
          <span className="text-muted-foreground">
            {line.matched_receipt
              ? `${line.matched_receipt.merchant_name} · ${formatDay(line.matched_receipt.transaction_date)} · ${formatMoney(line.matched_receipt.total_amount)}`
              : "Receipt"}
          </span>
          <Button
            size="sm"
            variant="ghost"
            disabled={disabled}
            onClick={() => onPatch([id], { resolution: null })}
          >
            <Undo2 className="h-3.5 w-3.5" />
            Unmatch
          </Button>
        </div>
      )}

      {group === "excluded" && (
        <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
          <span>Excluded - not saved.</span>
          <Button size="sm" variant="ghost" disabled={disabled} onClick={() => onPatch([id], { resolution: null })}>
            <Undo2 className="h-3.5 w-3.5" />
            Include
          </Button>
        </div>
      )}

      {group === "payments" && (
        <p className="mt-1 text-xs text-muted-foreground">
          A payment to the card, not an expense - ignored. Use the pencil if this was misread.
        </p>
      )}

      {/* Candidate receipts: a tie or near match is always the user's call. */}
      {line.candidates.length > 0 && group !== "matched" && group !== "already_imported" && (
        <div className="mt-2 space-y-1.5">
          {!showMatches ? (
            <Button size="sm" variant="ghost" onClick={() => setShowMatches(true)}>
              <Link2 className="h-3.5 w-3.5" />
              Match to a receipt instead ({line.candidates.length})
            </Button>
          ) : (
            <>
              <p className="text-xs text-muted-foreground">
                {group === "possible_matches"
                  ? "This looks like a receipt you already scanned. Pick the right one:"
                  : "Receipts that could be this charge:"}
              </p>
              {line.candidates.map((c) => (
                <div
                  key={c.id}
                  className="flex items-center justify-between gap-2 rounded-md border px-2.5 py-1.5 text-xs"
                >
                  <span className="min-w-0 truncate">
                    {c.receipt?.merchant_name ?? "Receipt"} ·{" "}
                    {c.receipt ? formatDay(c.receipt.transaction_date) : ""} ·{" "}
                    {c.receipt ? formatMoney(c.receipt.total_amount) : ""}
                    <span className="ml-1.5 text-muted-foreground">
                      {c.kind === "exact" ? "same amount" : "close, not exact"}
                    </span>
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={disabled}
                    onClick={() => onPatch([id], { matched_receipt_id: c.id })}
                  >
                    Match
                  </Button>
                </div>
              ))}
              {group === "possible_matches" && (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={disabled}
                  onClick={() => onPatch([id], { resolution: "new_expense" })}
                >
                  None of these - save as a new expense
                </Button>
              )}
            </>
          )}
        </div>
      )}

      {isExpenseGroup && (
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <Label className="text-xs text-muted-foreground">Category</Label>
              {isSuggestion && <Badge variant="outline">Suggested</Badge>}
            </div>
            <div className="flex items-center gap-1.5">
              <Select
                items={categoryItems}
                value={categoryValue}
                onValueChange={(v) => v && v !== PLACEHOLDER && onPatch([id], { category: v })}
              >
                <SelectTrigger className="w-full" disabled={disabled}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {categories.map((c) => (
                    <SelectItem key={c} value={c}>
                      {c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {isSuggestion && line.suggested_category && !line.category && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={disabled}
                  onClick={() => onPatch([id], { accept_suggestion: true })}
                >
                  <Check className="h-3.5 w-3.5" />
                  Accept
                </Button>
              )}
            </div>
          </div>

          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Paid with</Label>
            <Select
              items={paidItems}
              value={paidWithValue}
              onValueChange={(v) => v && onPatch([id], { paid_with_account_id: v })}
            >
              <SelectTrigger className="w-full" disabled={disabled}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {paidOptions.map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    {paidItems[a.id]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1 sm:col-span-2">
            <div className="flex flex-wrap items-center gap-2">
              <Label className="text-xs text-muted-foreground">Tax code</Label>
              {tax.needs_code ? (
                <Badge variant="destructive">Needs a tax code</Badge>
              ) : tax.manual ? (
                <span className="text-xs text-muted-foreground">
                  HST typed from your refund slip: {formatMoney(tax.tax_amount)}
                </span>
              ) : (
                <span className="text-xs text-muted-foreground">
                  Tax {formatMoney(tax.tax_amount)}
                  {tax.code && tax.code.tax_rate > 0
                    ? ` (${Math.round(tax.code.tax_rate * 100)}% HST in the price, ${Math.round(tax.code.itc_pct * 100)}% claimable)`
                    : " (no tax)"}
                  {tax.source ? ` · ${SOURCE_COPY[tax.source]}` : ""}
                </span>
              )}
            </div>
            <Select
              items={taxItems}
              value={pickedCode ?? AUTO}
              onValueChange={(v) => v && onPatch([id], { tax_code: v === AUTO ? null : v })}
            >
              <SelectTrigger className="w-full" disabled={disabled || tax.manual}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={AUTO}>{taxItems[AUTO]}</SelectItem>
                {TAX_CODE_KEYS.map((k) => (
                  <SelectItem key={k} value={k}>
                    {TAX_CODE_LABELS[k]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {tax.needs_code && (
              <p className="text-xs text-muted-foreground">
                Nothing is calculated until a code applies, so no ITC is counted. Choose one, or attach
                the receipt later and its actual tax is used.
              </p>
            )}
          </div>

          {group === "refunds" && (
            <div className="space-y-1 sm:col-span-2">
              <Label htmlFor={`hst-${id}`} className="text-xs text-muted-foreground">
                HST on this refund (optional)
              </Label>
              <NumberInput
                id={`hst-${id}`}
                step="0.01"
                placeholder="Leave blank unless your refund slip shows it"
                value={hst}
                disabled={disabled}
                onValueChange={setHst}
                onBlur={() => hst !== Math.abs(line.tax_amount) && onPatch([id], { tax_amount: hst })}
              />
              <p className="text-xs text-muted-foreground">
                Leave blank to calculate it from the tax code above, or type the figure from your refund
                slip (that replaces the code).
              </p>
            </div>
          )}

          {savedAs && savedAs !== line.description && (
            <p className="text-xs text-muted-foreground sm:col-span-2">
              Saved as <span className="font-medium text-foreground">{savedAs}</span>
            </p>
          )}

          <div className="flex items-center gap-2 sm:col-span-2">
            {tax.needs_code ? (
              <Badge variant="destructive">No receipt, needs a tax code</Badge>
            ) : (
              <Badge variant="secondary">Tax calculated from statement</Badge>
            )}
            <Button
              size="sm"
              variant="ghost"
              className="ml-auto text-muted-foreground"
              disabled={disabled}
              onClick={() => onPatch([id], { resolution: "skipped" })}
            >
              Exclude
            </Button>
          </div>
        </div>
      )}

      {editing && <EditLineDialog line={line} onClose={() => setEditing(false)} onPatch={onPatch} />}
    </li>
  );
}

// Mounted only while open, so its fields start from the line's current values
// without an effect to copy them in.
function EditLineDialog({
  line,
  onClose,
  onPatch,
}: {
  line: ReviewLineData;
  onClose: () => void;
  onPatch: PatchFn;
}) {
  const [description, setDescription] = useState(line.description);
  const [date, setDate] = useState(line.txn_date);
  const [amount, setAmount] = useState(line.amount);
  const [kind, setKind] = useState<StatementLineKind>(line.kind);
  const [saving, setSaving] = useState(false);

  const kindItems = KIND_LABELS;

  async function save() {
    const patch: Record<string, unknown> = {};
    if (description !== line.description) patch.description = description;
    if (date !== line.txn_date) patch.txn_date = date;
    if (amount !== line.amount) patch.amount = amount;
    if (kind !== line.kind) patch.kind = kind;
    if (Object.keys(patch).length === 0) return onClose();
    setSaving(true);
    const ok = await onPatch([line.id], patch);
    setSaving(false);
    if (ok) onClose();
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Fix this line</DialogTitle>
          <DialogDescription>
            For a misread statement. Changing the date or amount re-checks for duplicates and the
            statement total.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="edit_desc">Description</Label>
            <Input id="edit_desc" value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="edit_date">Date</Label>
              <Input id="edit_date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="edit_amount">Amount ($)</Label>
              <NumberInput id="edit_amount" step="0.01" value={amount} onValueChange={setAmount} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="edit_kind">Type</Label>
            <Select items={kindItems} value={kind} onValueChange={(v) => v && setKind(v as StatementLineKind)}>
              <SelectTrigger id="edit_kind" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {LINE_KINDS.map((k) => (
                  <SelectItem key={k} value={k}>
                    {KIND_LABELS[k]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Charges are positive; a refund or credit is negative.
            </p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={save} disabled={saving}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
