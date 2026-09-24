import type { InvoiceDocument, Payment } from "./database.types";

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

type RevenueDocument = Pick<InvoiceDocument, "type" | "subtotal" | "total_amount"> & {
  payments: Pick<Payment, "amount">[];
};

// Recognizes a job's invoiced revenue the same way hst-summary-card.tsx
// recognizes revenue for the HST Return Helper: pro-rated per payment
// actually received, not an invoice's full total or its "paid" status - a
// $500 deposit on a $1,000 invoice is $500 of recognized job revenue the
// moment it's received, not $0 until the invoice is fully paid (possibly
// after the job page is checked). Estimates never count, only invoices.
// excluded_from_hst is deliberately ignored here - that flag only opts an
// invoice out of the HST Return Helper's totals, it doesn't mean the money
// wasn't really received for this job.
export function calculateJobRevenue(documents: RevenueDocument[]): number {
  let total = 0;
  for (const doc of documents) {
    if (doc.type !== "invoice" || doc.total_amount <= 0) continue;
    const fraction = doc.subtotal / doc.total_amount;
    for (const payment of doc.payments) {
      total += fraction * payment.amount;
    }
  }
  return round2(total);
}

export interface JobCostSummary {
  totalExpenses: number;
  totalLaborCost: number;
  totalLaborRevenue: number;
  linkedInvoiceCount: number;
  jobRevenue: number;
  totalJobCost: number;
  estProfit: number;
}

type RevenueDocumentWithJob = RevenueDocument & { job_id: string | null };

// Same per-job figures as JobDetail's own math (see job-detail.tsx), just
// computed for every job at once from three flat, job_id-grouped fetches
// (receipts/hour_entries/documents-with-payments) instead of one job's
// already-scoped queries - lets the Jobs list's lg+ workstation preview
// switch between jobs instantly with no per-click fetch, matching how the
// Invoices/Estimates workstation already has every document's numbers
// on hand up front.
export function buildJobCostSummaries(
  jobIds: string[],
  receipts: { job_id: string | null; total_amount: number }[],
  hourEntries: { job_id: string; labor_cost: number; labor_revenue: number }[],
  documents: RevenueDocumentWithJob[],
): Map<string, JobCostSummary> {
  const summaries = new Map<string, JobCostSummary>();
  for (const id of jobIds) {
    summaries.set(id, {
      totalExpenses: 0,
      totalLaborCost: 0,
      totalLaborRevenue: 0,
      linkedInvoiceCount: 0,
      jobRevenue: 0,
      totalJobCost: 0,
      estProfit: 0,
    });
  }

  for (const r of receipts) {
    const s = r.job_id && summaries.get(r.job_id);
    if (s) s.totalExpenses = round2(s.totalExpenses + r.total_amount);
  }

  for (const h of hourEntries) {
    const s = summaries.get(h.job_id);
    if (s) {
      s.totalLaborCost = round2(s.totalLaborCost + h.labor_cost);
      s.totalLaborRevenue = round2(s.totalLaborRevenue + h.labor_revenue);
    }
  }

  const documentsByJob = new Map<string, RevenueDocumentWithJob[]>();
  for (const doc of documents) {
    if (!doc.job_id) continue;
    if (doc.type === "invoice") {
      const s = summaries.get(doc.job_id);
      if (s) s.linkedInvoiceCount += 1;
    }
    const list = documentsByJob.get(doc.job_id) ?? [];
    list.push(doc);
    documentsByJob.set(doc.job_id, list);
  }

  for (const [jobId, docs] of documentsByJob) {
    const s = summaries.get(jobId);
    if (s) s.jobRevenue = calculateJobRevenue(docs);
  }

  for (const s of summaries.values()) {
    s.totalJobCost = round2(s.totalExpenses + s.totalLaborCost);
    s.estProfit = round2(s.jobRevenue - s.totalJobCost);
  }

  return summaries;
}
