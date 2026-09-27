"use client";

import { useState } from "react";
import { Link2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

// Lazily creates the estimate's sign_token on first use (see POST
// /api/documents/[id]/sign-link) and copies the resulting public
// /sign/[token] URL to the clipboard - the simplest, most universally
// reliable way to hand a client a link, rather than hooking into
// ShareDocumentButton's file-sharing logic for what's just a plain URL.
export function GetSignatureLinkButton({ documentId }: { documentId: string }) {
  const [loading, setLoading] = useState(false);

  async function handleClick() {
    setLoading(true);
    try {
      const res = await fetch(`/api/documents/${documentId}/sign-link`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to create signature link");

      await navigator.clipboard.writeText(data.url);
      toast.success("Signature link copied to clipboard");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Button variant="outline" size="sm" onClick={handleClick} disabled={loading}>
      {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link2 className="h-4 w-4" />}
      Get Signature Link
    </Button>
  );
}
