import type { StatementLineKind } from "./database.types.ts";
import { matchRows, rankCandidates, type MatchCandidate, type MatchRow } from "./statement-matching.ts";

// Which statement lines can be matched to which existing receipts, given what is
// already claimed. Pure: the server gathers the rows, this decides.

export interface CandidateLine {
  id: string;
  txn_date: string;
  amount: number;
  /** The statement's printed description - the vendor, for a same-vendor match. */
  description?: string;
  kind: StatementLineKind;
  resolution: "matched" | "new_expense" | "skipped" | null;
  duplicate_of_line_id: string | null;
  duplicate_override: boolean;
}

// A line is worth matching only if it's a positive purchase the user hasn't
// already matched, excluded, or had flagged as already imported.
export function isMatchable(line: CandidateLine): boolean {
  if (line.amount <= 0) return false;
  if (line.kind !== "purchase" && line.kind !== "other") return false;
  if (line.resolution === "matched" || line.resolution === "skipped") return false;
  if (line.duplicate_of_line_id && !line.duplicate_override) return false;
  return true;
}

export interface LineCandidates {
  /** line id -> receipt id: unambiguous, safe to accept without asking. */
  auto: Map<string, string>;
  /** line id -> receipts the user may choose from (never includes an auto match). */
  candidates: Map<string, MatchCandidate[]>;
}

export function computeLineCandidates(
  lines: CandidateLine[],
  pool: MatchRow[],
  /** receipt id -> the line that already claims it (any import). */
  claimedBy: Map<string, string>,
): LineCandidates {
  const free = pool.filter((r) => !claimedBy.has(r.id));
  const asRow = (l: CandidateLine): MatchRow => ({
    id: l.id,
    date: l.txn_date,
    amount: l.amount,
    vendor: l.description,
  });

  const undecided = lines.filter((l) => isMatchable(l) && l.resolution === null);
  const { auto, ask } = matchRows(undecided.map(asRow), free);
  const candidates = new Map(ask);

  // A line already chosen as a new expense can still be switched to a match.
  for (const l of lines) {
    if (!isMatchable(l) || l.resolution !== "new_expense") continue;
    const ranked = rankCandidates(asRow(l), free);
    if (ranked.length > 0) candidates.set(l.id, ranked);
  }

  return { auto, candidates };
}
