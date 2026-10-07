// What a SAVED statement import did, derived from its lines - the numbers on the Statements list and
// the groups on a statement's detail. Pure, so it unit-tests directly.
//
// Every line is in exactly one outcome:
//   new_expense      created an expense that still exists            (created_receipt_id set)
//   matched          linked to an existing receipt                   (matched_receipt_id set)
//   expense_deleted  created an expense that was later deleted       (released_from 'new_expense')
//   match_removed    was matched to a receipt that was later deleted (released_from 'matched')
//   excluded         a purchase/refund/fee/interest line that was never saved as an expense. This also
//                    holds lines freed BEFORE migration 0058 - their history was overwritten then.
//   payment          a payment to the card: never an expense, never "free"
//
// "Free" lines are the ones a re-import could bring back: excluded + expense_deleted + match_removed.
// Payments are never free, and a line whose expense still exists is claimed, not free.

export type LineOutcome = "new_expense" | "matched" | "expense_deleted" | "match_removed" | "excluded" | "payment";

export interface SummaryLine {
  kind: string;
  created_receipt_id: string | null;
  matched_receipt_id: string | null;
  released_at?: string | null;
  released_from?: "new_expense" | "matched" | null;
}

export function outcomeOf(line: SummaryLine): LineOutcome {
  if (line.kind === "payment") return "payment";
  if (line.created_receipt_id) return "new_expense";
  if (line.matched_receipt_id) return "matched";
  if (line.released_from === "new_expense") return "expense_deleted";
  if (line.released_from === "matched") return "match_removed";
  return "excluded";
}

export const isFreeOutcome = (o: LineOutcome) => o === "excluded" || o === "expense_deleted" || o === "match_removed";

export interface ImportSummary {
  lines: number;
  /** Expenses the import created in total, including ones deleted since. */
  created: number;
  /** Of those, how many still exist. */
  created_remaining: number;
  /** Receipts the import was matched to in total, including ones deleted since. */
  matched: number;
  matched_remaining: number;
  /** Lines saved as nothing (excluded) plus payments. */
  skipped: number;
  payments: number;
  /** What a re-import would bring back. */
  free: { excluded: number; released: number; total: number };
}

export function summarizeLines(lines: SummaryLine[]): ImportSummary {
  const count = { new_expense: 0, matched: 0, expense_deleted: 0, match_removed: 0, excluded: 0, payment: 0 };
  for (const l of lines) count[outcomeOf(l)] += 1;
  const released = count.expense_deleted + count.match_removed;
  return {
    lines: lines.length,
    created: count.new_expense + count.expense_deleted,
    created_remaining: count.new_expense,
    matched: count.matched + count.match_removed,
    matched_remaining: count.matched,
    skipped: count.excluded + count.payment,
    payments: count.payment,
    free: { excluded: count.excluded, released, total: count.excluded + released },
  };
}

// ---------------------------------------------------------------------------
// The reconcile status shown beside a saved statement
// ---------------------------------------------------------------------------
// reconcile_diff is the extracted total minus the statement's own figure (0 = they agree), recorded
// when the statement was saved; null when the statement had no total to check against. An owner can
// save a statement whose lines are off by acknowledging it - and that is NEVER shown as "reconciled".
export type ReconcileTone = "ok" | "warn" | "neutral";

export function reconcileLabel(input: {
  reconcile_diff: number | null;
  reconcile_acknowledged: boolean;
}): { label: string; tone: ReconcileTone } {
  const diff = input.reconcile_diff;
  if (diff === null || diff === undefined) return { label: "No total to check against", tone: "neutral" };
  if (Math.round(Number(diff) * 100) === 0) return { label: "Reconciled", tone: "ok" };
  const amount = `$${Math.abs(Number(diff)).toFixed(2)}`;
  return input.reconcile_acknowledged
    ? { label: `Difference acknowledged (${amount})`, tone: "warn" }
    : { label: `Off by ${amount}`, tone: "warn" };
}
