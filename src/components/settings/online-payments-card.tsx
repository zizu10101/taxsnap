"use client";

import { useState } from "react";
import { CreditCard, ExternalLink, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { CONNECT_STATUS_LABEL, type ConnectStatus } from "@/lib/connect-status";
import { ONLINE_PAYMENTS_DISCLOSURE_SHORT } from "@/lib/online-payments-terms";
import { OnlinePaymentsTermsDialog } from "@/components/settings/online-payments-terms-dialog";

const BUTTON_LABEL: Record<ConnectStatus, string> = {
  not_connected: "Connect Stripe",
  incomplete: "Finish setup",
  restricted: "Fix in Stripe",
  active: "Open onboarding again",
  disconnected: "Reconnect Stripe",
};

const STATUS_HELP: Record<ConnectStatus, string> = {
  not_connected: "Let clients pay your invoices by card. The money goes straight to your own Stripe account.",
  incomplete: "You started connecting Stripe but have not finished. Pick up where you left off.",
  restricted: "Stripe needs more information before you can take card payments. Open Stripe to finish.",
  active: "Clients can pay the full balance of a sent invoice by card from the invoice link.",
  disconnected: "Your Stripe account was disconnected from TaxSnap. Connect again to take card payments.",
};

// Settings > Online payments. Open to every plan. The status is the one stored on the
// profile by the return page and the Stripe webhook; "Pay now" on a public invoice
// shows only when it is "active".
export function OnlinePaymentsCard({
  status,
  returnFlag,
  returnCode = null,
  termsAcceptedAt = null,
}: {
  status: ConnectStatus;
  /** ?stripe=... from the Stripe return/refresh redirect, shown once as a message. */
  returnFlag: string | null;
  /** The Stripe error code from a failed return/refresh (no message text). */
  returnCode?: string | null;
  /** When the owner accepted the disclosure; null = the dialog must be ticked before Stripe opens. */
  termsAcceptedAt?: string | null;
}) {
  const [busy, setBusy] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);

  // `acceptTerms` is true only when the owner just ticked the box in the dialog.
  async function connect(acceptTerms: boolean) {
    setBusy(true);
    try {
      const res = await fetch("/api/stripe/connect/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accept_terms: acceptTerms }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || typeof data.url !== "string") throw new Error(
          `${data.error || "Could not start Stripe setup."}${data.code ? ` (code: ${data.code})` : ""}`,
        );
      window.location.assign(data.url);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Something went wrong");
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2">
            <CreditCard className="h-4 w-4" />
            Online payments
          </CardTitle>
          <Badge variant={status === "active" ? "default" : "outline"}>{CONNECT_STATUS_LABEL[status]}</Badge>
        </div>
        <CardDescription>{STATUS_HELP[status]}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {returnFlag === "active" && (
          <p className="rounded-md bg-success/10 p-2 text-success">Stripe is connected. Card payments are on.</p>
        )}
        {(returnFlag === "incomplete" || returnFlag === "restricted") && (
          <p className="rounded-md bg-warning/10 p-2 text-warning">
            Stripe still needs a few details before you can take card payments.
          </p>
        )}
        {returnFlag === "error" && (
          <p className="rounded-md bg-destructive/10 p-2 text-destructive">
            We could not check your Stripe account. Please try again.{returnCode ? ` (code: ${returnCode})` : ""}
          </p>
        )}

        {status !== "active" && (
          <Button onClick={() => (termsAcceptedAt ? connect(false) : setDialogOpen(true))} disabled={busy}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ExternalLink className="h-4 w-4" />}
            {BUTTON_LABEL[status]}
          </Button>
        )}

        <ul className="list-disc space-y-1 pl-5 text-xs text-muted-foreground">
          {ONLINE_PAYMENTS_DISCLOSURE_SHORT.map((line) => (
            <li key={line}>{line}</li>
          ))}
          <li>Payouts to your bank follow your Stripe account settings.</li>
          <li>Card payments are recorded on the invoice like any other payment, so your HST figures stay right.</li>
        </ul>
      </CardContent>
      <OnlinePaymentsTermsDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        loading={busy}
        onConfirm={() => connect(true)}
      />
    </Card>
  );
}
