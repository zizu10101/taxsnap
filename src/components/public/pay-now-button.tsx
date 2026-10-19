"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

// "Pay now" on the public invoice page. It sends nothing but the token (in the
// URL): the server works out the amount from the invoice, so the amount shown here
// is only a label and can not be changed by the browser.
export function PayNowButton({ token, amountLabel }: { token: string; amountLabel: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handlePay() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/public/invoice/${encodeURIComponent(token)}/checkout`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || typeof data.url !== "string") {
        throw new Error(data.error || "Could not start the payment. Please try again.");
      }
      window.location.assign(data.url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      <Button size="lg" className="h-12 w-full text-base" onClick={handlePay} disabled={busy}>
        {busy && <Loader2 className="h-4 w-4 animate-spin" />}
        Pay {amountLabel} now
      </Button>
      {error && <p className="text-center text-sm text-destructive">{error}</p>}
      <p className="text-center text-xs text-muted-foreground">Secure card payment by Stripe.</p>
    </div>
  );
}
