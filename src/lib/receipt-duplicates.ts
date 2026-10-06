// "Have I already saved this receipt?" - the pure rules behind the soft duplicate warning that
// appears in the scan review dialog. A WARNING only: nothing here ever blocks a save.
//
// A new scan is a possible duplicate of an existing receipt when ALL of these hold:
//   - the same merchant, once cleaned (vendorKey - the one vendor-identity rule the statement
//     matcher uses too, so the two can never disagree about who a merchant is),
//   - the same total, to the cent,
//   - a date within DUPLICATE_WINDOW_DAYS (2) either way.
//
// Deliberately NOT fuzzy: "The Home Depot" and "Home Depot" are different here (a leading "the" is
// not stripped), so that pair is missed. A miss costs little - it is a soft warning, and the exact
// same file is caught separately by its hash - while a looser rule would warn about things that
// aren't duplicates ("Shell" and "Shell Energy" stay different). Pure (its one import is pure too),
// so it unit-tests directly.

import { vendorKey } from "./merchant-name.ts";

export const DUPLICATE_WINDOW_DAYS = 2;
export const MAX_DUPLICATE_MATCHES = 3;

export interface DuplicateSummary {
  id: string;
  merchant_name: string;
  transaction_date: string;
  total_amount: number;
}

export interface SimilarCandidate {
  merchant: string;
  total: number;
  /** YYYY-MM-DD */
  date: string;
}

const DAY_MS = 86_400_000;
function dayNumber(isoDate: string): number {
  return Math.round(new Date(`${isoDate}T00:00:00Z`).getTime() / DAY_MS);
}
const cents = (n: number) => Math.round(n * 100);

export function similarReceipts<T extends DuplicateSummary & { no_receipt?: boolean | null }>(
  candidate: SimilarCandidate,
  rows: T[],
  options: { windowDays?: number; limit?: number } = {},
): DuplicateSummary[] {
  const windowDays = options.windowDays ?? DUPLICATE_WINDOW_DAYS;
  const limit = options.limit ?? MAX_DUPLICATE_MATCHES;
  const key = vendorKey(candidate.merchant);
  if (key === null || !(candidate.total > 0) || !/^\d{4}-\d{2}-\d{2}$/.test(candidate.date)) return [];

  const day = dayNumber(candidate.date);
  return rows
    .filter(
      (r) =>
        // A statement expense still waiting for its receipt isn't a saved receipt - it is what a
        // scan is meant to be attached to.
        r.no_receipt !== true &&
        r.total_amount > 0 &&
        cents(r.total_amount) === cents(candidate.total) &&
        Math.abs(dayNumber(r.transaction_date) - day) <= windowDays &&
        vendorKey(r.merchant_name) === key,
    )
    .map((r) => ({ r, diff: Math.abs(dayNumber(r.transaction_date) - day) }))
    .sort((a, b) => a.diff - b.diff || (a.r.transaction_date < b.r.transaction_date ? 1 : -1))
    .slice(0, limit)
    .map(({ r }) => ({
      id: r.id,
      merchant_name: r.merchant_name,
      transaction_date: r.transaction_date,
      total_amount: r.total_amount,
    }));
}
