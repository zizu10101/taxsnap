import type { Receipt } from "@/lib/database.types";

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
    const notes = items.map((i) => i.name).join("; ");
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
