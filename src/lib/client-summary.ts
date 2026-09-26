import type { InvoiceDocument, Payment } from "./database.types";

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

type ClientDocument = Pick<InvoiceDocument, "type" | "total_amount" | "issue_date"> & {
  client_id: string | null;
  payments: Pick<Payment, "amount">[];
};

export interface ClientSummary {
  invoiceCount: number;
  estimateCount: number;
  totalInvoiced: number;
  /** Actual dollars received across every invoice for this client - a raw
   * sum of payments.amount, not the HST calculator's pro-rated recognition
   * (that split only matters for the tax module, see lib/hst.ts). */
  totalRevenue: number;
  outstandingBalance: number;
  lastActivity: string | null;
}

const EMPTY_SUMMARY: ClientSummary = {
  invoiceCount: 0,
  estimateCount: 0,
  totalInvoiced: 0,
  totalRevenue: 0,
  outstandingBalance: 0,
  lastActivity: null,
};

// Every client's invoice/estimate history rollup, computed once from a flat
// client_id-grouped documents fetch (mirrors buildJobCostSummaries in
// lib/job-revenue.ts) so the Clients list's lg+ workstation preview can
// switch between clients instantly instead of fetching per click.
export function buildClientSummaries(
  clientIds: string[],
  documents: ClientDocument[],
): Map<string, ClientSummary> {
  const summaries = new Map<string, ClientSummary>();
  for (const id of clientIds) {
    summaries.set(id, { ...EMPTY_SUMMARY });
  }

  for (const doc of documents) {
    const s = doc.client_id && summaries.get(doc.client_id);
    if (!s) continue;

    if (doc.type === "invoice") {
      s.invoiceCount += 1;
      s.totalInvoiced = round2(s.totalInvoiced + doc.total_amount);
      const paid = doc.payments.reduce((sum, p) => sum + p.amount, 0);
      s.totalRevenue = round2(s.totalRevenue + paid);
    } else {
      s.estimateCount += 1;
    }

    if (!s.lastActivity || doc.issue_date > s.lastActivity) {
      s.lastActivity = doc.issue_date;
    }
  }

  for (const s of summaries.values()) {
    s.outstandingBalance = round2(Math.max(s.totalInvoiced - s.totalRevenue, 0));
  }

  return summaries;
}

export function getEmptyClientSummary(): ClientSummary {
  return { ...EMPTY_SUMMARY };
}
