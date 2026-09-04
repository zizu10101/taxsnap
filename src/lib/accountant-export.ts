import JSZip from "jszip";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, DocumentWithRelations, Receipt } from "@/lib/database.types";
import { invoicesToCsv, receiptsToCsv } from "@/lib/csv";
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
  const rows: (string | number)[][] = [
    ["Period Summary", ""],
    ["Receipt Count", receipts.length],
    ["Total Expenses", summary.totalExpenses.toFixed(2)],
    ["Deductible Spend", summary.deductibleSpend.toFixed(2)],
    ["Est. HST Reclaimable", summary.estHstReclaimable.toFixed(2)],
    ["Non-Deductible Spend", summary.nonDeductibleSpend.toFixed(2)],
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
// uses - see receipts-list.tsx) and triggers a browser download. Invoices
// are the one thing fetched fresh in here rather than passed in - nothing
// else on this page needs invoice data, so there's no reason for the
// caller to carry it just for this - scoped to the same inclusive
// transaction_date/issue_date range as the receipts CSV, so the two halves
// of the bundle describe the same period. A free/basic account (or one
// that's simply never issued an invoice) just gets an empty invoice
// section - RLS returns zero rows either way, no separate tier check
// needed here.
export async function downloadAccountantExport(
  receipts: Receipt[],
  supabase: SupabaseClient<Database>,
  filenameBase: string,
  range: { start: string | null; end: string | null },
  business: BusinessInfo,
  logoPath: string | null,
): Promise<void> {
  const zip = new JSZip();
  zip.file("transactions.csv", "﻿" + receiptsToCsv(receipts));
  zip.file("summary.csv", "﻿" + summaryToCsv(receipts));

  let invoiceQuery = supabase
    .from("documents")
    .select("*, client:clients(*), payments(*), items:document_items(*)")
    .eq("type", "invoice")
    .order("issue_date", { ascending: true });
  if (range.start) invoiceQuery = invoiceQuery.gte("issue_date", range.start);
  if (range.end) invoiceQuery = invoiceQuery.lte("issue_date", range.end);
  const { data: invoiceRows } = await invoiceQuery;
  const invoices = (invoiceRows ?? []) as unknown as DocumentWithRelations[];

  if (invoices.length > 0) {
    zip.file("invoices.csv", "﻿" + invoicesToCsv(invoices));

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
