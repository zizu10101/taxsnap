"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import type { SubscriptionStatus } from "@/lib/database.types";

const TEXTAREA_CLASS =
  "min-h-20 w-full rounded-lg border border-input bg-transparent px-2.5 py-1.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30";
const SELECT_CLASS =
  "h-8 rounded-lg border border-input bg-transparent px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-input/30";

type ApiResult<T> = { ok: true; data: T } | { ok: false; error: string };

async function postJson<T = Record<string, unknown>>(
  path: string,
  body: Record<string, unknown>,
): Promise<ApiResult<T>> {
  try {
    const res = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: data.error ?? `Request failed (${res.status})` };
    return { ok: true, data };
  } catch {
    return { ok: false, error: "Network error - nothing was changed." };
  }
}

export interface RefundableView {
  remainingCents: number;
  currency: string;
  paidAt: string | null;
}

type Confirming =
  | { kind: "cancel"; mode: "period_end" | "immediate" }
  | { kind: "refund" }
  | null;

export function AccountActions({
  accountId,
  email,
  currentTier,
  overrideBlocked,
  canCancel,
  cancelsAtPeriodEnd,
  refundable,
}: {
  accountId: string;
  email: string;
  currentTier: SubscriptionStatus;
  overrideBlocked: boolean;
  canCancel: boolean;
  cancelsAtPeriodEnd: boolean;
  refundable: RefundableView | null;
}) {
  const router = useRouter();
  const base = `/api/admin/accounts/${accountId}`;

  // --- Tier override ---
  const [tier, setTier] = useState<SubscriptionStatus>(currentTier);
  const [tierReason, setTierReason] = useState("");
  const [tierBusy, setTierBusy] = useState(false);

  async function submitTier() {
    setTierBusy(true);
    const result = await postJson(`${base}/tier`, { tier, reason: tierReason });
    setTierBusy(false);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success(`Tier set to ${tier}.`);
    setTierReason("");
    router.refresh();
  }

  // --- Cancel / refund (shared confirm dialog) ---
  const [confirming, setConfirming] = useState<Confirming>(null);
  const [reason, setReason] = useState("");
  const [confirmEmail, setConfirmEmail] = useState("");
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);

  function openConfirm(next: Exclude<Confirming, null>) {
    setReason("");
    setConfirmEmail("");
    setAmount("");
    setConfirming(next);
  }

  const emailOk = confirmEmail.trim().toLowerCase() === email.toLowerCase();
  const canSubmitConfirm = !!reason.trim() && emailOk && !busy;

  async function submitConfirm() {
    if (!confirming) return;
    setBusy(true);
    const result =
      confirming.kind === "cancel"
        ? await postJson(`${base}/cancel`, { mode: confirming.mode, reason, confirmEmail })
        : await postJson(`${base}/refund`, { amount, reason, confirmEmail });
    setBusy(false);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success(confirming.kind === "cancel" ? "Subscription canceled." : "Refund issued.");
    setConfirming(null);
    router.refresh();
  }

  const remaining = refundable ? refundable.remainingCents / 100 : 0;
  const money = (n: number) =>
    new Intl.NumberFormat("en-CA", { style: "currency", currency: refundable?.currency ?? "cad" }).format(n);

  // --- Auth links ---
  const [linkReason, setLinkReason] = useState("");
  const [linkBusy, setLinkBusy] = useState(false);
  const [link, setLink] = useState<{ kind: string; url: string } | null>(null);

  async function generateLink(kind: "confirmation" | "recovery") {
    setLinkBusy(true);
    setLink(null);
    const result = await postJson<{ link: string }>(`${base}/auth-link`, { kind, reason: linkReason });
    setLinkBusy(false);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    setLink({ kind, url: result.data.link });
    setLinkReason("");
    router.refresh();
  }

  // --- Notes ---
  const [note, setNote] = useState("");
  const [noteBusy, setNoteBusy] = useState(false);

  async function addNote() {
    setNoteBusy(true);
    const result = await postJson(`${base}/notes`, { reason: note });
    setNoteBusy(false);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    setNote("");
    router.refresh();
  }

  const confirmTitle =
    confirming?.kind === "refund"
      ? "Refund payment"
      : confirming?.mode === "immediate"
        ? "Cancel subscription now"
        : "Cancel at period end";
  const confirmBody =
    confirming?.kind === "refund"
      ? `Issues a real refund to ${email} through Stripe. It does not cancel the subscription.`
      : confirming?.mode === "immediate"
        ? `Ends ${email}'s subscription immediately, with no proration and no refund. Their account drops to free.`
        : `${email} keeps access until the current period ends, then the subscription stops renewing. No refund.`;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Manual tier override</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {overrideBlocked ? (
            <p className="text-sm text-muted-foreground">
              Blocked: this account has a live Stripe subscription (or Stripe couldn&apos;t be checked),
              and the next webhook would silently revert an override. Change the subscription in
              Stripe instead. Overrides are for accounts with no subscription - comps and test
              accounts.
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">
              Writes <code>profiles.subscription_status</code> only. No Stripe change.
            </p>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <select
              className={SELECT_CLASS}
              value={tier}
              onChange={(e) => setTier(e.target.value as SubscriptionStatus)}
              disabled={overrideBlocked}
              aria-label="Tier"
            >
              <option value="free">free</option>
              <option value="basic">basic</option>
              <option value="pro">pro</option>
            </select>
            <Input
              className="min-w-48 flex-1"
              placeholder="Reason (required)"
              value={tierReason}
              onChange={(e) => setTierReason(e.target.value)}
              disabled={overrideBlocked}
              maxLength={500}
            />
            <Button
              onClick={submitTier}
              disabled={overrideBlocked || tierBusy || tier === currentTier || !tierReason.trim()}
            >
              {tierBusy ? "Saving…" : "Set tier"}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Stripe subscription</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {!canCancel && !refundable && (
            <p className="text-sm text-muted-foreground">
              No live Stripe subscription or refundable payment for this account.
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            {canCancel && !cancelsAtPeriodEnd && (
              <Button variant="outline" onClick={() => openConfirm({ kind: "cancel", mode: "period_end" })}>
                Cancel at period end
              </Button>
            )}
            {canCancel && (
              <Button variant="destructive" onClick={() => openConfirm({ kind: "cancel", mode: "immediate" })}>
                Cancel now
              </Button>
            )}
            {refundable && refundable.remainingCents > 0 && (
              <Button variant="destructive" onClick={() => openConfirm({ kind: "refund" })}>
                Refund…
              </Button>
            )}
          </div>
          {canCancel && cancelsAtPeriodEnd && (
            <p className="text-xs text-muted-foreground">Already set to cancel at period end.</p>
          )}
          {refundable && (
            <p className="text-xs text-muted-foreground">
              Latest payment: {money(remaining)} refundable
              {refundable.paidAt ? ` (paid ${refundable.paidAt.slice(0, 10)})` : ""}.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Sign-in links</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Generates a one-time link to send the user yourself - nothing is emailed. Whoever opens it
            is signed in as this account, so treat it like a password; open it in a private window if
            testing.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Input
              className="min-w-48 flex-1"
              placeholder="Reason (required)"
              value={linkReason}
              onChange={(e) => setLinkReason(e.target.value)}
              maxLength={500}
            />
            <Button variant="outline" disabled={linkBusy || !linkReason.trim()} onClick={() => generateLink("confirmation")}>
              Confirmation link
            </Button>
            <Button variant="outline" disabled={linkBusy || !linkReason.trim()} onClick={() => generateLink("recovery")}>
              Password reset link
            </Button>
          </div>
          {link && (
            <div className="space-y-1.5 rounded-lg border border-border bg-muted/50 p-3">
              <p className="text-xs font-medium">
                {link.kind === "recovery" ? "Password reset" : "Confirmation / sign-in"} link - shown once,
                not stored:
              </p>
              <p className="break-all text-xs tabular-nums">{link.url}</p>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  navigator.clipboard.writeText(link.url).then(
                    () => toast.success("Link copied."),
                    () => toast.error("Couldn't copy - select the text instead."),
                  );
                }}
              >
                Copy
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Add a note</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <textarea
            className={TEXTAREA_CLASS}
            placeholder="e.g. Called them about the billing mismatch."
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={2000}
          />
          <Button onClick={addNote} disabled={noteBusy || !note.trim()}>
            {noteBusy ? "Saving…" : "Add note"}
          </Button>
        </CardContent>
      </Card>

      <Dialog open={confirming !== null} onOpenChange={(open) => !open && !busy && setConfirming(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{confirmTitle}</DialogTitle>
            <DialogDescription>{confirmBody}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            {confirming?.kind === "refund" && (
              <div className="space-y-1">
                <label className="text-xs font-medium" htmlFor="refund-amount">
                  Amount (max {money(remaining)}; blank = full)
                </label>
                <Input
                  id="refund-amount"
                  inputMode="decimal"
                  placeholder={remaining.toFixed(2)}
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                />
              </div>
            )}
            <div className="space-y-1">
              <label className="text-xs font-medium" htmlFor="confirm-reason">
                Reason
              </label>
              <Input
                id="confirm-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                maxLength={500}
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium" htmlFor="confirm-email">
                Type <strong>{email}</strong> to confirm
              </label>
              <Input
                id="confirm-email"
                value={confirmEmail}
                onChange={(e) => setConfirmEmail(e.target.value)}
                autoComplete="off"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirming(null)} disabled={busy}>
              Back
            </Button>
            <Button variant="destructive" onClick={submitConfirm} disabled={!canSubmitConfirm}>
              {busy ? "Working…" : confirming?.kind === "refund" ? "Issue refund" : "Cancel subscription"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
