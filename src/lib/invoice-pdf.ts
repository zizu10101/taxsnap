import { jsPDF } from "jspdf";
import type { DocumentWithRelations, CommissionEntryWithRelations } from "@/lib/database.types";
import type { BusinessInfo } from "@/components/invoices/document-detail";

export function formatCurrency(amount: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(amount);
}

export function formatDate(dateStr: string) {
  return new Date(`${dateStr}T00:00:00`).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

export function formatDateTime(isoStr: string) {
  return new Date(isoStr).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function loadImageDimensions(
  dataUrl: string,
): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => reject(new Error("Failed to load logo image"));
    img.src = dataUrl;
  });
}

export const PDF_MARGIN_X = 48;

export function newPdf() {
  const pdf = new jsPDF({ unit: "pt", format: "letter" });
  const pageWidth = pdf.internal.pageSize.getWidth();
  return { pdf, marginX: PDF_MARGIN_X, rightX: pageWidth - PDF_MARGIN_X };
}

// Shared masthead: logo (if any) + a big bold label + a muted sub-label
// underneath it (an invoice number, a report's date range, etc.) - the one
// visual element every generated PDF in this app opens with.
export async function drawPdfHeader(
  pdf: jsPDF,
  marginX: number,
  y: number,
  label: string,
  subLabel: string,
  logoDataUrl: string | null,
): Promise<number> {
  if (logoDataUrl) {
    try {
      const { width, height } = await loadImageDimensions(logoDataUrl);
      const maxH = 64;
      const w = (width / height) * maxH;
      pdf.addImage(logoDataUrl, marginX, y - 24, w, maxH);
      y += maxH + 12;
    } catch {
      // Continue without the logo rather than failing the whole share.
    }
  }

  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(22);
  pdf.text(label, marginX, y);
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(10);
  pdf.setTextColor(120);
  pdf.text(subLabel, marginX, y + 16);
  pdf.setTextColor(0);
  return y + 44;
}

export interface PdfColumn {
  label: string;
  x: number;
  align: "left" | "right";
  maxWidth?: number;
}

// Generic itemized-table header row + rule, shared by any document made of
// columns/rows (invoice line items, commission report transactions).
export function drawTableHeader(
  pdf: jsPDF,
  marginX: number,
  rightX: number,
  y: number,
  columns: PdfColumn[],
): number {
  pdf.setFontSize(9);
  pdf.setTextColor(120);
  for (const col of columns) {
    pdf.text(col.label, col.x, y, col.align === "right" ? { align: "right" } : undefined);
  }
  pdf.setTextColor(0);
  y += 8;
  pdf.setDrawColor(210);
  pdf.line(marginX, y, rightX, y);
  return y + 18;
}

export function drawTableRow(
  pdf: jsPDF,
  y: number,
  columns: PdfColumn[],
  values: string[],
): number {
  pdf.setFontSize(10);
  columns.forEach((col, i) => {
    pdf.text(values[i] ?? "", col.x, y, {
      ...(col.align === "right" ? { align: "right" as const } : {}),
      ...(col.maxWidth ? { maxWidth: col.maxWidth } : {}),
    });
  });
  return y + 20;
}

// Shared totals block: right-aligned label/value rows ending in one bold
// "grand total" row - used for an invoice's Subtotal/HST/Total and a
// commission report's Transactions/Revenue/Commission Owed alike.
export function drawTotalsBlock(
  pdf: jsPDF,
  rightX: number,
  y: number,
  rows: { label: string; value: string; bold?: boolean }[],
): number {
  const labelX = rightX - 140;
  for (const row of rows) {
    if (row.bold) {
      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(13);
      pdf.text(row.label, labelX, y, { align: "right" });
      pdf.text(row.value, rightX, y, { align: "right" });
      pdf.setFont("helvetica", "normal");
    } else {
      pdf.setFontSize(10);
      pdf.setTextColor(120);
      pdf.text(row.label, labelX, y, { align: "right" });
      pdf.setTextColor(0);
      pdf.text(row.value, rightX, y, { align: "right" });
    }
    y += row.bold ? 20 : 16;
  }
  return y;
}

