"use client";

import { useEffect, useState } from "react";
import { Loader2, Pencil, Plus, Trash2, Users } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CommissionNav } from "@/components/commission/commission-nav";
import { DateRangeFilter } from "@/components/dashboard/date-range-filter";
import { UsageLimitBar } from "@/components/dashboard/usage-limit-bar";
import { RenterDialog } from "@/components/rentals/renter-dialog";
import { LogRentPaymentDialog } from "@/components/rentals/log-rent-payment-dialog";
import { PLAN_LIMITS } from "@/lib/plan-limits";
import { getPresetRange, type DateRange, type RangePreset } from "@/lib/date-range";
import type { Renter, RentPaymentWithRenter, SubscriptionStatus } from "@/lib/database.types";

function formatCurrency(amount: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(amount);
}

// paid_date is a plain YYYY-MM-DD date, not a timestamp - append a time so
// `new Date(...)` parses in local time instead of UTC midnight, same fix
// commission-reports.tsx's own formatDate already applies to
// payouts.range_start/range_end.
function formatDate(dateStr: string) {
  return new Date(`${dateStr}T00:00:00`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

const RATE_CADENCE_LABEL = { weekly: "wk", monthly: "mo" } as const;

export function RentalsClient({
  initialRenters,
  subscriptionStatus,
  isPro,
}: {
  initialRenters: Renter[];
  subscriptionStatus: SubscriptionStatus;
  // Only threaded through to CommissionNav, to show/hide the Overview tab.
  isPro: boolean;
}) {
  const [renters, setRenters] = useState(initialRenters);
  const [renterDialogOpen, setRenterDialogOpen] = useState(false);
  const [editingRenter, setEditingRenter] = useState<Renter | null>(null);

  const [logDialogOpen, setLogDialogOpen] = useState(false);
  const [loggingRenter, setLoggingRenter] = useState<Renter | null>(null);
  const [editingPayment, setEditingPayment] = useState<RentPaymentWithRenter | null>(null);

  const [preset, setPreset] = useState<RangePreset>("this-month");
  const [range, setRange] = useState<DateRange>(getPresetRange("this-month"));
  const [payments, setPayments] = useState<RentPaymentWithRenter[]>([]);
  // Starts true (no server-provided initial payments to seed with, unlike
  // CommissionOverview's initialRangeData) - the mount-time run of the
  // effect below never sets this itself, only handleRangeChange does, per
  // the react-hooks/set-state-in-effect rule this project follows
  // elsewhere (see CommissionOverview's own comment on the same pattern).
  const [loading, setLoading] = useState(true);

  // paid_date is a plain date, so range.start/range.end (already
  // inclusive "YYYY-MM-DD" strings) are used directly - no
  // rangeToUtcBounds conversion, same reasoning as GET
  // /api/rent-payments's own comment.
  useEffect(() => {
    const params = new URLSearchParams();
    if (range.start) params.set("from", range.start);
    if (range.end) params.set("to", range.end);

    fetch(`/api/rent-payments?${params.toString()}`)
      .then((res) => (res.ok ? res.json() : Promise.reject()))
      .then((data) => setPayments(data.payments ?? []))
      .catch(() => toast.error("Failed to load rent payments for this range"))
      .finally(() => setLoading(false));
  }, [range]);

  function handleRangeChange(nextPreset: RangePreset, nextRange: DateRange) {
    setLoading(true);
    setPreset(nextPreset);
    setRange(nextRange);
  }

  function upsertRenter(renter: Renter) {
    setRenters((prev) => {
      const exists = prev.some((r) => r.id === renter.id);
      const next = exists ? prev.map((r) => (r.id === renter.id ? renter : r)) : [...prev, renter];
      return next.sort((a, b) => a.name.localeCompare(b.name));
    });
  }

  function upsertPayment(payment: RentPaymentWithRenter) {
    setPayments((prev) => {
      const exists = prev.some((p) => p.id === payment.id);
      const next = exists ? prev.map((p) => (p.id === payment.id ? payment : p)) : [payment, ...prev];
      return next.sort((a, b) => (a.paid_date < b.paid_date ? 1 : -1));
    });
  }

  async function toggleActive(renter: Renter) {
    try {
      const res = await fetch(`/api/renters/${renter.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_active: !renter.is_active }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (data.code === "FREE_LIMIT_REACHED") {
          toast.error(data.error);
          return;
        }
        throw new Error(data.error || "Failed to update");
      }
      upsertRenter(data.renter as Renter);
      toast.success(renter.is_active ? "Renter deactivated" : "Renter reactivated");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Something went wrong");
    }
  }

  async function deletePayment(payment: RentPaymentWithRenter) {
    try {
      const res = await fetch(`/api/rent-payments/${payment.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to delete");
      setPayments((prev) => prev.filter((p) => p.id !== payment.id));
      toast.success("Payment removed");
    } catch {
      toast.error("Failed to remove payment");
    }
  }

  const activeRenters = renters.filter((r) => r.is_active);
  const inactiveRenters = renters.filter((r) => !r.is_active);
  const totalCollected = payments.reduce((sum, p) => sum + p.amount, 0);

  return (
    <div className="space-y-4">
      <CommissionNav active="rentals" isPro={isPro} />

      <Card className="border-dashed">
        <CardContent className="py-3 text-xs text-muted-foreground">
          Private record-keeping only - renters run their own separate business, so
          this never feeds into HST, sales, or any other tax-facing number in TaxSnap.
        </CardContent>
      </Card>

      <UsageLimitBar
        tier={subscriptionStatus}
        current={activeRenters.length}
        limit={PLAN_LIMITS[subscriptionStatus].activeRenters}
        noun="active renter"
      />

      <Button
        className="w-full"
        onClick={() => {
          setEditingRenter(null);
          setRenterDialogOpen(true);
        }}
      >
        <Plus className="h-4 w-4" />
        New renter
      </Button>

      {renters.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-10 text-center text-muted-foreground">
            <Users className="h-8 w-8" />
            <p className="text-sm">No renters yet.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {[...activeRenters, ...inactiveRenters].map((renter) => (
            <Card key={renter.id} className={!renter.is_active ? "opacity-60" : undefined}>
              <CardContent className="flex items-center justify-between gap-3 py-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="truncate font-medium">{renter.name}</p>
                    {!renter.is_active && <Badge variant="outline">Inactive</Badge>}
                  </div>
                  <p className="text-xs text-muted-foreground tabular-nums">
                    {formatCurrency(renter.rental_rate)}/{RATE_CADENCE_LABEL[renter.rate_cadence]}
                  </p>
                </div>
                <div className="flex items-center gap-1">
                  <Button
                    size="sm"
                    onClick={() => {
                      setLoggingRenter(renter);
                      setEditingPayment(null);
                      setLogDialogOpen(true);
                    }}
                  >
                    Log payment
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    title="Edit"
                    onClick={() => {
                      setEditingRenter(renter);
                      setRenterDialogOpen(true);
                    }}
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => toggleActive(renter)}>
                    {renter.is_active ? "Deactivate" : "Reactivate"}
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <div className="space-y-3 border-t border-border pt-4">
        <h2 className="text-sm font-semibold text-muted-foreground">Rent collected</h2>
        <DateRangeFilter preset={preset} range={range} onChange={handleRangeChange} />

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Total collected</CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="flex h-10 items-center">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <p className="text-2xl font-semibold tabular-nums">
                {formatCurrency(totalCollected)}
              </p>
            )}
          </CardContent>
        </Card>

        {!loading && payments.length > 0 && (
          <div className="space-y-2">
            {payments.map((payment) => (
              <div
                key={payment.id}
                className="flex items-center justify-between gap-3 rounded-lg border border-border bg-card p-3"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{payment.renter.name}</p>
                  <p className="text-xs text-muted-foreground">{formatDate(payment.paid_date)}</p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span className="text-sm tabular-nums">{formatCurrency(payment.amount)}</span>
                  <Button
                    variant="ghost"
                    size="icon"
                    title="Edit"
                    onClick={() => {
                      setEditingPayment(payment);
                      setLoggingRenter(null);
                      setLogDialogOpen(true);
                    }}
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    title="Delete"
                    onClick={() => deletePayment(payment)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <RenterDialog
        key={editingRenter?.id ?? "new"}
        open={renterDialogOpen}
        onOpenChange={setRenterDialogOpen}
        renter={editingRenter}
        onSaved={upsertRenter}
      />

      <LogRentPaymentDialog
        key={editingPayment?.id ?? loggingRenter?.id ?? "new"}
        open={logDialogOpen}
        onOpenChange={setLogDialogOpen}
        renter={loggingRenter}
        payment={editingPayment}
        onSaved={upsertPayment}
      />
    </div>
  );
}
