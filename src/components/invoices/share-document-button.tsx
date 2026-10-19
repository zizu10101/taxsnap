"use client";

import { useState, useSyncExternalStore } from "react";
import { Download, Loader2, Mail, Share2 } from "lucide-react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";
import { generateDocumentPdf, type PriorDraw } from "@/lib/invoice-pdf";
import { canShareFiles, getServerFalse, noSubscription } from "@/lib/share-capability";
import { formatDocumentNumber } from "@/lib/document-number";
import { showsInvoiceFooter } from "@/lib/invoice-footer";
import type { DocumentWithRelations } from "@/lib/database.types";
import type { BusinessInfo } from "@/components/invoices/document-detail";

function formatCurrency(amount: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(amount);
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error("Failed to read logo image"));
    reader.readAsDataURL(blob);
  });
}

export function downloadBlob(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const link = window.document.createElement("a");
  link.href = url;
  link.download = filename;
  window.document.body.appendChild(link);
  link.click();
  window.document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

// Tells the server a PDF was downloaded or shared (it happens in the browser), so the
// first-invoice-sent activation timestamp can be set. With `markSent` (the share sheet - not a
// plain download) a DRAFT invoice also becomes Sent. Resolves to whether the status changed;
// it never throws, so it can not get in the way of the send itself.
export async function reportDocumentSent(documentId: string, markSent = false): Promise<boolean> {
  try {
    const res = await fetch(`/api/documents/${documentId}/mark-sent`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mark_sent: markSent }),
    });
    const data = await res.json().catch(() => ({}));
    return res.ok && data.marked_sent === true;
  } catch {
    return false;
  }
}

export const MARKED_SENT_MESSAGE = "Invoice marked as Sent";

export async function buildDocumentPdf(
  document: DocumentWithRelations,
  business: BusinessInfo,
  logoPath: string | null,
  priorDraws: PriorDraw[],
) {
  const supabase = createClient();
  let logoDataUrl: string | null = null;
  if (logoPath) {
    const { data } = await supabase.storage.from("logos").createSignedUrl(logoPath, 60);
    if (data) {
      const resp = await fetch(data.signedUrl);
      logoDataUrl = await blobToDataUrl(await resp.blob());
    }
  }
  // Free accounts' invoices carry the "Created with TaxSnap" credit; the
  // owner's own plan decides, read here so every caller (Download, Share,
  // Email) gets the same answer.
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data: profile } = user
    ? await supabase.from("profiles").select("subscription_status").eq("id", user.id).single()
    : { data: null };
  return generateDocumentPdf(document, business, logoDataUrl, priorDraws, {
    brandFooter: showsInvoiceFooter(profile?.subscription_status, document.type),
  });
}

export function ShareDocumentButton({
  document,
  business,
  logoPath,
  priorDraws = [],
}: {
  document: DocumentWithRelations;
  business: BusinessInfo;
  logoPath: string | null;
  // Other draws on the same job, for the PDF's "Previous Billed" figure -
  // only meaningful when document.is_progress_draw, harmless/unused
  // otherwise.
  priorDraws?: PriorDraw[];
}) {
  const router = useRouter();
  const canShare = useSyncExternalStore(noSubscription, canShareFiles, getServerFalse);
  const [sharing, setSharing] = useState(false);
  const [downloading, setDownloading] = useState(false);

  const label = document.type === "invoice" ? "Invoice" : "Estimate";
  const shortId = formatDocumentNumber(document.type, document.document_number);

  // Uses the Web Share API so the PDF hands off to whatever the user picks
  // in their own device's native share sheet (WhatsApp, Messages, Mail,
  // etc.) - there's no way to attach a generated file to a
  // `mailto:`/`wa.me` link directly, so this is the only path that
  // actually attaches the file rather than just a text link.
  async function handleShare() {
    setSharing(true);
    try {
      const pdfBlob = await buildDocumentPdf(document, business, logoPath, priorDraws);
      const filename = `${shortId}.pdf`;
      const file = new File([pdfBlob], filename, { type: "application/pdf" });

      await navigator.share({
        files: [file],
        title: `${label} ${document.client?.name ? `for ${document.client.name}` : ""}`,
      });
      // Handing the PDF to the share sheet counts as sending the invoice.
      if (await reportDocumentSent(document.id, true)) {
        toast.success(MARKED_SENT_MESSAGE);
        router.refresh();
      }
    } catch (err) {
      // The user closing the native share sheet throws AbortError - not a real failure.
      if (err instanceof Error && err.name === "AbortError") return;
      toast.error(err instanceof Error ? err.message : "Failed to share");
    } finally {
      setSharing(false);
    }
  }

  async function handleDownload() {
    setDownloading(true);
    try {
      const pdfBlob = await buildDocumentPdf(document, business, logoPath, priorDraws);
      downloadBlob(`${shortId}.pdf`, pdfBlob);
      reportDocumentSent(document.id);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to generate PDF");
    } finally {
      setDownloading(false);
    }
  }

  // mailto: can't carry an attachment, so this is a plain email draft -
  // the toast nudges the user toward the separate Download PDF button
  // sitting right next to it.
  function handleEmail() {
    const to = document.client?.email ?? "";
    const subject = `${label} ${shortId} from ${business.name ?? "us"}`;
    const body = [
      `Hi ${document.client?.name ?? "there"},`,
      "",
      `Please find your ${label.toLowerCase()} ${shortId} attached.`,
      "",
      `Total: ${formatCurrency(document.total_amount)}`,
      "",
      `Thanks,`,
      business.name ?? "",
    ].join("\n");

    window.location.href = `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    toast.info("Don't forget to attach the PDF - use “Download PDF” and add it to the email.");
  }

  if (canShare) {
    return (
      <Button variant="outline" size="sm" onClick={handleShare} disabled={sharing}>
        {sharing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Share2 className="h-4 w-4" />}
        Share
      </Button>
    );
  }

  return (
    <>
      <Button variant="outline" size="sm" onClick={handleEmail}>
        <Mail className="h-4 w-4" />
        Email
      </Button>
      <Button variant="outline" size="sm" onClick={handleDownload} disabled={downloading}>
        {downloading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
        Download PDF
      </Button>
    </>
  );
}
