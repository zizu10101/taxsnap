import type { DocumentWithRelations, Receipt } from "@/lib/database.types";
import { formatDocumentNumber } from "./document-number.ts";
import { TAX_BASIS_LABELS, taxBasis } from "./tax-codes.ts";

function escapeCsvField(value: string | number): string {
  const str = String(value);
  if (/[",\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

// Builds an IRS/Schedule-C friendly CSV: one row per receipt, with running
// totals for gross spend and deductible sales tax, grouped implicitly by
// the tax_category column so it's easy to pivot in a spreadsheet.
//
// "Paid With" (the account/card an expense was paid with, resolved through
// accountNames) is appended as the LAST column, after Notes, so a spreadsheet
// or pivot already built on the original seven columns keeps working.
export function receiptsToCsv(
  receipts: Receipt[],
  accountNames: Map<string, string> = new Map(),
): string {
  const header = [
    "Date",
    "Merchant",
    "Category",
    "Total Amount",
    "Sales Tax",
    "Deductible Amount",
    "Notes",
    "Paid With",
    "Tax Basis",
  ];

  const rows = receipts.map((r) => {
    const items = Array.isArray(r.items) ? r.items : [];
    const notes = items
      .map((i) => (i.amount ? `${i.name} ($${i.amount.toFixed(2)})` : i.name))
      .join("; ");
    return [
      r.transaction_date,
      r.merchant_name,
      r.tax_category,
      r.total_amount.toFixed(2),
      r.tax_amount.toFixed(2),
      r.total_amount.toFixed(2),
      notes,
      (r.paid_with_account_id && accountNames.get(r.paid_with_account_id)) || "",
      // "Calculated from statement" (tax worked out from a card statement, no receipt yet) or
      // "Confirmed by receipt" (a scanned/attached receipt, or a figure the owner entered).
      TAX_BASIS_LABELS[taxBasis(r)],
    ];
  });

  const totalAmount = receipts.reduce((sum, r) => sum + r.total_amount, 0);
  const totalTax = receipts.reduce((sum, r) => sum + r.tax_amount, 0);
  const totalsRow = [
    "",
    "",
    "TOTAL",
    totalAmount.toFixed(2),
    totalTax.toFixed(2),
    totalAmount.toFixed(2),
    "",
    "",
    "",
  ];

  const lines = [header, ...rows, totalsRow].map((row) =>
    row.map(escapeCsvField).join(","),
  );

  return lines.join("\n");
}

// "YYYY-MM-DD" -> "MM/DD/YYYY" via plain string manipulation, not a Date
// round-trip - a Date parse/reformat risks the exact UTC-vs-local
// off-by-one-day bug date-range.ts's own toIsoDate comment warns about,
// for a value that's already an unambiguous plain date string.
function toQuickBooksDate(dateStr: string): string {
  const [year, month, day] = dateStr.split("-");
  return `${month}/${day}/${year}`;
}

// One real payment received against an invoice (including a progress-
// billing draw, which is just a documents.type === 'invoice' row) - the
// caller is responsible for filtering to the export's date range and
// dropping any documents.excluded_from_hst invoice, same as
// hst-summary-card.tsx's own filteredRecognizedPayments does for the HST
// calculator, so this can't disagree with what that card reports.
export interface QuickBooksInvoicePayment {
  paidDate: string;
  documentNumber: number;
  clientName: string;
  amount: number;
}

// QuickBooks Online/Desktop's bank-transaction CSV import matches columns
// by exact header text, not by position or fuzzy matching - "Date",
// "Description", "Payment", "Deposit" are the only four names it
// recognizes, so don't rename them even for clarity. Receipts are always
// an expense in this app (Payment column), invoice payments are always
// income (Deposit column) - each row only ever fills one of the two,
// leaving the other blank, because QuickBooks expects both columns to
// exist on every row regardless.
//
// invoicePayments defaults to empty so the Expenses page's existing
// expense-only export keeps working unchanged; only the Overview page
// passes real invoice payments through, pairing revenue with expenses in
// one ledger. Rows are sorted by date (expenses and invoice payments
// merged together) since QuickBooks' importer reads more sensibly as a
// chronological ledger than two blocks concatenated by source.
//
// Deliberately no totals row (unlike receiptsToCsv's own TOTAL row) - an
// extra summary row with no real date would either get rejected by
// QuickBooks' importer or, worse, get misread as a genuine dateless
// transaction, corrupting the import. Every row here must be a real,
// importable transaction.
export function receiptsToQuickBooksCsv(
  receipts: Receipt[],
  invoicePayments: QuickBooksInvoicePayment[] = [],
): string {
  const header = ["Date", "Description", "Payment", "Deposit"];

  // A refund (a card-statement import saves one as an expense with a negative
  // total) is money coming back, so it goes in the Deposit column as a positive
  // number - never a negative in Payment, which QuickBooks' importer doesn't
  // treat as a credit. Labeled "Refund" so it can be categorized against the
  // original expense rather than mistaken for income.
  const expenseRows = receipts.map((r) => {
    const isRefund = r.total_amount < 0;
    const amount = Math.abs(r.total_amount).toFixed(2);
    return {
      date: r.transaction_date,
      row: [
        toQuickBooksDate(r.transaction_date),
        `${isRefund ? "Refund - " : ""}${r.merchant_name} - ${r.tax_category}`,
        isRefund ? "" : amount,
        isRefund ? amount : "",
      ],
    };
  });

  const revenueRows = invoicePayments.map((p) => ({
    date: p.paidDate,
    row: [
      toQuickBooksDate(p.paidDate),
      `Invoice ${formatDocumentNumber("invoice", p.documentNumber)} - ${p.clientName}`,
      "",
      p.amount.toFixed(2),
    ],
  }));

  const rows = [...expenseRows, ...revenueRows]
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
    .map((entry) => entry.row);

  const lines = [header, ...rows].map((row) => row.map(escapeCsvField).join(","));
  return lines.join("\n");
}

// One row per invoice, alongside the accountant export's receipt CSV -
// "Paid to Date"/"Balance Due" are derived from the same payments array
// the invoice detail view and PDF already use, not a separate query, so
// this can't disagree with what's shown on screen for the same invoice.
//
// "Deposited To" lists the distinct bank accounts this invoice's payments went
// into (payments.bank_account_id, resolved through bankAccountNames), joined
// with "; " - blank when no payment named one. The per-payment detail is in
// payments.csv.
export function invoicesToCsv(
  documents: DocumentWithRelations[],
  bankAccountNames: Map<string, string> = new Map(),
): string {
  const header = [
    "Issue Date",
    "Client",
    "Status",
    "Subtotal",
    "HST",
    "Total",
    "Paid to Date",
    "Balance Due",
    "Deposited To",
  ];

  const rows = documents.map((d) => {
    const paid = d.payments.reduce((sum, p) => sum + p.amount, 0);
    const depositedTo = [
      ...new Set(
        d.payments
          .map((p) => (p.bank_account_id ? bankAccountNames.get(p.bank_account_id) : undefined))
          .filter((name): name is string => !!name),
      ),
    ].join("; ");
    return [
      d.issue_date,
      d.client?.name ?? "—",
      d.status,
      d.subtotal.toFixed(2),
      d.hst_amount.toFixed(2),
      d.total_amount.toFixed(2),
      paid.toFixed(2),
      (d.total_amount - paid).toFixed(2),
      depositedTo,
    ];
  });

  const totalAmount = documents.reduce((sum, d) => sum + d.total_amount, 0);
  const totalPaid = documents.reduce(
    (sum, d) => sum + d.payments.reduce((s, p) => s + p.amount, 0),
    0,
  );
  const totalsRow = [
    "",
    "",
    "TOTAL",
    "",
    "",
    totalAmount.toFixed(2),
    totalPaid.toFixed(2),
    (totalAmount - totalPaid).toFixed(2),
    "",
  ];

  const lines = [header, ...rows, totalsRow].map((row) =>
    row.map(escapeCsvField).join(","),
  );

  return lines.join("\n");
}

// One real payment received against an invoice, for matching against bank
// deposits. Unlike receiptsToQuickBooksCsv's invoicePayments this keeps
// payments on invoices excluded from the HST helper (a reimbursement still
// hit the bank) and flags them in their own column instead of dropping them.
export interface PaymentExportRow {
  paidDate: string;
  documentNumber: number;
  clientName: string;
  amount: number;
  method: string | null;
  depositedTo: string | null;
  note: string | null;
  excludedFromHst: boolean;
}

export function paymentsToCsv(payments: PaymentExportRow[]): string {
  const header = [
    "Date Received",
    "Invoice",
    "Client",
    "Amount",
    "Method",
    "Deposited To",
    "Note",
    "Excluded From HST",
  ];

  const rows = payments.map((p) => [
    p.paidDate,
    formatDocumentNumber("invoice", p.documentNumber),
    p.clientName,
    p.amount.toFixed(2),
    p.method ?? "",
    p.depositedTo ?? "",
    p.note ?? "",
    p.excludedFromHst ? "Yes" : "No",
  ]);

  const total = payments.reduce((sum, p) => sum + p.amount, 0);
  const totalsRow = ["", "", "TOTAL", total.toFixed(2), "", "", "", ""];

  return [header, ...rows, totalsRow].map((row) => row.map(escapeCsvField).join(",")).join("\n");
}

export function downloadCsv(filename: string, csv: string) {
  // Prefix with a BOM so Excel opens the UTF-8 file without mangling symbols.
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
