// "Have I already saved this receipt?" - the pure rules behind the soft duplicate warning that
// appears in the scan review dialog. A WARNING only: nothing here ever blocks a save.
//
// A new scan is a possible duplicate of an existing receipt when ALL of these hold:
//   - the same merchant, once cleaned (vendorKey - the one vendor-identity rule the statement
//     matcher uses too, so the two can never disagree about who a merchant is),
//   - the same total, to the cent,
//   - a date within DUPLICATE_WINDOW_DAYS (2) either way.
//
// Stronger than all of that: the SAME INVOICE / RECEIPT NUMBER from the same merchant
// (invoiceNumberMatches below). A supplier's invoice number is unique to that invoice, so a match is
// a duplicate even when the total or the date differs (a corrected or re-issued copy); it outranks
// the rule above, and is skipped entirely when the number is blank.
//
// Deliberately NOT fuzzy: "The Home Depot" and "Home Depot" are different here (a leading "the" is
// not stripped), so that pair is missed. A miss costs little - it is a soft warning, and the exact
// same file is caught separately by its hash - while a looser rule would warn about things that
// aren't duplicates ("Shell" and "Shell Energy" stay different). Pure (its one import is pure too),
// so it unit-tests directly.

import { normalizeInvoiceNumber } from "./invoice-number.ts";
import { vendorKey } from "./merchant-name.ts";
import { rankCandidates } from "./statement-matching.ts";

export const DUPLICATE_WINDOW_DAYS = 2;
export const MAX_DUPLICATE_MATCHES = 3;

export interface DuplicateSummary {
  id: string;
  merchant_name: string;
  transaction_date: string;
  total_amount: number;
}

// A saved expense with the same invoice / receipt number and merchant as the one being entered.
export interface InvoiceNumberMatch extends DuplicateSummary {
  invoice_number: string;
  /** True when the saved expense's total equals the new one's, to the cent. */
  same_total: boolean;
}

