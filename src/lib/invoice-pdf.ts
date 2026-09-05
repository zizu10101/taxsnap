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

// A hand-jittered polygon path, not a clean ctx.rect()/roundRect() - real
// ink stamps never lay down a perfectly straight edge, so each edge of the
// rounded rectangle is subdivided and every intermediate point nudged by a
// small random offset before stroking. Called twice per border (see
// drawStampTexture) with fresh jitter each time, so the two passes don't
// land on the same wobble and the line reads as uneven ink coverage rather
// than a single consistent squiggle.
function jitteredRoundedRectPath(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  corner: number,
  jitter: number,
  segmentsPerEdge: number,
) {
  const hw = w / 2;
  const hh = h / 2;
  // Octagon-ish corners (straight bevels, not true arcs) - close enough to
  // "rounded" at stamp scale, and simpler to jitter than an arc.
  const base: [number, number][] = [
    [-hw + corner, -hh],
    [hw - corner, -hh],
    [hw, -hh + corner],
    [hw, hh - corner],
    [hw - corner, hh],
    [-hw + corner, hh],
    [-hw, hh - corner],
    [-hw, -hh + corner],
  ];

  const points: [number, number][] = [];
  for (let i = 0; i < base.length; i++) {
    const [x0, y0] = base[i];
    const [x1, y1] = base[(i + 1) % base.length];
    for (let s = 0; s < segmentsPerEdge; s++) {
      const t = s / segmentsPerEdge;
      points.push([
        x0 + (x1 - x0) * t + (Math.random() - 0.5) * jitter,
        y0 + (y1 - y0) * t + (Math.random() - 0.5) * jitter,
      ]);
    }
  }

  ctx.beginPath();
  ctx.moveTo(points[0][0], points[0][1]);
  for (let i = 1; i < points.length; i++) ctx.lineTo(points[i][0], points[i][1]);
  ctx.closePath();
}

// Renders the stamp onto an offscreen canvas at high resolution (crisp
// once scaled down into the PDF), pre-rotated so the exported PNG can be
// dropped straight into the page with pdf.addImage - simpler and more
// reliable than fighting jsPDF's own lower-level rotation/transform APIs,
// which aren't used anywhere else in this file. Every jitter/speckle
// parameter here is sized for how it actually prints - this canvas gets
// scaled down a lot (see drawPaidStamp), so subtle texture at native
// resolution would just get anti-aliased away into a clean-looking edge.
// Bigger, bolder wobble is what still reads as "rough" once shrunk.
// Exported so the on-screen invoice view (PaidStamp component) can render
// the exact same stamp graphic, not a separate CSS-approximated look-alike
// - one canvas-drawing implementation, two places it gets dropped in (a
// jsPDF page here, a plain <img> there).
export function createPaidStampDataUrl(): string {
  const size = 600;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) return "";

  const red = "#c11f1f";
  const angleRad = (-18 * Math.PI) / 180;

  ctx.save();
  ctx.translate(size / 2, size / 2);
  ctx.rotate(angleRad);

  const rectW = 380;
  const rectH = 190;

  // Double border, thicker outer / thinner inner - the uneven double-line
  // look of a stamp that's been pressed slightly off-register with itself.
  ctx.strokeStyle = red;
  ctx.lineJoin = "round";
  ctx.globalAlpha = 0.9;
  ctx.lineWidth = 13;
  jitteredRoundedRectPath(ctx, rectW, rectH, 30, 11, 7);
  ctx.stroke();
  ctx.lineWidth = 6;
  jitteredRoundedRectPath(ctx, rectW - 24, rectH - 24, 24, 8, 7);
  ctx.stroke();

  // Bold, slightly uneven "PAID" - each letter gets its own small random
  // offset/rotation so the word doesn't look machine-typeset, then both
  // filled and stroked for a bolder, more defined edge than fill alone.
  const text = "PAID";
  ctx.font = "bold 132px Arial, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = red;
  ctx.strokeStyle = red;
  ctx.lineWidth = 3;
  ctx.globalAlpha = 0.95;

  const letterWidths = text.split("").map((ch) => ctx.measureText(ch).width);
  const totalWidth = letterWidths.reduce((sum, w) => sum + w, 0);
  let cursorX = -totalWidth / 2;
  for (let i = 0; i < text.length; i++) {
    const letter = text[i];
    const letterCenterX = cursorX + letterWidths[i] / 2;
    ctx.save();
    ctx.translate(
      letterCenterX + (Math.random() - 0.5) * 6,
      (Math.random() - 0.5) * 9,
    );
    ctx.rotate(((Math.random() - 0.5) * 7 * Math.PI) / 180);
    ctx.fillText(letter, 0, 0);
    ctx.strokeText(letter, 0, 0);
    ctx.restore();
    cursorX += letterWidths[i];
  }

  ctx.restore();

  // Worn-ink pass: punch small random transparent specks out of everything
  // drawn so far (border + text), concentrated more at the edges than the
  // center - real stamped ink is never perfectly solid, it's heaviest
  // where the stamp first contacts the page and thins out toward the rim.
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = "destination-out";
  const cx = size / 2;
  const cy = size / 2;
  const speckleRadius = 250;
  for (let i = 0; i < 420; i++) {
    const angle = Math.random() * Math.PI * 2;
    // Biased toward the outer half of the stamp's footprint.
    const dist = speckleRadius * (0.35 + Math.random() * 0.65);
    const sx = cx + Math.cos(angle) * dist;
    const sy = cy + Math.sin(angle) * dist;
    const r = 1 + Math.random() * 4;
    ctx.globalAlpha = 0.35 + Math.random() * 0.5;
    ctx.beginPath();
    ctx.arc(sx, sy, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalCompositeOperation = "source-over";
  ctx.globalAlpha = 1;

  return canvas.toDataURL("image/png");
}

// Top-right corner, sized to whatever room is actually available there.
// contentStartY is drawPdfHeader's own return value - where FROM/BILL TO
// will be drawn next - which shifts a lot depending on whether a logo is
// set (a logo pushes it well down the page; no logo leaves only a little
// room under the label/sub-label). A fixed box size that assumed the
// spacious logo case would silently overlap BILL TO on a logo-less
// account; sizing off the real boundary keeps this correct either way
// while still going as big and bold as the page actually allows.
function drawPaidStamp(pdf: jsPDF, rightX: number, contentStartY: number) {
  const dataUrl = createPaidStampDataUrl();
  if (!dataUrl) return;
  const topMargin = 16;
  const bottomGap = 10;
  const boxSize = Math.min(190, Math.max(72, contentStartY - topMargin - bottomGap));
  const x = rightX - boxSize + Math.min(20, boxSize * 0.12);
  const y = topMargin;
  pdf.addImage(dataUrl, "PNG", x, y, boxSize, boxSize);
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
      const maxH = 128;
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

  // Estimates never carry a payment status worth stamping - only an
  // invoice's own status (derived server-side from its payments, see
  // POST /api/documents/[id]/payments) reaches "paid". y here is
  // drawPdfHeader's return value, i.e. where FROM/BILL TO is about to be
  // drawn - passed through so the stamp can size itself to the room
  // actually available above that, logo or no logo.
  if (doc.type === "invoice" && doc.status === "paid") {
    drawPaidStamp(pdf, rightX, y);
  }

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
    "REGISTER REPORT",
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
