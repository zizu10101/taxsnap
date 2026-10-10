"use client";

import { useState, useSyncExternalStore } from "react";
import { Download, Link2, Loader2, Mail, Send, Share2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { buildDocumentPdf, downloadBlob } from "@/components/invoices/share-document-button";
import type { BusinessInfo } from "@/components/invoices/document-detail";
import type { PriorDraw } from "@/lib/invoice-pdf";
import { canShareFiles, getServerFalse, noSubscription } from "@/lib/share-capability";
import { formatDocumentNumber } from "@/lib/document-number";
import { sendMenu, type SendAction } from "@/lib/line-format";
import type { DocumentWithRelations } from "@/lib/database.types";

// The one Send menu on the estimate and invoice detail pages (it replaced separate "Email" and
// "Email Signature Link" buttons): Email to client (PDF attached, via Resend, with the signature link
// for an estimate that still needs one), Copy link, Download PDF. Which options exist comes from
// sendMenu() - "Email to client" is hidden, with the reason shown, when the client has no email.
//
// Nothing here changes the document's status: none of these actions PATCH the document, and the email
// route never writes to it. Whether sending should mark a document "sent" is a separate decision.
export function SendDocumentMenu({
  document,
  business,
  logoPath,
  priorDraws = [],
}: {
  document: DocumentWithRelations;
  business: BusinessInfo;
  logoPath: string | null;
  priorDraws?: PriorDraw[];
}) {
  const canShare = useSyncExternalStore(noSubscription, canShareFiles, getServerFalse);
  const [busy, setBusy] = useState<SendAction | "share" | null>(null);
  const { options, note } = sendMenu({ clientEmail: document.client?.email });
  const shortId = formatDocumentNumber(document.type, document.document_number);

  async function run(action: SendAction | "share") {
    setBusy(action);
    try {
      if (action === "download-pdf") {
        downloadBlob(`${shortId}.pdf`, await buildDocumentPdf(document, business, logoPath, priorDraws));
      } else if (action === "copy-link") {
        const res = await fetch(`/api/documents/${document.id}/share-link`, { method: "POST" });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Failed to create the link");
        await navigator.clipboard.writeText(data.url);
        toast.success(
          document.type === "estimate" ? "Signature link copied to clipboard" : "Invoice link copied to clipboard",
        );
      } else if (action === "email") {
        const pdf = await buildDocumentPdf(document, business, logoPath, priorDraws);
        const form = new FormData();
        form.append("pdf", new File([pdf], `${shortId}.pdf`, { type: "application/pdf" }));
        const res = await fetch(`/api/documents/${document.id}/send-email`, { method: "POST", body: form });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || "Failed to send the email");
        toast.success(`Emailed to ${data.sent_to}`);
      } else {
        const pdf = await buildDocumentPdf(document, business, logoPath, priorDraws);
        await navigator.share({
          files: [new File([pdf], `${shortId}.pdf`, { type: "application/pdf" })],
          title: `${document.type === "invoice" ? "Invoice" : "Estimate"} ${shortId}`,
        });
      }
    } catch (err) {
      // Closing the native share sheet throws AbortError - not a real failure.
      if (err instanceof Error && err.name === "AbortError") return;
      toast.error(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setBusy(null);
    }
  }

  const icons: Record<SendAction, React.ReactNode> = {
    email: <Mail className="h-4 w-4" />,
    "copy-link": <Link2 className="h-4 w-4" />,
    "download-pdf": <Download className="h-4 w-4" />,
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button variant="outline" size="sm" disabled={busy !== null} />}
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        Send
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-56">
        {options.map((option) => (
          <DropdownMenuItem key={option.action} onClick={() => run(option.action)}>
            {icons[option.action]}
            {option.label}
          </DropdownMenuItem>
        ))}
        {canShare && (
          <DropdownMenuItem onClick={() => run("share")}>
            <Share2 className="h-4 w-4" />
            Share PDF...
          </DropdownMenuItem>
        )}
        {note && <p className="px-1.5 py-1 text-xs text-muted-foreground">{note}</p>}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
