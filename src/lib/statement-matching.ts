import { dayNumber, round2 } from "./statement-lines.ts";
import {
  STATEMENT_MATCH_WINDOW_DAYS,
  STATEMENT_TIE_MARGIN_DAYS,
  STATEMENT_VENDOR_WINDOW_DAYS,
} from "./statement-config.ts";
import { vendorKey } from "./merchant-name.ts";

// Matching between two sets of money rows that describe the same charge - used
// both ways: statement lines -> existing receipts (import), and a freshly
// scanned receipt -> statement-created expenses still waiting for a receipt
// (attach).
//
// Candidate kinds, best first:
//  - vendor: the SAME VENDOR and the exact same amount to the cent, dates within
//            STATEMENT_VENDOR_WINDOW_DAYS (30) either way. For bills and utilities,
//            which are invoiced before they are charged (a preauthorised debit:
//            invoice Feb 8, charge Feb 22). Needs a vendor on both sides.
//  - exact:  same amount to the cent, dates within MATCH_WINDOW_DAYS (3), vendor
//            unknown or different. (Merchant names between a receipt and a card
//            statement differ too much to REQUIRE them to agree - so without a
//            vendor match the old tight window applies.)
//  - near:   same amount but 4-7 days apart (a charge that posted late), or within
//            the window with an amount within $1 / 5% (a tip added after the
//            receipt printed, an FX rounding). A guess.
//
// Rules:
//  - Candidates are ranked vendor, then exact, then near; within a kind, the
//    nearest date first. A vendor-and-amount match always outranks a close-amount
//    guess, however far apart the dates are.
//  - Nothing is ever accepted silently on a tie. "Nearest wins" only when the
//    nearest candidate is clearly nearer than the runner-up of its kind: closer by
//    MORE than STATEMENT_TIE_MARGIN_DAYS (2). Within the margin it is a tie and the
//    person chooses.
//  - Auto-accept (import side) needs the pairing to be unambiguous from BOTH sides:
//    for a vendor match, each is the other's clear nearest (mutual nearest); for an
//    exact match, each is the other's only candidate. Near matches are never
//    auto-accepted. So matches are one-to-one, and two identical monthly bills pair
//    off by date instead of being asked about.

export interface MatchRow {
  id: string;
  /** YYYY-MM-DD */
  date: string;
  amount: number;
  /** The vendor's name as printed ("ROGERS *************3771", "Rogers Communications Canada Inc."). */
  vendor?: string | null;
}

export type MatchKind = "vendor" | "exact" | "near";

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

interface Prepared {
  row: MatchRow;
  day: number;
  cents: number;
  key: string | null;
}

function prepare(row: MatchRow): Prepared {
  return { row, day: dayNumber(row.date), cents: cents(row.amount), key: vendorKey(row.vendor) };
}

// Symmetric: the candidate describes `other` as seen from `target`.
function between(target: Prepared, other: Prepared): MatchCandidate | null {
  const dayDiff = Math.abs(target.day - other.day);
  const amountDiff = round2(Math.abs(target.row.amount - other.row.amount));
  const sameAmount = target.cents === other.cents;
  const id = other.row.id;

  if (sameAmount && target.key !== null && target.key === other.key && dayDiff <= STATEMENT_VENDOR_WINDOW_DAYS) {
    return { id, kind: "vendor", day_diff: dayDiff, amount_diff: 0 };
  }
  if (sameAmount && dayDiff <= STATEMENT_MATCH_WINDOW_DAYS) {
    return { id, kind: "exact", day_diff: dayDiff, amount_diff: 0 };
  }
  if (sameAmount && dayDiff <= NEAR_DAYS) {
    return { id, kind: "near", day_diff: dayDiff, amount_diff: 0 };
  }
  const tolerance = Math.max(NEAR_AMOUNT_FLAT, Math.abs(target.row.amount) * NEAR_AMOUNT_RATE);
  if (!sameAmount && dayDiff <= STATEMENT_MATCH_WINDOW_DAYS && amountDiff <= tolerance) {
    return { id, kind: "near", day_diff: dayDiff, amount_diff: amountDiff };
  }
  return null;
}

