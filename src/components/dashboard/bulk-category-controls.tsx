"use client";

import { useRef, useState } from "react";
import { Loader2, Tag, Undo2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import { useExpenseCategoryOptions } from "@/components/owner-lists-provider";
import { BULK_CATEGORY_MAX, type BulkChange, type BulkPlan } from "@/lib/bulk-category";
import type { TaxPatch } from "@/lib/tax-codes";

function money(n: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);
}
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

// What the page needs to know after a move, and to undo it.
export interface BulkMove {
  category: string;
  previous: BulkChange[];
  /** Calculated statement expenses whose tax code and calculated tax were recomputed. */
  retaxed: { id: string; patch: TaxPatch }[];
}

async function call(body: unknown) {
  const res = await fetch("/api/receipts/bulk-category", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, data };
}

// The action bar (shown while something is selected), the preview-then-confirm dialog, and the
// "Moved N expenses - Undo" strip. Undo is session-only: the previous categories live in this
// component's state, so a reload drops it. The ids are FROZEN at the moment the dialog opens (the
// selection can't change under a modal) and the apply sends back exactly the rows the preview
// showed, each with the category it had, so the server can refuse if anything moved since.
export function BulkCategoryControls({
  selectedIds,
  visibleCount,
  onSelectAllVisible,
  onClear,
  onMoved,
  onRestored,
}: {
  selectedIds: string[];
  visibleCount: number;
  onSelectAllVisible: () => void;
  onClear: () => void;
  onMoved: (move: BulkMove) => void;
  onRestored: (rows: { id: string; category: string; tax?: TaxPatch }[]) => void;
}) {
  const [dialog, setDialog] = useState<{ key: number; ids: string[] } | null>(null);
  const [lastMove, setLastMove] = useState<(BulkMove & { count: number }) | null>(null);
  const [undoing, setUndoing] = useState(false);
  const openCount = useRef(0);

  async function handleUndo() {
    if (!lastMove) return;
    setUndoing(true);
    try {
      const { ok, data } = await call({ mode: "undo", category: lastMove.category, changes: lastMove.previous });
      if (!ok) throw new Error(data.error || "Couldn't undo");
      onRestored(data.restored_rows ?? []);
      toast.success(
        data.left_alone > 0
          ? `Put back ${plural(data.restored, "expense")}. ${plural(data.left_alone, "expense")} had been edited since, so they were left alone.`
          : `Put back ${plural(data.restored, "expense")}.`,
      );
      setLastMove(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setUndoing(false);
    }
  }

  return (
    <>
      {lastMove && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-muted/40 px-4 py-3 text-sm">
          <span>
            Moved {plural(lastMove.count, "expense")} to <strong>{lastMove.category}</strong>.{" "}
            {lastMove.retaxed.length > 0
              ? `Tax was recalculated on ${plural(lastMove.retaxed.length, "statement expense")}; nothing with a receipt was touched.`
              : "Sales tax wasn't changed."}
          </span>
          <span className="flex gap-2">
            <Button size="sm" variant="outline" onClick={handleUndo} disabled={undoing}>
              {undoing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Undo2 className="h-4 w-4" />}
              Undo
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setLastMove(null)} aria-label="Dismiss">
              <X className="h-4 w-4" />
            </Button>
          </span>
        </div>
      )}

      {selectedIds.length > 0 && (
        <div className="sticky bottom-20 z-30 flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-card px-4 py-3 shadow-lg lg:bottom-4">
          <span className="text-sm font-medium">
            {selectedIds.length} selected
            {selectedIds.length < visibleCount && (
              <button
                type="button"
                className="ml-2 text-xs font-normal text-primary underline underline-offset-2"
                onClick={onSelectAllVisible}
              >
                Select all {Math.min(visibleCount, BULK_CATEGORY_MAX)} in this view
              </button>
            )}
          </span>
          <span className="flex gap-2">
            <Button
              size="sm"
              onClick={() => setDialog({ key: ++openCount.current, ids: selectedIds })}
            >
              <Tag className="h-4 w-4" />
              Change category...
            </Button>
            <Button size="sm" variant="outline" onClick={onClear}>
              Clear
            </Button>
          </span>
        </div>
      )}

      {dialog && (
        <BulkCategoryDialog
          key={dialog.key}
          ids={dialog.ids}
          onClose={() => setDialog(null)}
          onApplied={(move) => {
            setLastMove({ ...move, count: move.previous.length });
            onMoved(move);
            setDialog(null);
          }}
        />
      )}
    </>
  );
}

