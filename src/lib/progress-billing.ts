import type { InvoiceDocument } from "./database.types";

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

type DrawDocument = Pick<InvoiceDocument, "is_progress_draw" | "draw_number" | "subtotal">;

// Sum of subtotal (pre-tax) across a job's progress-draw invoices only -
// deliberately separate from calculateJobRevenue() (job-revenue.ts),
// which is about money actually *received* across every invoice linked
// to a job, draws or not (so it still correctly counts a stray non-draw
// invoice on the same job, e.g. a change order billed separately). This
// is specifically about what's been *billed* against the contract via
// draws. Pre-tax on purpose, matching contract_value - see
// 0030_progress_billing.sql: HST accumulating across draws shouldn't
// make a job look "over-billed" against a contract quoted pre-tax.
export function calculateInvoicedToDate(draws: DrawDocument[]): number {
  const total = draws
    .filter((d) => d.is_progress_draw)
    .reduce((sum, d) => sum + d.subtotal, 0);
  return round2(total);
}

// Generic contractValue-minus-x - the caller decides what "remaining"
// means by what it passes as the second argument: the Progress Billing
// tab's job-level stat passes receivedToDate ("how much is left to
// collect"), while a single progress invoice's own on-document summary
// passes totalBilledToDate ("how much of the contract is left to bill" as
// of that invoice - see document-detail.tsx). Can go negative if a job is
// billed/paid past its original contract value (e.g. an unrecorded change
// order) - callers decide how to display that rather than this function
// hiding it.
export function calculateRemainingBalance(
  contractValue: number,
  amountToDate: number,
): number {
  return round2(contractValue - amountToDate);
}
