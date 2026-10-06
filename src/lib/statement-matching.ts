import { dayNumber, round2 } from "./statement-lines.ts";
import { STATEMENT_MATCH_WINDOW_DAYS } from "./statement-config.ts";

// Matching between two sets of money rows that describe the same charge - used
// both ways: statement lines -> existing receipts (import), and a freshly
// scanned receipt -> statement-created expenses still waiting for a receipt
// (attach). Date and amount only: merchant names differ too much between a
// receipt and a card statement to be trusted.
//
// Rules:
//  - exact:  same amount to the cent, dates within MATCH_WINDOW_DAYS.
//  - near:   same amount but dates 4-7 days apart (a charge that posted late), or
//            dates within the window with an amount within $1 / 5% (a tip added
//            after the receipt printed, an FX rounding).
//  - Auto-accept only when it is unambiguous both ways: the line has exactly
//    one candidate (an exact one, and no near ones) and that receipt is a
//    candidate for no other line. Everything else - ties, near matches - goes
//    to the user. Matches are one-to-one.

export interface MatchRow {
  id: string;
  /** YYYY-MM-DD */
  date: string;
  amount: number;
}

export type MatchKind = "exact" | "near";

export interface MatchCandidate {
  id: string;
  kind: MatchKind;
  /** Absolute difference in days. */
  day_diff: number;
  /** Absolute difference in dollars. */
  amount_diff: number;
}

export interface MatchResult {
  /** target id -> pool id, accepted without asking. */
  auto: Map<string, string>;
  /** target id -> candidates the user must choose from (best first). Never includes an auto match. */
  ask: Map<string, MatchCandidate[]>;
}

const NEAR_DAYS = 7;
const NEAR_AMOUNT_FLAT = 1;
const NEAR_AMOUNT_RATE = 0.05;

function cents(n: number): number {
  return Math.round(n * 100);
}

export function candidateFor(target: MatchRow, other: MatchRow): MatchCandidate | null {
  const dayDiff = Math.abs(dayNumber(target.date) - dayNumber(other.date));
  const amountDiff = round2(Math.abs(target.amount - other.amount));
  const sameAmount = cents(target.amount) === cents(other.amount);

  if (sameAmount && dayDiff <= STATEMENT_MATCH_WINDOW_DAYS) {
    return { id: other.id, kind: "exact", day_diff: dayDiff, amount_diff: 0 };
  }
  if (sameAmount && dayDiff <= NEAR_DAYS) {
    return { id: other.id, kind: "near", day_diff: dayDiff, amount_diff: 0 };
  }
  const tolerance = Math.max(NEAR_AMOUNT_FLAT, Math.abs(target.amount) * NEAR_AMOUNT_RATE);
  if (!sameAmount && dayDiff <= STATEMENT_MATCH_WINDOW_DAYS && amountDiff <= tolerance) {
    return { id: other.id, kind: "near", day_diff: dayDiff, amount_diff: amountDiff };
  }
  return null;
}

function bestFirst(a: MatchCandidate, b: MatchCandidate): number {
  if (a.kind !== b.kind) return a.kind === "exact" ? -1 : 1;
  if (a.amount_diff !== b.amount_diff) return a.amount_diff - b.amount_diff;
  return a.day_diff - b.day_diff;
}

/** Every candidate in `pool` for one target, best first. */
export function rankCandidates(target: MatchRow, pool: MatchRow[]): MatchCandidate[] {
  const out: MatchCandidate[] = [];
  for (const row of pool) {
    const c = candidateFor(target, row);
    if (c) out.push(c);
  }
  return out.sort(bestFirst);
}

export function matchRows(targets: MatchRow[], pool: MatchRow[]): MatchResult {
  const byTarget = new Map<string, MatchCandidate[]>();
  const targetsPerPoolRow = new Map<string, number>();

  for (const target of targets) {
    const ranked = rankCandidates(target, pool);
    if (ranked.length === 0) continue;
    byTarget.set(target.id, ranked);
    for (const c of ranked) targetsPerPoolRow.set(c.id, (targetsPerPoolRow.get(c.id) ?? 0) + 1);
  }

  const auto = new Map<string, string>();
  const ask = new Map<string, MatchCandidate[]>();
  for (const [targetId, ranked] of byTarget) {
    const only = ranked.length === 1 ? ranked[0] : null;
    if (only && only.kind === "exact" && targetsPerPoolRow.get(only.id) === 1) {
      auto.set(targetId, only.id);
    } else {
      ask.set(targetId, ranked);
    }
  }
  return { auto, ask };
}