function BulkCategoryDialog({
  ids,
  onClose,
  onApplied,
}: {
  ids: string[];
  onClose: () => void;
  onApplied: (move: BulkMove) => void;
}) {
  const categories = useExpenseCategoryOptions();
  const [target, setTarget] = useState("");
  const [plan, setPlan] = useState<BulkPlan | null>(null);
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mealsOk, setMealsOk] = useState(false);
  const seq = useRef(0);

  async function preview(category: string) {
    const mine = ++seq.current;
    setTarget(category);
    setPlan(null);
    setError(null);
    setMealsOk(false);
    setLoading(true);
    try {
      const { ok, data } = await call({ mode: "preview", ids, category });
      if (mine !== seq.current) return;
      if (!ok) throw new Error(data.error || "Couldn't preview");
      setPlan(data.plan as BulkPlan);
    } catch (err) {
      if (mine === seq.current) setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      if (mine === seq.current) setLoading(false);
    }
  }

  async function apply() {
    if (!plan) return;
    setApplying(true);
    setError(null);
    try {
      const { ok, data } = await call({
        mode: "apply",
        category: target,
        changes: plan.changes,
        ...(plan.meals_involved && { confirm_meals: mealsOk }),
      });
      if (!ok) {
        setError(data.error || "Couldn't change the category");
        if (data.code === "STALE_PREVIEW") setPlan(null);
        return;
      }
      toast.success(`Moved ${plural(data.changed, "expense")} to ${data.category}`);
      onApplied({ category: data.category, previous: data.previous, retaxed: data.retaxed ?? [] });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setApplying(false);
    }
  }

  const hstDelta = plan ? plan.effect.est_hst_reclaimable.after - plan.effect.est_hst_reclaimable.before : 0;
  const needsMealsConfirm = !!plan?.meals_involved;
  const canApply = !!plan && plan.will_change > 0 && (!needsMealsConfirm || mealsOk) && !applying;

  return (
    <Dialog open onOpenChange={(open) => !open && !applying && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Change category for {plural(ids.length, "expense")}</DialogTitle>
          <DialogDescription>
            Only the category changes. Amounts and sales tax are left exactly as they are.
          </DialogDescription>
        </DialogHeader>

        <div className="min-w-0 space-y-3">
          <Select
            items={Object.fromEntries(categories.map((c) => [c, c]))}
            value={target || null}
            onValueChange={(v) => v && preview(v)}
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Move them to..." />
            </SelectTrigger>
            <SelectContent>
              {categories.map((c) => (
                <SelectItem key={c} value={c}>
                  {c}
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
              {!plan && target && (
                <button
                  type="button"
                  className="ml-2 underline underline-offset-2"
                  onClick={() => preview(target)}
                >
                  Preview again
                </button>
              )}
            </p>
          )}

          {plan && (
            <div className="space-y-3 text-sm">
              <p>
                <strong>{plural(plan.will_change, "expense")}</strong> will move to{" "}
                <strong>{target}</strong> ({money(plan.moved_total)} as paid).
                {plan.already_in_target > 0 && (
                  <span className="text-muted-foreground">
                    {" "}
                    {plural(plan.already_in_target, "expense")} already in {target} will be skipped.
                  </span>
                )}
                {plan.missing > 0 && (
                  <span className="text-muted-foreground">
                    {" "}
                    {plural(plan.missing, "expense")} no longer exist and will be skipped.
                  </span>
                )}
              </p>

              {plan.by_category.length > 0 && (
                <ul className="divide-y rounded-md border text-xs">
                  {plan.by_category.map((g) => (
                    <li key={g.category} className="flex items-center justify-between gap-3 px-3 py-1.5">
                      <span className="min-w-0 truncate">{g.category}</span>
                      <span className="shrink-0 tabular-nums text-muted-foreground">
                        {plural(g.count, "expense")} · {money(g.total)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}

              <div className="space-y-1 rounded-md border bg-muted/40 p-3 text-xs">
                <p className="font-medium">
                  {plan.recalculated > 0
                    ? `Tax is recalculated on ${plural(plan.recalculated, "statement expense")}; every expense with a receipt keeps its tax exactly.`
                    : "Sales tax is not changed."}
                </p>
                <p className="text-muted-foreground">
                  Estimated reclaimable HST: {money(plan.effect.est_hst_reclaimable.before)} to{" "}
                  {money(plan.effect.est_hst_reclaimable.after)}. Deductible spend:{" "}
                  {money(plan.effect.deductible_spend.before)} to {money(plan.effect.deductible_spend.after)}.
                </p>
              </div>

              {needsMealsConfirm && (
                <label className="flex cursor-pointer items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-xs">
                  <Checkbox checked={mealsOk} onCheckedChange={(c) => setMealsOk(c === true)} className="mt-0.5" />
                  <span>
                    <span className="block font-medium">Meals is treated as 50% reclaimable</span>
                    Moving these into or out of Meals changes your estimated reclaimable HST by{" "}
                    {money(Math.abs(hstDelta))} {hstDelta < 0 ? "less" : "more"} (the HST amounts themselves
                    stay the same). I understand.
                  </span>
                </label>
              )}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={applying}>
            Cancel
          </Button>
          <Button onClick={apply} disabled={!canApply}>
            {applying && <Loader2 className="h-4 w-4 animate-spin" />}
            {plan && plan.will_change > 0 ? `Move ${plural(plan.will_change, "expense")}` : "Move"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
