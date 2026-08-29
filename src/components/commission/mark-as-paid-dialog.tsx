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
  const [rangeTotal, setRangeTotal] = useState<number | null>(null);
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
    const params = new URLSearchParams({
      stylist_id: stylist.id,
      status: "unpaid",
      from: rangeStart,
      to: rangeEnd,
    });
    fetch(`/api/commission-entries?${params.toString()}`)
      .then((res) => res.json())
      .then((data) => {
        if (totalTokenRef.current !== token) return;
        const entries = (data.entries ?? []) as CommissionEntryWithRelations[];
        setRangeTotal(entries.reduce((sum, e) => sum + e.commission_owed, 0));
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

  const rangeInvalid = !loadingTotal && rangeTotal === 0;

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
              <div className="rounded-lg border border-border bg-muted/30 p-3 text-center">
                <p className="text-xs text-muted-foreground">Total for this range</p>
                <p className="text-lg font-semibold text-primary tabular-nums">
                  {loadingTotal ? (
                    <Loader2 className="mx-auto h-4 w-4 animate-spin" />
                  ) : (
                    formatCurrency(rangeTotal ?? 0)
                  )}
                </p>
                {rangeInvalid && (
                  <p className="mt-1 text-xs text-destructive">No unpaid entries in this range.</p>
                )}
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button
                onClick={handleConfirmRange}
                disabled={creating || loadingTotal || rangeInvalid}
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
