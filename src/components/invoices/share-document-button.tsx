"use client";

import { useState } from "react";
import { Loader2, Share2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";
import { generateDocumentPdf } from "@/lib/invoice-pdf";
import type { DocumentWithRelations } from "@/lib/database.types";
import type { BusinessInfo } from "@/components/invoices/document-detail";

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
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

// Uses the Web Share API so the PDF hands off to whatever the user picks in
// their own device's native share sheet (WhatsApp, Messages, Mail, etc.) -
// there's no way to attach a generated file to a `mailto:`/`wa.me` link
// directly, so this is the only path that actually attaches the file rather
// than just a text link. Falls back to a plain download where file sharing
// isn't supported (most desktop browsers).
export function ShareDocumentButton({
  document,
  business,
  logoPath,
}: {
  document: DocumentWithRelations;
  business: BusinessInfo;
  logoPath: string | null;
}) {
  const [sharing, setSharing] = useState(false);

  async function handleShare() {
    setSharing(true);
    try {
      let logoDataUrl: string | null = null;
      if (logoPath) {
        const supabase = createClient();
        const { data } = await supabase.storage
          .from("logos")
          .createSignedUrl(logoPath, 60);
        if (data) {
          const resp = await fetch(data.signedUrl);
          logoDataUrl = await blobToDataUrl(await resp.blob());
        }
      }

      const pdfBlob = await generateDocumentPdf(document, business, logoDataUrl);
      const label = document.type === "invoice" ? "Invoice" : "Estimate";
      const filename = `${label}-${document.id.slice(0, 8).toUpperCase()}.pdf`;
      const file = new File([pdfBlob], filename, { type: "application/pdf" });

      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({
          files: [file],
          title: `${label} ${document.client?.name ? `for ${document.client.name}` : ""}`,
        });
      } else {
        downloadBlob(filename, pdfBlob);
        toast.info(
          "Sharing isn't supported in this browser - the PDF was downloaded instead.",
        );
      }
    } catch (err) {
      // The user closing the native share sheet throws AbortError - not a real failure.
      if (err instanceof Error && err.name === "AbortError") return;
      toast.error(err instanceof Error ? err.message : "Failed to share");
    } finally {
      setSharing(false);
    }
  }

  return (
    <Button variant="outline" size="sm" onClick={handleShare} disabled={sharing}>
      {sharing ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : (
        <Share2 className="h-4 w-4" />
      )}
      Share
    </Button>
  );
}
