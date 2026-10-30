import { NextResponse } from "next/server";
import { getAccountantApiContext } from "@/lib/accountant-api";
import {
  listAccountantBankAccounts,
  loadAccountantExpenses,
  loadAccountantBusiness,
} from "@/lib/accountant-portal-server";
import type { QuickBooksInvoicePayment } from "@/lib/csv";
import { selectAll } from "@/lib/select-all";

// Read-only. Everything the accountant export bundle is built from, for one
// inclusive "YYYY-MM-DD" range: the receipts, accounts, the range's invoices
// (explicit columns, no tokens or signer details) and every invoice's payments.
// The zip itself is assembled in the browser by the same code the owner's
// export uses; photos and the logo come from /signed-urls.
export async function GET(request: Request) {
  const result = await getAccountantApiContext();
  if ("response" in result) return result.response;
  const { db, admin, userId } = result.ctx;

  const { searchParams } = new URL(request.url);
  const from = searchParams.get("from");
  const to = searchParams.get("to");

  // The date range is part of each QUERY (not applied to a loaded list afterwards), and every query reads all
  // its pages, so neither the database's 1000-row page nor the 20,000-row ceiling can cut a range short.
  const [
    { rows: receipts },
    { rows: invoices },
    { rows: paymentDocs },
    bankAccounts,
    { business, logoPath },
  ] = await Promise.all([
    loadAccountantExpenses(db, { from, to }),
    selectAll(() => {
      let query = db
        .from("documents")
        .select(
          "id, type, status, document_number, issue_date, due_date, subtotal, hst_amount, total_amount, excluded_from_hst, is_progress_draw, draw_number, draw_percent_complete, draw_description, notes, client:clients(name, email, address), payments(*), items:document_items(*)",
        )
        .eq("type", "invoice");
      if (from) query = query.gte("issue_date", from);
      if (to) query = query.lte("issue_date", to);
      return query.order("issue_date", { ascending: true }).order("id", { ascending: true });
    }),
    // Every invoice's payments: a payment in the range can belong to an older invoice.
    selectAll(() =>
      db
        .from("documents")
        .select("document_number, excluded_from_hst, client:clients(name), payments(*)")
        .eq("type", "invoice")
        .order("id", { ascending: true }),
    ),
    listAccountantBankAccounts(db),
    loadAccountantBusiness(admin, userId),
  ]);

  // Same revenue-recognition rule as the owner's receipts page: real payments
  // in the range, skipping invoices excluded from HST.
  const invoicePayments: QuickBooksInvoicePayment[] = [];
  for (const doc of (paymentDocs ?? []) as unknown as {
    document_number: number;
    excluded_from_hst: boolean;
    client: { name: string } | null;
    payments: { paid_date: string; amount: number }[];
  }[]) {
    if (doc.excluded_from_hst) continue;
    for (const payment of doc.payments) {
      if (from && payment.paid_date < from) continue;
      if (to && payment.paid_date > to) continue;
      invoicePayments.push({
        paidDate: payment.paid_date,
        documentNumber: doc.document_number,
        clientName: doc.client?.name ?? "No client",
        amount: payment.amount,
      });
    }
  }

  return NextResponse.json({
    receipts,
    bankAccounts,
    invoices,
    paymentDocs,
    invoicePayments,
    business,
    hasLogo: !!logoPath,
  });
}
