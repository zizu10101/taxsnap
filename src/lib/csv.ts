import type { DocumentWithRelations, Receipt } from "@/lib/database.types";

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
export function receiptsToCsv(receipts: Receipt[]): string {
  const header = [
    "Date",
    "Merchant",
    "Category",
    "Total Amount",
    "Sales Tax",
    "Deductible Amount",
    "Notes",
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

// QuickBooks Online/Desktop's bank-transaction CSV import matches columns
// by exact header text, not by position or fuzzy matching - "Date",
// "Description", "Payment", "Deposit" are the only four names it
// recognizes, so don't rename them even for clarity. Receipts are always
// an expense in this app (income/revenue is tracked separately via
// documents/payments, never receipts), so Deposit is always blank here -
// present only because QuickBooks expects the column to exist on every
// row, not because any receipt ever has a deposit amount.
//
// Deliberately no totals row (unlike receiptsToCsv's own TOTAL row) - an
// extra summary row with no real date would either get rejected by
// QuickBooks' importer or, worse, get misread as a genuine dateless
// transaction, corrupting the import. Every row here must be a real,
// importable transaction.
export function receiptsToQuickBooksCsv(receipts: Receipt[]): string {
  const header = ["Date", "Description", "Payment", "Deposit"];

  const rows = receipts.map((r) => [
    toQuickBooksDate(r.transaction_date),
    `${r.merchant_name} - ${r.tax_category}`,
    r.total_amount.toFixed(2),
    "",
  ]);

  const lines = [header, ...rows].map((row) => row.map(escapeCsvField).join(","));
  return lines.join("\n");
}

// One row per invoice, alongside the accountant export's receipt CSV -
// "Paid to Date"/"Balance Due" are derived from the same payments array
// the invoice detail view and PDF already use, not a separate query, so
// this can't disagree with what's shown on screen for the same invoice.
export function invoicesToCsv(documents: DocumentWithRelations[]): string {
  const header = [
    "Issue Date",
    "Client",
    "Status",
    "Subtotal",
    "HST",
    "Total",
    "Paid to Date",
    "Balance Due",
  ];

  const rows = documents.map((d) => {
    const paid = d.payments.reduce((sum, p) => sum + p.amount, 0);
    return [
      d.issue_date,
      d.client?.name ?? "—",
      d.status,
      d.subtotal.toFixed(2),
      d.hst_amount.toFixed(2),
      d.total_amount.toFixed(2),
      paid.toFixed(2),
      (d.total_amount - paid).toFixed(2),
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
  ];

  const lines = [header, ...rows, totalsRow].map((row) =>
    row.map(escapeCsvField).join(","),
  );

  return lines.join("\n");
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