export interface InvoiceNumberCandidate {
  merchant: string;
  invoice_number: string | null | undefined;
  /** The new expense's total, if known (0 / NaN = unknown; only used for the wording). */
  total: number;
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

// ---------------------------------------------------------------------------
// "This charge already has a receipt attached"
// ---------------------------------------------------------------------------
// A statement import creates an expense for each card charge, and scanning its receipt attaches
// the photo to that expense (the attach flow only ever offers expenses still WAITING for one). If
// the same invoice is scanned again, the charge already has its receipt: saving the scan as a NEW
// expense would count the charge twice, and nothing else would say so. This finds those expenses,
// with the statement matcher's own rule for "same vendor, same amount": the same vendor and the
// exact same amount, within STATEMENT_VENDOR_WINDOW_DAYS (30) either way - which covers a bill
// invoiced before it is charged (invoice Feb 8, charge Feb 22). Only that kind: a same-amount
// charge at a DIFFERENT merchant a couple of days apart is a coincidence, not a duplicate, and a
// warning saying "you'd count it twice" has to be right.

export interface AttachedSummary extends DuplicateSummary {
  /** The day the receipt was attached to it (YYYY-MM-DD), when known. */
  attached_on: string | null;
}

export interface StatementExpenseRow extends DuplicateSummary {
  from_statement?: boolean | null;
  no_receipt?: boolean | null;
  receipt_attached_at?: string | null;
}

export function attachedStatementMatches(
  candidate: SimilarCandidate,
  rows: StatementExpenseRow[],
  options: { limit?: number } = {},
): AttachedSummary[] {
  const limit = options.limit ?? MAX_DUPLICATE_MATCHES;
  if (vendorKey(candidate.merchant) === null || !(candidate.total > 0) || !/^\d{4}-\d{2}-\d{2}$/.test(candidate.date)) {
    return [];
  }
  // Created by a statement import AND already carrying a receipt (still-waiting ones are what the
  // attach flow is for; ordinary receipts are the soft check's job).
  const attached = rows.filter((r) => r.from_statement === true && r.no_receipt === false && r.total_amount > 0);
  const byId = new Map(attached.map((r) => [r.id, r]));
  const ranked = rankCandidates(
    { id: "scan", date: candidate.date, amount: candidate.total, vendor: candidate.merchant },
    attached.map((r) => ({ id: r.id, date: r.transaction_date, amount: r.total_amount, vendor: r.merchant_name })),
  );
  return ranked
    .filter((c) => c.kind === "vendor")
    .slice(0, limit)
    .map((c) => {
      const r = byId.get(c.id)!;
      return {
        id: r.id,
        merchant_name: r.merchant_name,
        transaction_date: r.transaction_date,
        total_amount: r.total_amount,
        attached_on: r.receipt_attached_at ? r.receipt_attached_at.slice(0, 10) : null,
      };
    });
}

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

// ---------------------------------------------------------------------------
// "This invoice number is already saved for this merchant"
// ---------------------------------------------------------------------------
// Same normalized number (upper case, letters and digits only, leading zeros dropped - see
// normalizeInvoiceNumber) AND the same cleaned merchant (vendorKey, the one vendor-identity rule).
// Not checked when the number is blank, or the merchant has no usable name: the same number from
// two different merchants is a coincidence, not a duplicate. The date and the total are ignored on
// purpose - a matching number with a different total still warns (`same_total` says which, so the
// wording can). Statement expenses still waiting for a receipt are included: a number someone typed
// on one is still a record of that invoice.
export function invoiceNumberMatches<T extends DuplicateSummary & { invoice_number?: string | null }>(
  candidate: InvoiceNumberCandidate,
  rows: T[],
  options: { limit?: number } = {},
): InvoiceNumberMatch[] {
  const limit = options.limit ?? MAX_DUPLICATE_MATCHES;
  const number = normalizeInvoiceNumber(candidate.invoice_number);
  const vendor = vendorKey(candidate.merchant);
  if (number === null || vendor === null) return [];

  const totalKnown = candidate.total > 0;
  return rows
    .filter((r) => normalizeInvoiceNumber(r.invoice_number) === number && vendorKey(r.merchant_name) === vendor)
    .map((r) => ({
      id: r.id,
      merchant_name: r.merchant_name,
      transaction_date: r.transaction_date,
      total_amount: r.total_amount,
      invoice_number: (r.invoice_number ?? "").trim(),
      same_total: totalKnown && cents(r.total_amount) === cents(candidate.total),
    }))
    .sort(
      (a, b) =>
        Number(b.same_total) - Number(a.same_total) || (a.transaction_date < b.transaction_date ? 1 : -1),
    )
    .slice(0, limit);
}

// The warning's wording, kept here (pure) so the "total differs" rule is unit-tested. `money` formats
// an amount for display. It always ends by saying the person can just save.
export function invoiceNumberWarningText(
  matches: InvoiceNumberMatch[],
  candidateTotal: number,
  money: (n: number) => string,
): { title: string; detail: string } | null {
  if (matches.length === 0) return null;
  const title = "This invoice number is already saved";
  const m = matches[0];
  const same = `${m.merchant_name} invoice ${m.invoice_number}`;
  if (matches.length > 1) {
    return { title, detail: `You already have several expenses for ${same}. If this is a different document, just save it.` };
  }
  if (m.same_total) {
    return {
      title,
      detail: `You already saved ${same} (${money(m.total_amount)}). If this is a different document, just save it.`,
    };
  }
  const totals =
    candidateTotal > 0
      ? `the total differs: ${money(m.total_amount)} saved, ${money(candidateTotal)} here`
      : `its saved total is ${money(m.total_amount)}`;
  return {
    title,
    detail: `You already saved ${same}, but ${totals}. It may be a corrected or re-issued copy. If it is a different document, just save it.`,
  };
}
