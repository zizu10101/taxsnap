"use client";

import { useState, useSyncExternalStore } from "react";
import { Download, Loader2, Mail, Share2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";
import { generateCommissionReportPdf } from "@/lib/invoice-pdf";
import { canShareFiles, getServerFalse, noSubscription } from "@/lib/share-capability";
import type { BusinessInfo } from "@/components/invoices/document-detail";
import type { CommissionEntryWithRelations } from "@/lib/database.types";

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error("Failed to read logo image"));
    reader.readAsDataURL(blob);
  });
}

function downloadBlob(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const link = window.document.createElement("a");
  link.href = url;
  link.download = filename;
  window.document.body.appendChild(link);
  link.click();
  window.document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export function CommissionReportShareButtons({
  stylistName,
  rangeLabel,
  entries,
  business,
  logoPath,
}: {
  stylistName: string;
  rangeLabel: string;
  entries: CommissionEntryWithRelations[];
  business: BusinessInfo;
  logoPath: string | null;
}) {
  const canShare = useSyncExternalStore(noSubscription, canShareFiles, getServerFalse);
  const [sharing, setSharing] = useState(false);
  const [downloading, setDownloading] = useState(false);

  const filename = `Commission-${stylistName.replace(/\s+/g, "-")}.pdf`;

  async function buildPdf() {
    let logoDataUrl: string | null = null;
    if (logoPath) {
      const supabase = createClient();
      const { data } = await supabase.storage.from("logos").createSignedUrl(logoPath, 60);
      if (data) {
        const resp = await fetch(data.signedUrl);
        logoDataUrl = await blobToDataUrl(await resp.blob());
      }
    }
    return generateCommissionReportPdf(stylistName, rangeLabel, entries, business, logoDataUrl);
  }

  async function handleShare() {
    setSharing(true);
    try {
      const pdfBlob = await buildPdf();
      const file = new File([pdfBlob], filename, { type: "application/pdf" });
      await navigator.share({ files: [file], title: `Commission report for ${stylistName}` });
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") return;
      toast.error(err instanceof Error ? err.message : "Failed to share");
    } finally {
      setSharing(false);
    }
  }

  async function handleDownload() {
    setDownloading(true);
    try {
      const pdfBlob = await buildPdf();
      downloadBlob(filename, pdfBlob);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to generate PDF");
    } finally {
      setDownloading(false);
    }
  }

  function handleEmail() {
    const subject = `Commission report — ${stylistName} — ${rangeLabel}`;
    const body = `Hi,\n\nAttached is the commission report for ${stylistName} (${rangeLabel}).\n\nThanks,\n${business.name ?? ""}`;
    window.location.href = `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
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
