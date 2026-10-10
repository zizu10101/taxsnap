import { NextResponse } from "next/server";
import { getAccountantApiContext } from "@/lib/accountant-api";
import {
  listAccountantBankAccounts,
  listAccountantExpenses,
  loadAccountantBusiness,
} from "@/lib/accountant-portal-server";
import type { QuickBooksInvoicePayment } from "@/lib/csv";

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

  const allReceipts = await listAccountantExpenses(db);
  const receipts = allReceipts.filter(
    (r) => (!from || r.transaction_date >= from) && (!to || r.transaction_date <= to),
  );

  let invoiceQuery = db
    .from("documents")
    .select(
      "id, type, status, document_number, issue_date, due_date, subtotal, hst_amount, total_amount, excluded_from_hst, is_progress_draw, draw_number, draw_percent_complete, draw_description, notes, client:clients(name, email, address), payments(*), items:document_items(*)",
    )
    .eq("type", "invoice")
    .order("issue_date", { ascending: true });
  if (from) invoiceQuery = invoiceQuery.gte("issue_date", from);
  if (to) invoiceQuery = invoiceQuery.lte("issue_date", to);

  const [{ data: invoices }, { data: paymentDocs }, bankAccounts, { business, logoPath }] =
    await Promise.all([
      invoiceQuery,
      db
        .from("documents")
        .select("document_number, excluded_from_hst, client:clients(name), payments(*)")
        .eq("type", "invoice"),
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
    invoices: invoices ?? [],
    paymentDocs: paymentDocs ?? [],
    invoicePayments,
    business,
    hasLogo: !!logoPath,
  });
}
