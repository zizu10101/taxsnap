import { recognizePayments } from "./payment-revenue.ts";

// Revenue report. Revenue is payments RECEIVED in the period (pro-rated to the
// pre-tax part, invoices excluded from HST left out) - recognizePayments, the
// rule the P&L and the HST helper use. Invoice totals are never revenue here;
// "Invoiced" is its own column. Everything is before HST so the three figures
// line up: Outstanding = Invoiced - Received.

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export interface RevenueInvoiceInput {
  id: string;
  document_number: number;
  status: string;
  issue_date: string;
  subtotal: number;
  total_amount: number;
  excluded_from_hst: boolean;
  client_id: string | null;
  job_id: string | null;
  client: { name: string } | null;
  job: { name: string } | null;
  payments: { id: string; amount: number; paid_date: string }[];
}

export interface RevenuePaymentRow {
  paymentId: string;
  paidDate: string;
  documentId: string;
  documentNumber: number;
  // The payment as received, and the pre-tax part that counts as revenue.
  amount: number;
  revenue: number;
}

export interface RevenueInvoiceRow {
  id: string;
  number: number;
  issueDate: string;
  status: string;
  subtotal: number;
}

export interface RevenueGroup {
  // null = the "No client" / "No job" bucket.
  id: string | null;
  name: string;
  invoices: number;
  invoiced: number;
  received: number;
  outstanding: number;
  payments: RevenuePaymentRow[];
  documents: RevenueInvoiceRow[];
}

export interface RevenueMonth {
  month: string; // YYYY-MM
  invoiced: number;
  received: number;
  outstanding: number;
}

export interface RevenueReport {
  summary: { received: number; invoiced: number; outstanding: number };
  byClient: RevenueGroup[];
  byJob: RevenueGroup[];
  byMonth: RevenueMonth[];
}

export const NO_CLIENT_NAME = "No client";
export const NO_JOB_NAME = "No job";

const inRange = (d: string, from: string | null, to: string | null) =>
  (!from || d >= from) && (!to || d <= to);

export function buildRevenueReport(
  invoices: RevenueInvoiceInput[],
  from: string | null,
  to: string | null,
): RevenueReport {
  const { totalSales, payments } = recognizePayments(invoices, from, to);

  // Issued in the period: not a draft, not excluded from HST (same exclusion as
  // revenue, or Outstanding would compare unlike things).
  const issued = invoices.filter(
    (d) => !d.excluded_from_hst && d.status !== "draft" && inRange(d.issue_date, from, to),
  );
  const invoiced = round2(issued.reduce((s, d) => s + d.subtotal, 0));

  function group(
    pick: (d: RevenueInvoiceInput) => { id: string | null; name: string },
  ): RevenueGroup[] {
    const map = new Map<string, RevenueGroup>();
    const get = (d: RevenueInvoiceInput) => {
      const { id, name } = pick(d);
      const key = id ?? "";
      let g = map.get(key);
      if (!g) {
        g = { id, name, invoices: 0, invoiced: 0, received: 0, outstanding: 0, payments: [], documents: [] };
        map.set(key, g);
      }
      return g;
    };
    for (const d of issued) {
      const g = get(d);
      g.invoices += 1;
      g.invoiced += d.subtotal;
      g.documents.push({
        id: d.id,
        number: d.document_number,
        issueDate: d.issue_date,
        status: d.status,
        subtotal: round2(d.subtotal),
      });
    }
    for (const p of payments) {
      const g = get(p.doc);
      g.received += p.subtotalAmount;
      g.payments.push({
        paymentId: p.payment.id,
        paidDate: p.paidDate,
        documentId: p.doc.id,
        documentNumber: p.doc.document_number,
        amount: p.payment.amount,
        revenue: p.subtotalAmount,
      });
    }
    return [...map.values()]
      .map((g) => ({
        ...g,
        invoiced: round2(g.invoiced),
        received: round2(g.received),
        outstanding: round2(g.invoiced - g.received),
        payments: g.payments.sort((a, b) => (a.paidDate < b.paidDate ? 1 : -1)),
        documents: g.documents.sort((a, b) => (a.issueDate < b.issueDate ? 1 : -1)),
      }))
      .sort((a, b) => b.received - a.received || b.invoiced - a.invoiced || a.name.localeCompare(b.name));
  }

  const months = new Map<string, { invoiced: number; received: number }>();
  const month = (m: string) => {
    let v = months.get(m);
    if (!v) months.set(m, (v = { invoiced: 0, received: 0 }));
    return v;
  };
  for (const d of issued) month(d.issue_date.slice(0, 7)).invoiced += d.subtotal;
  for (const p of payments) month(p.paidDate.slice(0, 7)).received += p.subtotalAmount;

  return {
    summary: { received: totalSales, invoiced, outstanding: round2(invoiced - totalSales) },
    byClient: group((d) => ({ id: d.client_id, name: d.client?.name?.trim() || NO_CLIENT_NAME })),
    byJob: group((d) => ({ id: d.job_id, name: d.job?.name?.trim() || NO_JOB_NAME })),
    byMonth: [...months.entries()]
      .sort((a, b) => (a[0] < b[0] ? -1 : 1))
      .map(([m, v]) => ({
        month: m,
        invoiced: round2(v.invoiced),
        received: round2(v.received),
        outstanding: round2(v.invoiced - v.received),
      })),
  };
}
