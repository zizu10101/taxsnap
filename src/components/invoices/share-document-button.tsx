"use client";

import { useState, useSyncExternalStore } from "react";
import { Download, Loader2, Mail, Share2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";
import { generateDocumentPdf } from "@/lib/invoice-pdf";
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

// canShare({files}) alone isn't a reliable mobile/desktop signal any more -
// Edge and Chrome on Windows and Safari on macOS now also support it, which
// would put the desktop Email/Download PDF buttons behind a check that's
// true on plenty of desktops. So this also requires a mobile-shaped device,
// same UA/touch heuristic as isIOSDevice() in install-prompt-cards.tsx,
// extended to cover Android. Uses useSyncExternalStore rather than
// useState+useEffect (same pattern as that file) so the desktop buttons are
// what SSR and first paint render - no hydration mismatch - and it only
// swaps to the single Share button once the browser's real device/capability
// is known.
function isMobileDevice() {
  if (typeof navigator === "undefined") return false;
  const isAppleTouch = navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1;
  return /android|iphone|ipad|ipod/i.test(navigator.userAgent) || isAppleTouch;
}
function canShareFiles() {
  return (
    isMobileDevice() &&
    typeof navigator.canShare === "function" &&
    navigator.canShare({
      files: [new File([], "x.pdf", { type: "application/pdf" })],
    })
  );
}
function noSubscription() {
  return () => {};
}
function getServerFalse() {
  return false;
}

async function buildPdf(document: DocumentWithRelations, business: BusinessInfo, logoPath: string | null) {
  let logoDataUrl: string | null = null;
  if (logoPath) {
    const supabase = createClient();
    const { data } = await supabase.storage.from("logos").createSignedUrl(logoPath, 60);
    if (data) {
      const resp = await fetch(data.signedUrl);
      logoDataUrl = await blobToDataUrl(await resp.blob());
    }
  }
  return generateDocumentPdf(document, business, logoDataUrl);
}

export function ShareDocumentButton({
  document,
  business,
  logoPath,
}: {
  document: DocumentWithRelations;
  business: BusinessInfo;
  logoPath: string | null;
}) {
  const canShare = useSyncExternalStore(noSubscription, canShareFiles, getServerFalse);
  const [sharing, setSharing] = useState(false);
  const [downloading, setDownloading] = useState(false);

  const label = document.type === "invoice" ? "Invoice" : "Estimate";
  const shortId = document.id.slice(0, 8).toUpperCase();

  // Uses the Web Share API so the PDF hands off to whatever the user picks
  // in their own device's native share sheet (WhatsApp, Messages, Mail,
  // etc.) - there's no way to attach a generated file to a
  // `mailto:`/`wa.me` link directly, so this is the only path that
  // actually attaches the file rather than just a text link.
  async function handleShare() {
    setSharing(true);
    try {
      const pdfBlob = await buildPdf(document, business, logoPath);
      const filename = `${label}-${shortId}.pdf`;
      const file = new File([pdfBlob], filename, { type: "application/pdf" });

      await navigator.share({
        files: [file],
        title: `${label} ${document.client?.name ? `for ${document.client.name}` : ""}`,
      });
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
      const pdfBlob = await buildPdf(document, business, logoPath);
      downloadBlob(`${label}-${shortId}.pdf`, pdfBlob);
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
    const subject = `${label} #${shortId} from ${business.name ?? "us"}`;
    const body = [
      `Hi ${document.client?.name ?? "there"},`,
      "",
      `Please find your ${label.toLowerCase()} #${shortId} attached.`,
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
