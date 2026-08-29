"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { PayoutPinStep, PayoutNoPinStep } from "@/components/commission/payout-confirm-steps";
import type { CommissionEntryWithRelations, Payout, StylistPublic } from "@/lib/database.types";

type Step = "range" | "pin" | "no-pin";

function formatCurrency(amount: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(amount);
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

export function MarkAsPaidDialog({
  open,
  onOpenChange,
  stylist,
  defaultRangeStart,
  onDone,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  stylist: StylistPublic;
  defaultRangeStart: string;
  onDone: () => void;
}) {
  // No reset-on-open effect: the parent remounts this component fresh (via
  // a changing `key`) every time it's opened, since it's reused across
  // stylists/opens otherwise - see CommissionReports. That means every
  // useState initializer below only ever needs to handle a true first mount.
  const [step, setStep] = useState<Step>("range");
  const [rangeStart, setRangeStart] = useState(defaultRangeStart);
  const [rangeEnd, setRangeEnd] = useState(todayIso());
  const [entriesTotal, setEntriesTotal] = useState(0);
  const [entryCount, setEntryCount] = useState(0);
  // Not scoped to the range - create_payout() folds in *every* unapplied
  // adjustment for the stylist regardless of what range is being paid out
  // (an adjustment corrects a past payout, it isn't tied to a service
  // date), so the preview has to mirror that or it'd understate what the
  // real payout ends up being.
  const [adjustmentsTotal, setAdjustmentsTotal] = useState(0);
  const [adjustmentCount, setAdjustmentCount] = useState(0);
  // A fresh mount always starts loading (the effect below fires immediately
  // for the default range) - never set synchronously inside an effect body.
  const [loadingTotal, setLoadingTotal] = useState(true);
  const [creating, setCreating] = useState(false);
  const [payoutId, setPayoutId] = useState<string | null>(null);
  const totalTokenRef = useRef(0);

  // Recalculates the total for whatever range is currently selected here -
  // never reuses Reports' own running total, since the owner can narrow or
  // widen this range independently of whatever the page itself is filtered
  // to. loadingTotal is only ever set to true from the range inputs' own
  // onChange handlers (real events, not here) or the initial useState above,
  // so this effect body only ever calls setState from inside the fetch's
  // own callbacks.
  useEffect(() => {
    if (step !== "range" || !rangeStart || !rangeEnd) return;
    const token = ++totalTokenRef.current;
    const entriesParams = new URLSearchParams({
      stylist_id: stylist.id,
      status: "unpaid",
      from: rangeStart,
      to: rangeEnd,
    });
    const adjustmentsParams = new URLSearchParams({
      stylist_id: stylist.id,
      applied: "false",
    });
    Promise.all([
      fetch(`/api/commission-entries?${entriesParams.toString()}`).then((res) => res.json()),
      fetch(`/api/adjustments?${adjustmentsParams.toString()}`).then((res) => res.json()),
    ])
      .then(([entriesData, adjustmentsData]) => {
        if (totalTokenRef.current !== token) return;
        const entries = (entriesData.entries ?? []) as CommissionEntryWithRelations[];
        const adjustments = (adjustmentsData.adjustments ?? []) as { amount: number }[];
        setEntriesTotal(entries.reduce((sum, e) => sum + e.commission_owed, 0));
        setEntryCount(entries.length);
        setAdjustmentsTotal(adjustments.reduce((sum, a) => sum + a.amount, 0));
        setAdjustmentCount(adjustments.length);
      })
      .finally(() => {
        if (totalTokenRef.current === token) setLoadingTotal(false);
      });
  }, [step, stylist.id, rangeStart, rangeEnd]);

  // The only place a payout is ever created - once per dialog flow, either
  // right after the range is confirmed (when the stylist has a PIN) or from
  // "Proceed without confirmation" (when they don't, or it's skipped).
  async function createPayout(): Promise<Payout | null> {
    setCreating(true);
    try {
      const res = await fetch("/api/payouts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          stylist_id: stylist.id,
          range_start: rangeStart,
          range_end: rangeEnd,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to create payout");
      setPayoutId(data.payout.id);
      return data.payout as Payout;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create payout");
      return null;
    } finally {
      setCreating(false);
    }
  }

  // Closing while a payout exists always notifies the parent to refetch,
  // regardless of whether that happened via an explicit button or the
  // dialog just being dismissed (backdrop/Escape/close button) - the
  // payout is already correct and linked either way, Reports just needs to
  // reflect it.
  function close() {
    if (payoutId) onDone();
    onOpenChange(false);
  }

  async function handleConfirmRange() {
    if (stylist.has_pin) {
      const payout = await createPayout();
      if (payout) setStep("pin");
    } else {
      // Don't create anything yet - the owner still gets to choose between
      // setting up a PIN first or explicitly proceeding without one.
      setStep("no-pin");
    }
  }

  function handleConfirmed() {
    toast.success(`Payout confirmed by ${stylist.name}`);
    onDone();
    onOpenChange(false);
  }

  // Backs both "Skip for now" (PIN step - payout already exists) and
  // "Proceed without confirmation" (no-PIN step - payout doesn't exist
  // yet). Either way the payout ends up saved and correct, just left
  // confirmed_by_stylist: false for the owner to notice later in Reports.
  async function handleProceedUnconfirmed() {
    if (!payoutId) {
      const payout = await createPayout();
      if (!payout) return;
    }
    toast.success("Payout saved - not yet confirmed by stylist");
    onDone();
    onOpenChange(false);
  }

  const previewTotal = entriesTotal + adjustmentsTotal;
  // Count-based, not dollar-total-based - mirrors create_payout()'s own
  // check exactly. A lone adjustment with zero new entries (or a
  // combination that nets to zero) is still a valid payout to create.
  const rangeInvalid = !loadingTotal && entryCount === 0 && adjustmentCount === 0;
  const negativeTotal = !loadingTotal && !rangeInvalid && previewTotal < 0;

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(next) : close())}>
      <DialogContent>
        {step === "range" && (
          <>
            <DialogHeader>
              <DialogTitle>Mark {stylist.name} as paid</DialogTitle>
              <DialogDescription>
                Choose the date range to pay out - every unpaid entry in this range will be
                included.
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-3">
              <div className="flex items-center gap-2">
                <div className="flex-1 space-y-1">
                  <Label htmlFor="payout-range-start" className="sr-only">
                    From
                  </Label>
                  <Input
                    id="payout-range-start"
                    type="date"
                    value={rangeStart}
                    onChange={(e) => {
                      setRangeStart(e.target.value);
                      setLoadingTotal(true);
                    }}
                  />
                </div>
                <span className="text-sm text-muted-foreground">to</span>
                <div className="flex-1 space-y-1">
                  <Label htmlFor="payout-range-end" className="sr-only">
                    To
                  </Label>
                  <Input
                    id="payout-range-end"
                    type="date"
                    value={rangeEnd}
                    onChange={(e) => {
                      setRangeEnd(e.target.value);
                      setLoadingTotal(true);
                    }}
                  />
                </div>
              </div>
              <div className="rounded-lg border border-border bg-muted/30 p-3">
                {loadingTotal ? (
                  <Loader2 className="mx-auto h-4 w-4 animate-spin" />
                ) : (
                  <div className="space-y-1">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">Entries</span>
                      <span className="tabular-nums">{formatCurrency(entriesTotal)}</span>
                    </div>
                    {adjustmentCount > 0 && (
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-muted-foreground">Adjustment</span>
                        <span className="tabular-nums">
                          {adjustmentsTotal > 0 ? "+" : ""}
                          {formatCurrency(adjustmentsTotal)}
                        </span>
                      </div>
                    )}
                    <div className="flex items-center justify-between border-t border-border pt-1 text-lg font-semibold">
                      <span>Total</span>
                      <span className={`tabular-nums ${negativeTotal ? "text-destructive" : "text-primary"}`}>
                        {formatCurrency(previewTotal)}
                      </span>
                    </div>
                  </div>
                )}
                {rangeInvalid && (
                  <p className="mt-1 text-center text-xs text-destructive">
                    No unpaid entries in this range.
                  </p>
                )}
                {negativeTotal && (
                  <p className="mt-1 text-center text-xs text-destructive">
                    This would be negative due to an outstanding adjustment - narrow the range or
                    wait for more entries to accrue.
                  </p>
                )}
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button
                onClick={handleConfirmRange}
                disabled={creating || loadingTotal || rangeInvalid || negativeTotal}
              >
                {creating && <Loader2 className="h-4 w-4 animate-spin" />}
                Confirm payout
              </Button>
            </DialogFooter>
          </>
        )}

        {step === "pin" && payoutId && (
          <PayoutPinStep
            stylistId={stylist.id}
            stylistName={stylist.name}
            payoutId={payoutId}
            dismissLabel="Skip for now"
            onDismiss={handleProceedUnconfirmed}
            onConfirmed={handleConfirmed}
          />
        )}

        {step === "no-pin" && (
          <PayoutNoPinStep
            stylistName={stylist.name}
            dismissLabel="Proceed without confirmation"
            dismissLoading={creating}
            onDismiss={handleProceedUnconfirmed}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
