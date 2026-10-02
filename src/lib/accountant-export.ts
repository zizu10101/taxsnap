import JSZip from "jszip";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, DocumentWithRelations, Receipt } from "@/lib/database.types";
import {
  invoicesToCsv,
  paymentsToCsv,
  receiptsToCsv,
  receiptsToQuickBooksCsv,
  type PaymentExportRow,
  type QuickBooksInvoicePayment,
} from "@/lib/csv";
import { computeExpenseSummary } from "@/lib/expense-summary";
import { generateDocumentPdf } from "@/lib/invoice-pdf";
import type { BusinessInfo } from "@/components/invoices/document-detail";

// Signed URLs only need to live long enough to fetch the image bytes
// during this one export - not the 7-day window used when a receipt is
// first uploaded for its own confirmation-screen preview.
const SIGNED_URL_EXPIRY_SECONDS = 60;

function escapeCsvField(value: string | number): string {
  const str = String(value);
  if (/[",\n]/.test(str)) return `"${str.replace(/"/g, '""')}"`;
  return str;
}

function summaryToCsv(receipts: Receipt[]): string {
  const summary = computeExpenseSummary(receipts);
  const jobReceipts = receipts.filter((r) => r.job_id);
  const overheadReceipts = receipts.filter((r) => !r.job_id);
  const rows: (string | number)[][] = [
    ["Period Summary", ""],
    ["Receipt Count", receipts.length],
    ["Total Expenses", summary.totalExpenses.toFixed(2)],
    ["Deductible Spend", summary.deductibleSpend.toFixed(2)],
    ["Est. HST Reclaimable", summary.estHstReclaimable.toFixed(2)],
    ["Non-Deductible Spend", summary.nonDeductibleSpend.toFixed(2)],
    ["", ""],
    ["Job vs. Overhead", ""],
    ["Job Expenses", computeExpenseSummary(jobReceipts).totalExpenses.toFixed(2)],
    ["Overhead Expenses", computeExpenseSummary(overheadReceipts).totalExpenses.toFixed(2)],
  ];
  return rows.map((row) => row.map(escapeCsvField).join(",")).join("\n");
}

// Readable, collision-resistant-enough filename for a receipt's image
// inside the zip - collisions (same date + merchant, e.g. two coffee runs
// the same morning) get a numeric suffix rather than silently overwriting
// one file with another.
function imageFilename(receipt: Receipt, usedNames: Set<string>): string {
  const extension = receipt.image_url?.split(".").pop() || "jpg";
  const merchantSlug = receipt.merchant_name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 40);
  const base = `${receipt.transaction_date}_${merchantSlug || "receipt"}`;

  let name = `${base}.${extension}`;
  let suffix = 2;
  while (usedNames.has(name)) {
    name = `${base}-${suffix}.${extension}`;
    suffix += 1;
  }
  usedNames.add(name);
  return name;
}

// Same naming shape as imageFilename above, one collision-check Set per
// call so two invoices issued the same day to the same client don't clobber
// each other in the zip.
function invoicePdfFilename(doc: DocumentWithRelations, usedNames: Set<string>): string {
  const clientSlug = (doc.client?.name ?? "invoice")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 40);
  const base = `${doc.issue_date}_${clientSlug || "invoice"}`;

  let name = `${base}.pdf`;
  let suffix = 2;
  while (usedNames.has(name)) {
    name = `${base}-${suffix}.pdf`;
    suffix += 1;
  }
  usedNames.add(name);
  return name;
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error("Failed to read logo image"));
    reader.readAsDataURL(blob);
  });
}

// Same signed-URL-then-fetch-then-base64 dance as share-document-button.tsx/
// commission-report-share-buttons.tsx's own logo loading - duplicated here
// rather than extracted, matching how those two already duplicate it
// between themselves rather than sharing one helper.
async function fetchLogoDataUrl(
  supabase: SupabaseClient<Database>,
  logoPath: string | null,
): Promise<string | null> {
  if (!logoPath) return null;
  const { data } = await supabase.storage.from("logos").createSignedUrl(logoPath, 60);
  if (!data) return null;
  const res = await fetch(data.signedUrl);
  if (!res.ok) return null;
  return blobToDataUrl(await res.blob());
}

// Builds the full accountant package for whatever receipts are already
// in hand (the same range/job-filtered array the plain CSV export already
// uses - see receipts-list.tsx) and triggers a browser download. The
// invoices.csv/PDF section's own documents are the one thing fetched fresh
// in here rather than passed in - nothing else on this page needs the full
// invoice+items rows, so there's no reason for the caller to carry them
// just for this - scoped to the same inclusive transaction_date/issue_date
// range as the receipts CSV, so the bundle's halves describe the same
// period. A free/basic account (or one that's simply never issued an
// invoice) just gets an empty invoice section - RLS returns zero rows
// either way, no separate tier check needed here. invoicePayments is the
// one exception fetched by the caller instead: it's already computed
// there for the standalone QuickBooks button, so it's passed straight
// through rather than re-derived from the documents query above.
export async function downloadAccountantExport(
  receipts: Receipt[],
  supabase: SupabaseClient<Database>,
  filenameBase: string,
  range: { start: string | null; end: string | null },
  business: BusinessInfo,
  logoPath: string | null,
  // Same array the standalone "Export for QuickBooks" button already
  // built (range/excluded_from_hst-filtered by the caller) - passed
  // straight into receiptsToQuickBooksCsv below rather than refetched or
  // reimplemented here, so the bundled file can't drift from what that
  // button produces for the same period.
  invoicePayments: QuickBooksInvoicePayment[],
): Promise<void> {
  const zip = new JSZip();

  // Every account, active or not - a payment or expense recorded against a
  // since-removed account still names it. RLS scopes this to the caller's own
  // accounts.
  const { data: bankAccountRows } = await supabase.from("bank_accounts").select("id, name");
  const bankAccountNames = new Map((bankAccountRows ?? []).map((a) => [a.id, a.name]));

  zip.file("transactions.csv", "﻿" + receiptsToCsv(receipts, bankAccountNames));
  zip.file("summary.csv", "﻿" + summaryToCsv(receipts));
  zip.file(
    "quickbooks-import.csv",
    "﻿" + receiptsToQuickBooksCsv(receipts, invoicePayments),
  );

  let invoiceQuery = supabase
    .from("documents")
    .select("*, client:clients(*), payments(*), items:document_items(*)")
    .eq("type", "invoice")
    .order("issue_date", { ascending: true });
  if (range.start) invoiceQuery = invoiceQuery.gte("issue_date", range.start);
  if (range.end) invoiceQuery = invoiceQuery.lte("issue_date", range.end);
  const { data: invoiceRows } = await invoiceQuery;
  const invoices = (invoiceRows ?? []) as unknown as DocumentWithRelations[];

  // Payments are scoped by paid_date (when the money arrived), not by the
  // invoice's issue_date like invoices.csv below - a deposit received this
  // period on an older invoice belongs in this period's bank reconciliation.
  const { data: paymentDocs } = await supabase
    .from("documents")
    .select("document_number, excluded_from_hst, client:clients(name), payments(*)")
    .eq("type", "invoice");
  const paymentRows: PaymentExportRow[] = [];
  for (const doc of (paymentDocs ?? []) as unknown as {
    document_number: number;
    excluded_from_hst: boolean;
    client: { name: string } | null;
    payments: Database["public"]["Tables"]["payments"]["Row"][];
  }[]) {
    for (const p of doc.payments) {
      if (range.start && p.paid_date < range.start) continue;
      if (range.end && p.paid_date > range.end) continue;
      paymentRows.push({
        paidDate: p.paid_date,
        documentNumber: doc.document_number,
        clientName: doc.client?.name ?? "—",
        amount: p.amount,
        method: p.method,
        depositedTo: p.bank_account_id ? (bankAccountNames.get(p.bank_account_id) ?? null) : null,
        note: p.note,
        excludedFromHst: doc.excluded_from_hst,
      });
    }
  }
  paymentRows.sort((a, b) => (a.paidDate < b.paidDate ? -1 : a.paidDate > b.paidDate ? 1 : 0));
  if (paymentRows.length > 0) {
    zip.file("payments.csv", "﻿" + paymentsToCsv(paymentRows));
  }

  if (invoices.length > 0) {
    zip.file("invoices.csv", "﻿" + invoicesToCsv(invoices, bankAccountNames));

    const logoDataUrl = await fetchLogoDataUrl(supabase, logoPath);
    const usedInvoiceNames = new Set<string>();
    await Promise.all(
      invoices.map(async (doc) => {
        try {
          const blob = await generateDocumentPdf(doc, business, logoDataUrl);
          zip.file(`invoices/${invoicePdfFilename(doc, usedInvoiceNames)}`, blob);
        } catch {
          // One failed invoice PDF shouldn't sink the whole export - the
          // CSVs and every other file are still worth downloading.
        }
      }),
    );
  }

  const imagePaths = receipts
    .map((r) => r.image_url)
    .filter((path): path is string => !!path);

  if (imagePaths.length > 0) {
    const { data: signedUrls } = await supabase.storage
      .from("receipts")
      .createSignedUrls(imagePaths, SIGNED_URL_EXPIRY_SECONDS);

    const usedNames = new Set<string>();
    const urlByPath = new Map(
      (signedUrls ?? [])
        .filter((entry) => !entry.error && entry.signedUrl)
        .map((entry) => [entry.path, entry.signedUrl]),
    );

    // Fetched in parallel - a year of receipts is at most a few hundred
    // images, well within what a browser's connection pool and this app's
    // "no server compute for this at all" design can handle without a
    // progress UI.
    await Promise.all(
      receipts.map(async (receipt) => {
        const path = receipt.image_url;
        const signedUrl = path ? urlByPath.get(path) : undefined;
        if (!signedUrl) return;

        try {
          const res = await fetch(signedUrl);
          if (!res.ok) return;
          const blob = await res.blob();
          zip.file(`images/${imageFilename(receipt, usedNames)}`, blob);
        } catch {
          // One failed image shouldn't sink the whole export - the CSVs
          // and every other image are still worth downloading.
        }
      }),
    );
  }

  const blob = await zip.generateAsync({ type: "blob" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${filenameBase}.zip`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
