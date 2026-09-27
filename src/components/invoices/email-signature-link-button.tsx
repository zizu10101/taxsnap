"use client";

import { useState } from "react";
import { Loader2, Mail } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

// Faster alternative to GetSignatureLinkButton's copy-to-clipboard flow,
// for when email is the right channel - one click auto-sends the
// estimate summary + sign link. Only ever rendered when the client has an
// email on file (see document-detail.tsx's own gate) - Copy Link stays
// the only option otherwise, since not every client relationship here
// goes through email (WhatsApp is common for this app's actual users).
export function EmailSignatureLinkButton({ documentId }: { documentId: string }) {
  const [loading, setLoading] = useState(false);

  async function handleClick() {
    setLoading(true);
    try {
      const res = await fetch(`/api/documents/${documentId}/send-signature-email`, {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to send email");

      toast.success(`Signature link emailed to ${data.sent_to}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Button variant="outline" size="sm" onClick={handleClick} disabled={loading}>
      {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />}
      Email Signature Link
    </Button>
  );
}
