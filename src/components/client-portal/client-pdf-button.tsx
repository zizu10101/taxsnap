"use client";

import { useState } from "react";
import { Download, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { formatDocumentNumber } from "@/lib/document-number";
import type { DocumentType } from "@/lib/database.types";

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

// Fetches the one document through a session-checked portal API, then builds
// the PDF in the browser with the same generateDocumentPdf the owner uses
// (minus the job-specific Progress Billing Summary block). Shared by the client
// portal (the default endpoint) and the accountant portal (passes its own).
export function ClientPdfButton({
  documentId,
  type,
  documentNumber,
  size = "sm",
  variant = "outline",
  apiBase = "/api/client-portal/documents",
}: {
  documentId: string;
  type: DocumentType;
  documentNumber: number;
  size?: "sm" | "default";
  variant?: "outline" | "default";
  apiBase?: string;
}) {
  const [busy, setBusy] = useState(false);

  async function handleDownload() {
    setBusy(true);
    try {
      const res = await fetch(`${apiBase}/${documentId}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Couldn't load this document.");

      let logoDataUrl: string | null = null;
      if (data.logoUrl) {
        try {
          const logoRes = await fetch(data.logoUrl);
          logoDataUrl = await blobToDataUrl(await logoRes.blob());
        } catch {
          // A missing logo shouldn't block the client's copy.
        }
      }

      const { generateDocumentPdf } = await import("@/lib/invoice-pdf");
      const blob = await generateDocumentPdf(data.document, data.business, logoDataUrl, [], {
        includeProgressSummary: false,
      });
      downloadBlob(`${formatDocumentNumber(type, documentNumber)}.pdf`, blob);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't create the PDF. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button variant={variant} size={size} onClick={handleDownload} disabled={busy}>
      {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
      Download PDF
    </Button>
  );
}
