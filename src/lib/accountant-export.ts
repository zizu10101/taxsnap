import JSZip from "jszip";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Receipt } from "@/lib/database.types";
import { receiptsToCsv } from "@/lib/csv";
import { computeExpenseSummary } from "@/lib/expense-summary";

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

// Builds the full accountant package for whatever receipts are already
// in hand (the same range/job-filtered array the plain CSV export already
// uses - see receipts-list.tsx) and triggers a browser download. No new
// receipts query: this only adds the summary math (computeExpenseSummary,
// the same function backing the Overview page, so the two can't disagree)
// and the image fetch/zip step on top of data the caller already loaded.
export async function downloadAccountantExport(
  receipts: Receipt[],
  supabase: SupabaseClient<Database>,
  filenameBase: string,
): Promise<void> {
  const zip = new JSZip();
  zip.file("transactions.csv", "﻿" + receiptsToCsv(receipts));
  zip.file("summary.csv", "﻿" + summaryToCsv(receipts));

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