// Renders the same data shown on the on-screen detail view into a simple,
// print-ready PDF, laid out by hand (no table plugin) since the column
// layout is fixed and the item counts are small.
export async function generateDocumentPdf(
  doc: DocumentWithRelations,
  business: BusinessInfo,
  logoDataUrl: string | null,
): Promise<Blob> {
  const { pdf, marginX, rightX } = newPdf();
  let y = 56;

  const label = doc.type === "invoice" ? "INVOICE" : "ESTIMATE";
  y = await drawPdfHeader(
    pdf,
    marginX,
    y,
    label,
    `#${doc.id.slice(0, 8).toUpperCase()}`,
    logoDataUrl,
  );

  const colWidth = (rightX - marginX) / 2;
  pdf.setFontSize(9);
  pdf.setTextColor(120);
  pdf.text("FROM", marginX, y);
  pdf.text("BILL TO", marginX + colWidth, y);
  pdf.setTextColor(0);
  pdf.setFontSize(11);

  let fromY = y + 16;
  const fromLines = [
    business.name || business.email,
    business.name ? business.email : null,
    business.phone,
    business.address,
  ].filter((line): line is string => !!line);
  for (const line of fromLines) {
    pdf.text(line, marginX, fromY, { maxWidth: colWidth - 16 });
    fromY += 14;
  }

  let billY = y + 16;
  const billLines = [
    doc.client?.name ?? "—",
    doc.client?.email ?? null,
    doc.client?.address ?? null,
  ].filter((line): line is string => !!line);
  for (const line of billLines) {
    pdf.text(line, marginX + colWidth, billY, { maxWidth: colWidth - 16 });
    billY += 14;
  }

  y = Math.max(fromY, billY) + 10;

  pdf.setFontSize(9);
  pdf.setTextColor(120);
  pdf.text(`Issue date: ${formatDate(doc.issue_date)}`, marginX, y);
  if (doc.due_date) {
    pdf.text(`Due date: ${formatDate(doc.due_date)}`, marginX + colWidth, y);
  }
  pdf.setTextColor(0);
  y += 18;

  pdf.setDrawColor(210);
  pdf.line(marginX, y, rightX, y);
  y += 20;

  const columns: PdfColumn[] = [
    { label: "DESCRIPTION", x: marginX, align: "left", maxWidth: rightX - 220 - marginX - 12 },
    { label: "QTY", x: rightX - 220, align: "right" },
    { label: "UNIT PRICE", x: rightX - 140, align: "right" },
    { label: "AMOUNT", x: rightX, align: "right" },
  ];
  y = drawTableHeader(pdf, marginX, rightX, y, columns);

  for (const item of doc.items) {
    y = drawTableRow(pdf, y, columns, [
      item.description,
      String(item.quantity),
      formatCurrency(item.unit_price),
      formatCurrency(item.quantity * item.unit_price),
    ]);
  }

  y += 6;
  pdf.line(marginX, y, rightX, y);
  y += 20;

  drawTotalsBlock(pdf, rightX, y, [
    { label: "Subtotal", value: formatCurrency(doc.subtotal) },
    { label: "HST (13%)", value: formatCurrency(doc.hst_amount) },
    { label: "Total", value: formatCurrency(doc.total_amount), bold: true },
  ]);

  return pdf.output("blob");
}

// Per-stylist commission report - same visual system as
// generateDocumentPdf above (header/logo, itemized table, totals block),
// built from the same shared drawing helpers rather than a parallel PDF
// system.
export async function generateCommissionReportPdf(
  stylistName: string,
  rangeLabel: string,
  entries: CommissionEntryWithRelations[],
  business: BusinessInfo,
  logoDataUrl: string | null,
): Promise<Blob> {
  const { pdf, marginX, rightX } = newPdf();
  let y = 56;

  y = await drawPdfHeader(
    pdf,
    marginX,
    y,
    "COMMISSION REPORT",
    `${stylistName} — ${rangeLabel}`,
    logoDataUrl,
  );

  pdf.setFontSize(9);
  pdf.setTextColor(120);
  pdf.text(business.name ?? "", marginX, y);
  pdf.setTextColor(0);
  y += 24;

  // SERVICE's x used to be a flat `marginX + 90`, unrelated to how wide the
  // DATE column's own text actually renders - drawTableRow has no
  // per-column clipping, so a date/time string wider than that fixed gap
  // (e.g. "Aug 28, 2026, 1:33 PM" at font size 10, comfortably over 90pt)
  // painted straight through into SERVICE's start, e.g. "1:33 PHaircut".
  // Measuring the actual widest rendered date string in this report (at
  // the same font size drawTableRow uses for row text) and sizing the gap
  // to that instead means the column boundary is always at least as wide
  // as the content requires, for any timestamp this format can produce -
  // not just whatever happened to fit the last time someone eyeballed it.
  pdf.setFontSize(10);
  const DATE_COLUMN_GAP = 16;
  const dateColumnWidth =
    entries.length > 0
      ? Math.max(...entries.map((e) => pdf.getTextWidth(formatDateTime(e.created_at))))
      : pdf.getTextWidth("Dec 31, 2026, 12:59 PM"); // worst-case fallback: no rows to measure
  const serviceX = marginX + dateColumnWidth + DATE_COLUMN_GAP;

  const columns: PdfColumn[] = [
    { label: "DATE", x: marginX, align: "left", maxWidth: dateColumnWidth },
    {
      label: "SERVICE",
      x: serviceX,
      align: "left",
      maxWidth: rightX - 220 - serviceX - 12,
    },
    { label: "CUSTOMER", x: rightX - 220, align: "left", maxWidth: 100 },
    { label: "PRICE", x: rightX - 100, align: "right" },
    { label: "COMMISSION", x: rightX, align: "right" },
  ];
  y = drawTableHeader(pdf, marginX, rightX, y, columns);

  let totalRevenue = 0;
  let totalCommission = 0;
  for (const entry of entries) {
    if (y > 720) {
      pdf.addPage();
      y = 56;
      y = drawTableHeader(pdf, marginX, rightX, y, columns);
    }
    totalRevenue += entry.price_charged;
    totalCommission += entry.commission_owed;
    y = drawTableRow(pdf, y, columns, [
      formatDateTime(entry.created_at),
      entry.service_name,
      entry.customer_name ?? "—",
      formatCurrency(entry.price_charged),
      formatCurrency(entry.commission_owed),
    ]);
  }

  y += 6;
  pdf.line(marginX, y, rightX, y);
  y += 20;

  drawTotalsBlock(pdf, rightX, y, [
    { label: "Transactions", value: String(entries.length) },
    { label: "Revenue", value: formatCurrency(totalRevenue) },
    { label: "Commission Owed", value: formatCurrency(totalCommission), bold: true },
  ]);

  return pdf.output("blob");
}
