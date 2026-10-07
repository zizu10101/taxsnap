// "Delete statement": the pure plan, shared by the preview and the apply (the server runs the SAME
// planStatementDelete for both, so the preview can't promise something the apply does differently).
//
// What it does to a SAVED statement's lines:
//   delete   an expense the statement created that has NO receipt attached (from_statement and
//            no_receipt). Deleting it frees its line (the existing trigger).
//   keep     an expense the statement created that HAS a receipt attached. It is never deleted, and its
//            line stays linked to it on purpose: that line is what stops a later re-import of this
//            statement from creating a second expense for the same charge (statement-created expenses
//            are not import match candidates). It is freed by the same trigger if that expense is
//            ever deleted later.
//   unlink   a line matched to an ordinary receipt. The receipt is NEVER deleted; the line is freed
//            (so a re-import can match it again).
//   leave    everything else (excluded lines, payments, lines already freed): untouched.
// Finally the import is marked discarded so the same file can be uploaded again.

import { outcomeOf } from "./statement-summary.ts";

export interface DeleteLine {
  id: string;
  kind: string;
  created_receipt_id: string | null;
  matched_receipt_id: string | null;
  released_at?: string | null;
  released_from?: "new_expense" | "matched" | null;
}

export interface DeleteReceipt {
  id: string;
  merchant_name: string;
  transaction_date: string;
  total_amount: number;
  tax_amount: number;
  from_statement?: boolean | null;
  no_receipt?: boolean | null;
  job_name?: string | null;
}

export interface DeletePlan {
  /** Expenses that will be deleted (no receipt attached). */
  delete: { line_id: string; receipt: DeleteReceipt }[];
  /** Expenses that stay because a receipt is attached. */
  keep: { line_id: string; receipt: DeleteReceipt }[];
  /** Lines matched to an ordinary receipt: freed, the receipt untouched. */
  unlink: { line_id: string; receipt_id: string }[];
  counts: {
    delete: number;
    keep: number;
    unlink: number;
    /** Of the expenses to delete, how many are tagged to a job (job costing changes). */
    delete_on_jobs: number;
    delete_total: number;
    delete_tax: number;
  };
}

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export function planStatementDelete(lines: DeleteLine[], receipts: DeleteReceipt[]): DeletePlan {
  const byId = new Map(receipts.map((r) => [r.id, r]));
  const del: DeletePlan["delete"] = [];
  const keep: DeletePlan["keep"] = [];
  const unlink: DeletePlan["unlink"] = [];

  for (const line of lines) {
    const outcome = outcomeOf(line);
    if (outcome === "new_expense") {
      const r = byId.get(line.created_receipt_id!);
      if (!r) continue; // the expense is gone (it cannot dangle, but never act on what we can't see)
      if (r.from_statement === true && r.no_receipt === true) del.push({ line_id: line.id, receipt: r });
      else keep.push({ line_id: line.id, receipt: r });
    } else if (outcome === "matched") {
      unlink.push({ line_id: line.id, receipt_id: line.matched_receipt_id! });
    }
  }

  return {
    delete: del,
    keep,
    unlink,
    counts: {
      delete: del.length,
      keep: keep.length,
      unlink: unlink.length,
      delete_on_jobs: del.filter((d) => !!d.receipt.job_name).length,
      delete_total: round2(del.reduce((s, d) => s + d.receipt.total_amount, 0)),
      delete_tax: round2(del.reduce((s, d) => s + Number(d.receipt.tax_amount), 0)),
    },
  };
}

// What apply sends back so the server can refuse (409) if the plan changed since the preview.
export interface DeleteExpectation {
  delete_ids: string[];
  unlink_line_ids: string[];
  keep_ids: string[];
}

export function expectationOf(plan: DeletePlan): DeleteExpectation {
  return {
    delete_ids: plan.delete.map((d) => d.receipt.id).sort(),
    unlink_line_ids: plan.unlink.map((u) => u.line_id).sort(),
    keep_ids: plan.keep.map((k) => k.receipt.id).sort(),
  };
}

const sameSet = (a: string[], b: string[]) => a.length === b.length && [...a].sort().every((v, i) => v === [...b].sort()[i]);

export function expectationMatches(plan: DeletePlan, expect: DeleteExpectation): boolean {
  const now = expectationOf(plan);
  return (
    sameSet(now.delete_ids, expect.delete_ids) &&
    sameSet(now.unlink_line_ids, expect.unlink_line_ids) &&
    sameSet(now.keep_ids, expect.keep_ids)
  );
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function cleanExpectation(value: unknown): DeleteExpectation | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  const list = (x: unknown): string[] | null =>
    Array.isArray(x) && x.every((i) => typeof i === "string" && UUID.test(i)) && new Set(x).size === x.length
      ? (x as string[])
      : null;
  const delete_ids = list(v.delete_ids);
  const unlink_line_ids = list(v.unlink_line_ids);
  const keep_ids = list(v.keep_ids);
  return delete_ids && unlink_line_ids && keep_ids ? { delete_ids, unlink_line_ids, keep_ids } : null;
}
