// Pure rules for what a client sees in their portal. No imports beyond types,
// so it unit-tests with plain `node --test` (client-portal.test.ts).
//
// Scope, by design: estimates and invoices that were actually issued to this
// client (anything past 'draft'), and the client's own balance on invoices.
// Pending change orders live in contract_changes, never in `documents`, so
// they can't appear here - one only shows up once it has been billed, as an
// ordinary invoice. No job, cost, labor or material data is ever selected.

import type { DateRange } from "./date-range";

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

// The ONLY documents columns the portal reads. Explicit, never "*": a column
// added to `documents` tomorrow (tokens, signer IP, job_id, ...) stays
// invisible to clients until someone adds it here on purpose.
export const PORTAL_DOCUMENT_COLUMNS =
  "id, type, status, document_number, issue_date, due_date, subtotal, hst_amount, total_amount, is_progress_draw, draw_number, payments(amount)";

export type PortalDocType = "invoice" | "estimate";

export interface PortalDocumentRow {
  id: string;
  type: PortalDocType;
  status: "sent" | "partial" | "paid";
  document_number: number;
  issue_date: string;
  due_date: string | null;
  total_amount: number;
  // Sum of payments logged against this document (always 0 for an estimate).
  paid: number;
  // What is still owed on this one invoice, never negative. 0 for estimates.
  balance: number;
}

interface RawPortalDocument {
  id: string;
  type: PortalDocType;
  status: string;
  document_number: number;
  issue_date: string;
  due_date: string | null;
  total_amount: number;
  payments?: { amount: number }[] | null;
}

// "Sent to them" means no longer a draft.
export function isIssuedToClient(status: string): boolean {
  return status !== "draft";
}

export function invoiceBalance(total: number, paid: number): number {
  return round2(Math.max(total - paid, 0));
}

export function toPortalRow(raw: RawPortalDocument): PortalDocumentRow | null {
  if (!isIssuedToClient(raw.status)) return null;
  const isInvoice = raw.type === "invoice";
  const paid = isInvoice
    ? round2((raw.payments ?? []).reduce((sum, p) => sum + p.amount, 0))
    : 0;
  return {
    id: raw.id,
    type: raw.type,
    status: raw.status as PortalDocumentRow["status"],
    document_number: raw.document_number,
    issue_date: raw.issue_date,
    due_date: raw.due_date,
    total_amount: raw.total_amount,
    paid,
    balance: isInvoice ? invoiceBalance(raw.total_amount, paid) : 0,
  };
}

export interface PortalBalance {
  invoiced: number;
  paid: number;
  // Per-invoice clamped, so one overpaid invoice never hides what is owed on
  // another. Invoices only: estimates never contribute.
  outstanding: number;
}

// Whole-account figures. Deliberately not date-filtered: a client's
// Outstanding Balance is what they owe now, whatever window the list is
// showing.
export function summarizePortalBalance(rows: PortalDocumentRow[]): PortalBalance {
  let invoiced = 0;
  let paid = 0;
  let outstanding = 0;
  for (const row of rows) {
    if (row.type !== "invoice") continue;
    invoiced += row.total_amount;
    paid += row.paid;
    outstanding += row.balance;
  }
  return { invoiced: round2(invoiced), paid: round2(paid), outstanding: round2(outstanding) };
}

export interface PortalRangeSummary {
  count: number;
  invoiceCount: number;
  estimateCount: number;
  // Invoices issued in the window. Estimates are never added in.
  invoicedInRange: number;
}

export function filterPortalRows(rows: PortalDocumentRow[], range: DateRange): PortalDocumentRow[] {
  return rows.filter((row) => {
    if (range.start && row.issue_date < range.start) return false;
    if (range.end && row.issue_date > range.end) return false;
    return true;
  });
}

export function summarizePortalRange(rows: PortalDocumentRow[]): PortalRangeSummary {
  let invoiceCount = 0;
  let estimateCount = 0;
  let invoicedInRange = 0;
  for (const row of rows) {
    if (row.type === "invoice") {
      invoiceCount += 1;
      invoicedInRange += row.total_amount;
    } else {
      estimateCount += 1;
    }
  }
  return {
    count: rows.length,
    invoiceCount,
    estimateCount,
    invoicedInRange: round2(invoicedInRange),
  };
}
