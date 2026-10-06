import type { StatementLineKind } from "./database.types.ts";
import type { ReconcileResult } from "./statement-reconcile.ts";

// What the review screen shows and when "Save" unlocks. Pure so the rules the
// UI relies on (which group a line is in, what still needs a decision) are
// tested rather than buried in a component.

export interface ReviewLine {
  id: string;
  kind: StatementLineKind;
  amount: number;
  resolution: "matched" | "new_expense" | "skipped" | null;
  category: string | null;
  category_confirmed: boolean;
  duplicate_of_line_id: string | null;
  duplicate_override: boolean;
  /** Receipts the user could match this line to (computed by the server). */
  candidate_count: number;
}

export type ReviewGroup =
  | "already_imported"
  | "possible_matches"
  | "matched"
  | "new"
  | "refunds"
  | "bank_charges"
  | "excluded"
  | "payments";

export const GROUP_ORDER: ReviewGroup[] = [
  "possible_matches",
  "new",
  "refunds",
  "bank_charges",
  "already_imported",
  "matched",
  "excluded",
  "payments",
];

export function groupOf(line: ReviewLine): ReviewGroup {
  if (line.duplicate_of_line_id && !line.duplicate_override) return "already_imported";
  if (line.kind === "payment") return "payments";
  if (line.resolution === "skipped") return "excluded";
  if (line.resolution === "matched") return "matched";
  if (line.kind === "refund") return "refunds";
  if (line.kind === "fee" || line.kind === "interest") return "bank_charges";
  if (line.resolution === null && line.candidate_count > 0) return "possible_matches";
  return "new";
}

// A line blocks saving while it has no decision, or it's going in as a new
// expense but its category is still only a suggestion (or empty).
export function needsDecision(line: ReviewLine): boolean {
  if (line.kind === "payment" && line.resolution === "skipped") return false;
  if (line.resolution === null) return true;
  if (line.resolution === "new_expense") return !line.category || !line.category_confirmed;
  return false;
}

export interface ReviewSummary {
  total: number;
  needsDecision: number;
  willMatch: number;
  willCreate: number;
  willSkip: number;
  alreadyImported: number;
}

export function summarize(lines: ReviewLine[]): ReviewSummary {
  const s: ReviewSummary = { total: lines.length, needsDecision: 0, willMatch: 0, willCreate: 0, willSkip: 0, alreadyImported: 0 };
  for (const l of lines) {
    if (needsDecision(l)) s.needsDecision += 1;
    if (l.resolution === "matched") s.willMatch += 1;
    else if (l.resolution === "new_expense") s.willCreate += 1;
    else if (l.resolution === "skipped") {
      s.willSkip += 1;
      if (l.duplicate_of_line_id && !l.duplicate_override) s.alreadyImported += 1;
    }
  }
  return s;
}

// Save unlocks when nothing needs a decision and, if the lines didn't add up to
// the statement, the user has explicitly said they checked it.
export function canSave(
  lines: ReviewLine[],
  reconcile: ReconcileResult,
  reconcileAcknowledged: boolean,
): boolean {
  if (lines.length === 0) return false;
  if (summarize(lines).needsDecision > 0) return false;
  if (reconcile.status === "off" && !reconcileAcknowledged) return false;
  return true;
}
