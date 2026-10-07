// Bulk "Set tax code" on the Expenses page: the pure rules, shared by the preview and the apply (the
// server runs the SAME planBulkTaxCode for both, so the preview can't promise something the apply
// then does differently).
//
// It sets a tax code on CALCULATED rows only - a card-statement expense with no receipt attached
// (isCalculated) - recalculating the tax tax-included from each row's total and marking the code as
// the owner's own pick. It NEVER touches:
//   a row with a receipt attached     (its tax is the receipt's actual figure)
//   a confirmed row                   (a scanned receipt, or a figure the owner entered)
//   a row whose tax the owner typed   (a refund's HST from the slip - not overwritten in bulk)
//   a row that already has that code  (nothing to change)
// and the preview says how many were skipped and why.

import { computeExpenseSummary } from "./expense-summary.ts";
import {
  currentTaxPatch,
  hasTypedFigure,
  isCalculated,
  needsTaxCode,
  samePatch,
  taxPatchForCode,
  type RecalcRow,
  type TaxCodeKey,
  type TaxPatch,
} from "./tax-codes.ts";
import { cleanTaxPatch } from "./bulk-category.ts";

export interface TaxBulkRow extends RecalcRow {
  id: string;
  tax_category: string;
  total_amount: number;
  tax_amount: number;
}

export interface TaxChange {
  id: string;
  /** The row's tax code and tax BEFORE the change. Apply refuses unless the row still matches it. */
  prev: TaxPatch;
}

export interface BulkTaxPlan {
  code: TaxCodeKey;
  requested: number;
  /** Ids that aren't (or are no longer) this person's expenses. */
  missing: number;
  will_change: number;
  skipped: {
    /** A receipt is attached: its actual tax is the figure. */
    has_receipt: number;
    /** Not a statement expense: a scanned receipt, or a figure the owner entered. */
    confirmed: number;
    /** The owner typed this row's tax (a refund slip's HST). */
    typed_figure: number;
    /** Already has exactly this code. */
    already_set: number;
  };
  changes: TaxChange[];
  /** The new tax for each changing row (server-side use; recomputed on apply). */
  retax: { id: string; patch: TaxPatch }[];
  /** Of the rows that change, how many had no code at all ("needs a tax code"). */
  were_missing_a_code: number;
  moved_total: number;
  effect: {
    /** Calculated sales tax on the changing rows. */
    tax: { before: number; after: number };
    /** Their estimated reclaimable HST (each row's own claim share). */
    est_hst_reclaimable: { before: number; after: number };
    deductible_spend: { before: number; after: number };
  };
}

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export function planBulkTaxCode(ids: string[], rows: TaxBulkRow[], key: TaxCodeKey): BulkTaxPlan {
  const wanted = [...new Set(ids)];
  const byId = new Map(rows.map((r) => [r.id, r]));
  const found = wanted.map((id) => byId.get(id)).filter((r): r is TaxBulkRow => !!r);

  const skipped = { has_receipt: 0, confirmed: 0, typed_figure: 0, already_set: 0 };
  const changing: TaxBulkRow[] = [];
  const retax = new Map<string, TaxPatch>();
  for (const r of found) {
    if (r.from_statement !== true) {
      skipped.confirmed += 1;
    } else if (!isCalculated(r)) {
      skipped.has_receipt += 1;
    } else if (hasTypedFigure(r)) {
      skipped.typed_figure += 1;
    } else {
      const patch = taxPatchForCode(r.total_amount, key);
      if (samePatch(patch, currentTaxPatch(r))) {
        skipped.already_set += 1;
      } else {
        changing.push(r);
        retax.set(r.id, patch);
      }
    }
  }

  const before = computeExpenseSummary(changing);
  const after = computeExpenseSummary(changing.map((r) => ({ ...r, ...retax.get(r.id)! })));
  const sumTax = (list: { tax_amount: number }[]) => round2(list.reduce((s, r) => s + Number(r.tax_amount), 0));

  return {
    code: key,
    requested: wanted.length,
    missing: wanted.length - found.length,
    will_change: changing.length,
    skipped,
    changes: changing.map((r) => ({ id: r.id, prev: currentTaxPatch(r) })),
    retax: [...retax].map(([id, patch]) => ({ id, patch })),
    were_missing_a_code: changing.filter((r) => needsTaxCode(r)).length,
    moved_total: round2(changing.reduce((s, r) => s + r.total_amount, 0)),
    effect: {
      tax: { before: sumTax(changing), after: sumTax(changing.map((r) => retax.get(r.id)!)) },
      est_hst_reclaimable: { before: before.estHstReclaimable, after: after.estHstReclaimable },
      deductible_spend: { before: before.deductibleSpend, after: after.deductibleSpend },
    },
  };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// What apply and undo send back: each row with the exact tax state the preview saw.
export function cleanTaxChanges(value: unknown): TaxChange[] | null {
  if (!Array.isArray(value)) return null;
  const out: TaxChange[] = [];
  for (const c of value) {
    if (!c || typeof c.id !== "string" || !UUID.test(c.id)) return null;
    const prev = cleanTaxPatch(c.prev);
    if (!prev) return null;
    out.push({ id: c.id, prev });
  }
  if (new Set(out.map((c) => c.id)).size !== out.length) return null;
  return out;
}
