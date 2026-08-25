import { jsPDF } from "jspdf";
import type { DocumentWithRelations } from "@/lib/database.types";
import type { BusinessInfo } from "@/components/invoices/document-detail";

function formatCurrency(amount: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(amount);
}

function formatDate(dateStr: string) {
  return new Date(`${dateStr}T00:00:00`).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
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

// Renders the same data shown on the on-screen detail view into a simple,
// print-ready PDF, laid out by hand (no table plugin) since the column
// layout is fixed and the item counts are small.
export async function generateDocumentPdf(
  doc: DocumentWithRelations,
  business: BusinessInfo,
  logoDataUrl: string | null,
): Promise<Blob> {
  const pdf = new jsPDF({ unit: "pt", format: "letter" });
  const marginX = 48;
  const pageWidth = pdf.internal.pageSize.getWidth();
  const rightX = pageWidth - marginX;
  let y = 56;

  if (logoDataUrl) {
    try {
      const { width, height } = await loadImageDimensions(logoDataUrl);
      const maxH = 40;
      const w = (width / height) * maxH;
      pdf.addImage(logoDataUrl, marginX, y - 24, w, maxH);
      y += maxH + 12;
    } catch {
      // Continue without the logo rather than failing the whole share.
    }
  }

  const label = doc.type === "invoice" ? "INVOICE" : "ESTIMATE";
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(22);
  pdf.text(label, marginX, y);
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(10);
  pdf.setTextColor(120);
  pdf.text(`#${doc.id.slice(0, 8).toUpperCase()}`, marginX, y + 16);
  pdf.setTextColor(0);
  y += 44;

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

  const col = {
    desc: marginX,
    qty: rightX - 220,
    price: rightX - 140,
  };

  pdf.setFontSize(9);
  pdf.setTextColor(120);
  pdf.text("DESCRIPTION", col.desc, y);
  pdf.text("QTY", col.qty, y, { align: "right" });
  pdf.text("UNIT PRICE", col.price, y, { align: "right" });
  pdf.text("AMOUNT", rightX, y, { align: "right" });
  pdf.setTextColor(0);
  y += 8;
  pdf.line(marginX, y, rightX, y);
  y += 18;

  pdf.setFontSize(10);
  for (const item of doc.items) {
    pdf.text(item.description, col.desc, y, { maxWidth: col.qty - col.desc - 12 });
    pdf.text(String(item.quantity), col.qty, y, { align: "right" });
    pdf.text(formatCurrency(item.unit_price), col.price, y, { align: "right" });
    pdf.text(formatCurrency(item.quantity * item.unit_price), rightX, y, {
      align: "right",
    });
    y += 20;
  }

  y += 6;
  pdf.line(marginX, y, rightX, y);
  y += 20;

  const totalsLabelX = rightX - 140;
  pdf.setFontSize(10);
  pdf.setTextColor(120);
  pdf.text("Subtotal", totalsLabelX, y, { align: "right" });
  pdf.setTextColor(0);
  pdf.text(formatCurrency(doc.subtotal), rightX, y, { align: "right" });
  y += 16;

  pdf.setTextColor(120);
  pdf.text("HST (13%)", totalsLabelX, y, { align: "right" });
  pdf.setTextColor(0);
  pdf.text(formatCurrency(doc.hst_amount), rightX, y, { align: "right" });
  y += 20;

  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(13);
  pdf.text("Total", totalsLabelX, y, { align: "right" });
  pdf.text(formatCurrency(doc.total_amount), rightX, y, { align: "right" });

  return pdf.output("blob");
}
