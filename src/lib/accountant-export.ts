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
    // The ITC split: what a receipt backs vs what was calculated from a card statement.
    ...(summary.calculatedCount > 0
      ? ([
          ["  Confirmed by receipt", summary.estHstConfirmed.toFixed(2)],
          ["  Calculated from statement", summary.estHstCalculated.toFixed(2)],
          ["  Statement expenses needing a tax code", summary.needsTaxCodeCount],
        ] as (string | number)[][])
      : []),
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

type PaymentDoc = {
  document_number: number;
  excluded_from_hst: boolean;
  client: { name: string } | null;
  payments: Database["public"]["Tables"]["payments"]["Row"][];
};

// Everything the zip is built from, already fetched. Split from the fetching
// so the same zip can be built for the owner (browser Supabase client, RLS) and
// for the read-only accountant portal (its own scoped API) with no drift in
// what the bundle contains.
export interface AccountantExportInputs {
  receipts: Receipt[];
  // Every account, active or not - a payment or expense recorded against a
  // since-removed account still names it.
  bankAccounts: { id: string; name: string }[];
  // Invoices issued in the range, with client/payments/items.
  invoices: DocumentWithRelations[];
  // Every invoice's payments, for payments.csv (filtered by paid_date below).
  paymentDocs: PaymentDoc[];
  // Same array the standalone "Export for QuickBooks" button builds
  // (range/excluded_from_hst-filtered by the caller) - passed straight into
  // receiptsToQuickBooksCsv so the bundled file can't drift from that button.
  invoicePayments: QuickBooksInvoicePayment[];
  range: { start: string | null; end: string | null };
  business: BusinessInfo;
  // Resolved lazily, right before use: the signed URLs are short-lived, and
  // the invoice PDFs are generated in between.
  getLogoUrl: () => Promise<string | null>;
  getImageUrls: (paths: string[]) => Promise<Map<string, string>>;
}

async function fetchLogoDataUrl(getLogoUrl: () => Promise<string | null>): Promise<string | null> {
  const url = await getLogoUrl();
  if (!url) return null;
  const res = await fetch(url);
  if (!res.ok) return null;
  return blobToDataUrl(await res.blob());
}

// Builds the full accountant package and triggers a browser download. The
// invoices.csv/PDF section is scoped to the same inclusive issue_date range as
// the receipts CSV, so the bundle's halves describe the same period.
export async function buildAndDownloadAccountantExport(
  inputs: AccountantExportInputs,
  filenameBase: string,
): Promise<void> {
  const { receipts, invoices, range, business } = inputs;
  const zip = new JSZip();

  const bankAccountNames = new Map(inputs.bankAccounts.map((a) => [a.id, a.name]));

  zip.file("transactions.csv", "﻿" + receiptsToCsv(receipts, bankAccountNames));
  zip.file("summary.csv", "﻿" + summaryToCsv(receipts));
  zip.file(
    "quickbooks-import.csv",
    "﻿" + receiptsToQuickBooksCsv(receipts, inputs.invoicePayments),
  );

  // Payments are scoped by paid_date (when the money arrived), not by the
  // invoice's issue_date like invoices.csv below - a deposit received this
  // period on an older invoice belongs in this period's bank reconciliation.
  const paymentRows: PaymentExportRow[] = [];
  for (const doc of inputs.paymentDocs) {
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

    const logoDataUrl = await fetchLogoDataUrl(inputs.getLogoUrl);
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
    const urlByPath = await inputs.getImageUrls(imagePaths);

    const usedNames = new Set<string>();
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

// The owner's export: gathers the inputs with their own (RLS-scoped) browser
// client, then builds the bundle. The invoices.csv/PDF section's documents are
// fetched fresh in here rather than passed in - nothing else on the receipts
// page needs the full invoice+items rows. A free/basic account (or one that
// has never issued an invoice) just gets an empty invoice section - RLS
// returns zero rows either way, no separate tier check needed here.
// invoicePayments is the one exception fetched by the caller: it's already
// computed there for the standalone QuickBooks button.
export async function downloadAccountantExport(
  receipts: Receipt[],
  supabase: SupabaseClient<Database>,
  filenameBase: string,
  range: { start: string | null; end: string | null },
  business: BusinessInfo,
  logoPath: string | null,
  invoicePayments: QuickBooksInvoicePayment[],
): Promise<void> {
  const { data: bankAccountRows } = await supabase.from("bank_accounts").select("id, name");

  let invoiceQuery = supabase
    .from("documents")
    .select("*, client:clients(*), payments(*), items:document_items(*)")
    .eq("type", "invoice")
    .order("issue_date", { ascending: true });
  if (range.start) invoiceQuery = invoiceQuery.gte("issue_date", range.start);
  if (range.end) invoiceQuery = invoiceQuery.lte("issue_date", range.end);
  const { data: invoiceRows } = await invoiceQuery;

  const { data: paymentDocs } = await supabase
    .from("documents")
    .select("document_number, excluded_from_hst, client:clients(name), payments(*)")
    .eq("type", "invoice");

  await buildAndDownloadAccountantExport(
    {
      receipts,
      bankAccounts: bankAccountRows ?? [],
      invoices: (invoiceRows ?? []) as unknown as DocumentWithRelations[],
      paymentDocs: (paymentDocs ?? []) as unknown as PaymentDoc[],
      invoicePayments,
      range,
      business,
      getLogoUrl: async () => {
        if (!logoPath) return null;
        const { data } = await supabase.storage.from("logos").createSignedUrl(logoPath, 60);
        return data?.signedUrl ?? null;
      },
      getImageUrls: async (paths) => {
        const { data: signedUrls } = await supabase.storage
          .from("receipts")
          .createSignedUrls(paths, SIGNED_URL_EXPIRY_SECONDS);
        return new Map(
          (signedUrls ?? []).flatMap((entry): [string, string][] =>
            !entry.error && entry.signedUrl && entry.path ? [[entry.path, entry.signedUrl]] : [],
          ),
        );
      },
    },
    filenameBase,
  );
}