export function candidateFor(target: MatchRow, other: MatchRow): MatchCandidate | null {
  return between(prepare(target), prepare(other));
}

const KIND_ORDER: Record<MatchKind, number> = { vendor: 0, exact: 1, near: 2 };

function bestFirst(a: MatchCandidate, b: MatchCandidate): number {
  if (a.kind !== b.kind) return KIND_ORDER[a.kind] - KIND_ORDER[b.kind];
  if (a.amount_diff !== b.amount_diff) return a.amount_diff - b.amount_diff;
  return a.day_diff - b.day_diff;
}

/** Every candidate in `pool` for one target, best first. */
export function rankCandidates(target: MatchRow, pool: MatchRow[]): MatchCandidate[] {
  const t = prepare(target);
  const out: MatchCandidate[] = [];
  for (const row of pool) {
    const c = between(t, prepare(row));
    if (c) out.push(c);
  }
  return out.sort(bestFirst);
}

// Is the first entry of a ranked list a CLEAR winner - safe to preselect or accept?
//  - vendor: the nearest vendor match, and no other vendor match within the tie
//    margin of it. (Lower kinds don't count: a vendor-and-amount match outranks a
//    guess.)
//  - exact:  only if it is the one and only candidate (the original, stricter rule).
//  - near:   never.
function hasClearWinner(ranked: MatchCandidate[]): boolean {
  const top = ranked[0];
  if (!top) return false;
  if (top.kind === "near") return false;
  if (top.kind === "exact") return ranked.length === 1;
  const rival = ranked.find((c, i) => i > 0 && c.kind === "vendor");
  return !rival || rival.day_diff - top.day_diff > STATEMENT_TIE_MARGIN_DAYS;
}

/**
 * The candidate to PRESELECT in the attach dialog, or null when the person has to
 * choose. Preselection only - nothing is attached until they confirm.
 */
export function pickPreselect(ranked: MatchCandidate[]): string | null {
  return hasClearWinner(ranked) ? ranked[0].id : null;
}

export function matchRows(targets: MatchRow[], pool: MatchRow[]): MatchResult {
  const T = targets.map(prepare);
  const P = pool.map(prepare);

  const byTarget = new Map<string, MatchCandidate[]>();
  const byPool = new Map<string, MatchCandidate[]>();
  for (const t of T) {
    for (const p of P) {
      const c = between(t, p);
      if (!c) continue;
      (byTarget.get(t.row.id) ?? byTarget.set(t.row.id, []).get(t.row.id)!).push(c);
      // The same pairing seen from the pool row's side. A "near" match is NOT symmetric (its amount
      // tolerance is 5% of the TARGET's amount), so $100.00 can loosely match a $95.20 receipt while
      // $95.20 doesn't loosely match $100.00 - between(p, t) is then null. The pairing still exists, so
      // the pool row's view keeps it (same kind and distances): it counts as a rival candidate, exactly
      // as in the symmetric case. (Assuming it was never null made two lines near one receipt throw.)
      const back = between(p, t) ?? { ...c, id: t.row.id };
      (byPool.get(p.row.id) ?? byPool.set(p.row.id, []).get(p.row.id)!).push(back);
    }
  }
  for (const list of byTarget.values()) list.sort(bestFirst);
  for (const list of byPool.values()) list.sort(bestFirst);

  const auto = new Map<string, string>();
  const ask = new Map<string, MatchCandidate[]>();
  for (const [targetId, ranked] of byTarget) {
    const top = ranked[0];
    const poolSide = byPool.get(top.id) ?? [];
    const mutual =
      hasClearWinner(ranked) && hasClearWinner(poolSide) && poolSide[0].id === targetId && poolSide[0].kind === top.kind;
    if (mutual) auto.set(targetId, top.id);
    else ask.set(targetId, ranked);
  }

  // One-to-one: a receipt that was just auto-assigned to one target is no longer a
  // choice for any other (it would otherwise be offered for a line it can't have).
  const taken = new Set(auto.values());
  for (const [targetId, list] of ask) {
    const left = list.filter((c) => !taken.has(c.id));
    if (left.length === 0) ask.delete(targetId);
    else ask.set(targetId, left);
  }
  return { auto, ask };
}
