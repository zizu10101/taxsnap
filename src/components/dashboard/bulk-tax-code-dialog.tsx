"use client";

import { useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
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
import type { BulkTaxPlan, TaxChange } from "@/lib/bulk-tax-code";
import { TAX_CODE_KEYS, TAX_CODE_LABELS, type TaxCodeKey, type TaxPatch } from "@/lib/tax-codes";

function money(n: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);
}
export const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

// What the page needs after a bulk tax-code change, and to undo it.
export interface BulkTaxMove {
  code: TaxCodeKey;
  previous: TaxChange[];
  /** The new tax code and calculated tax for each changed row. */
  retaxed: { id: string; patch: TaxPatch }[];
}

export async function callTaxCode(body: unknown) {
  const res = await fetch("/api/receipts/bulk-tax-code", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, data };
}

// Preview-then-confirm for "Set tax code". It only ever applies to expenses imported from a card
// statement that have NO receipt attached; everything else in the selection is skipped, and the
// preview says how many and why. The ids are frozen when the dialog opens, and apply sends back
// exactly the rows the preview showed, each with the tax state it had, so the server refuses if
// anything changed (or got a receipt) since.
export function BulkTaxCodeDialog({
  ids,
  onClose,
  onApplied,
}: {
  ids: string[];
  onClose: () => void;
  onApplied: (move: BulkTaxMove) => void;
}) {
  const [code, setCode] = useState<TaxCodeKey | "">("");
  const [plan, setPlan] = useState<BulkTaxPlan | null>(null);
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);

  async function preview(next: TaxCodeKey) {
    const mine = ++seq.current;
    setCode(next);
    setPlan(null);
    setError(null);
    setLoading(true);
    try {
      const { ok, data } = await callTaxCode({ mode: "preview", ids, code: next });
      if (mine !== seq.current) return;
      if (!ok) throw new Error(data.error || "Couldn't preview");
      setPlan(data.plan as BulkTaxPlan);
    } catch (err) {
      if (mine === seq.current) setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      if (mine === seq.current) setLoading(false);
    }
  }

  async function apply() {
    if (!plan || !code) return;
    setApplying(true);
    setError(null);
    try {
      const { ok, data } = await callTaxCode({ mode: "apply", code, changes: plan.changes });
      if (!ok) {
        setError(data.error || "Couldn't set the tax code");
        if (data.code === "STALE_PREVIEW") setPlan(null);
        return;
      }
      toast.success(`Set the tax code on ${plural(data.changed, "expense")}`);
      onApplied({ code, previous: data.previous, retaxed: data.retaxed ?? [] });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setApplying(false);
    }
  }

  const skippedTotal = plan
    ? plan.skipped.has_receipt + plan.skipped.confirmed + plan.skipped.typed_figure + plan.skipped.already_set + plan.missing
    : 0;

  return (
    <Dialog open onOpenChange={(open) => !open && !applying && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Set tax code for {plural(ids.length, "expense")}</DialogTitle>
          <DialogDescription>
            Applies only to card-statement expenses that don&apos;t have a receipt yet. The tax is
            recalculated from each total. Anything with a receipt keeps its actual tax.
          </DialogDescription>
        </DialogHeader>

        <div className="min-w-0 space-y-3">
          <Select
            items={Object.fromEntries(TAX_CODE_KEYS.map((k) => [k, TAX_CODE_LABELS[k]]))}
            value={code || null}
            onValueChange={(v) => v && preview(v as TaxCodeKey)}
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Choose a tax code..." />
            </SelectTrigger>
            <SelectContent>
              {TAX_CODE_KEYS.map((k) => (
                <SelectItem key={k} value={k}>
                  {TAX_CODE_LABELS[k]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {loading && (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Checking...
            </p>
          )}

          {error && (
            <p className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
              {error}
              {!plan && code && (
                <button
                  type="button"
                  className="ml-2 underline underline-offset-2"
                  onClick={() => preview(code)}
                >
                  Preview again
                </button>
              )}
            </p>
          )}

          {plan && (
            <div className="space-y-3 text-sm">
              <p>
                <strong>{plural(plan.will_change, "expense")}</strong> will get{" "}
                <strong>{TAX_CODE_LABELS[plan.code]}</strong> ({money(plan.moved_total)} as paid).
                {plan.were_missing_a_code > 0 && (
                  <span className="text-muted-foreground">
                    {" "}
                    {plural(plan.were_missing_a_code, "expense")} had no tax code until now.
                  </span>
                )}
              </p>

              {skippedTotal > 0 && (
                <div className="space-y-1 rounded-md border bg-muted/40 p-3 text-xs">
                  <p className="font-medium">{plural(skippedTotal, "expense")} skipped, left exactly as they are:</p>
                  <ul className="list-disc space-y-0.5 pl-4 text-muted-foreground">
                    {plan.skipped.has_receipt > 0 && (
                      <li>{plan.skipped.has_receipt} have a receipt attached (their actual tax is kept)</li>
                    )}
                    {plan.skipped.confirmed > 0 && (
                      <li>
                        {plan.skipped.confirmed} {plan.skipped.confirmed === 1 ? "is" : "are"} confirmed
                        (scanned, or entered by you), not from a statement
                      </li>
                    )}
                    {plan.skipped.typed_figure > 0 && (
                      <li>{plan.skipped.typed_figure} have a tax figure you typed</li>
                    )}
                    {plan.skipped.already_set > 0 && <li>{plan.skipped.already_set} already have this code</li>}
                    {plan.missing > 0 && <li>{plan.missing} no longer exist</li>}
                  </ul>
                </div>
              )}

              {plan.will_change > 0 && (
                <div className="space-y-1 rounded-md border bg-muted/40 p-3 text-xs">
                  <p className="font-medium">
                    Calculated tax on these: {money(plan.effect.tax.before)} to {money(plan.effect.tax.after)}.
                  </p>
                  <p className="text-muted-foreground">
                    Estimated reclaimable HST on these: {money(plan.effect.est_hst_reclaimable.before)} to{" "}
                    {money(plan.effect.est_hst_reclaimable.after)}. Deductible spend:{" "}
                    {money(plan.effect.deductible_spend.before)} to {money(plan.effect.deductible_spend.after)}.
                    These are calculated from your statement, not confirmed by a receipt.
                  </p>
                </div>
              )}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={applying}>
            Cancel
          </Button>
          <Button onClick={apply} disabled={!plan || plan.will_change === 0 || applying}>
            {applying && <Loader2 className="h-4 w-4 animate-spin" />}
            {plan && plan.will_change > 0 ? `Set on ${plural(plan.will_change, "expense")}` : "Set tax code"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
