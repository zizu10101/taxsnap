"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronUp, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { DateRangeFilter } from "@/components/dashboard/date-range-filter";
import { CommissionNav } from "@/components/commission/commission-nav";
import { FieldTrail, PriceTrail, EditedBadge } from "@/components/commission/entry-trail";
import { EditEntryDialog } from "@/components/commission/edit-entry-dialog";
import { CommissionReportShareButtons } from "@/components/commission/commission-report-share-buttons";
import { MarkAsPaidDialog } from "@/components/commission/mark-as-paid-dialog";
import { ConfirmPayoutDialog } from "@/components/commission/confirm-payout-dialog";
import { AddAdjustmentDialog } from "@/components/commission/add-adjustment-dialog";
import {
  getPresetRange,
  describeRange,
  toIsoDate,
  rangeToUtcBounds,
  type DateRange,
  type RangePreset,
} from "@/lib/date-range";
import type { BusinessInfo } from "@/components/invoices/document-detail";
import type {
  Adjustment,
  CommissionEntryWithRelations,
  Payout,
  Service,
  StylistPublic,
} from "@/lib/database.types";

const ALL_STYLISTS = "__all__";
type PaidFilter = "unpaid" | "paid";

function formatCurrency(amount: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(amount);
}

function formatDateTime(isoStr: string) {
  return new Date(isoStr).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

// range_start/range_end are plain YYYY-MM-DD dates, not timestamps - append
// a time so `new Date(...)` parses in local time instead of UTC midnight,
// which would otherwise display as the previous day in western timezones.
function formatDate(dateStr: string) {
  return new Date(`${dateStr}T00:00:00`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

export function CommissionReports({
  stylists,
  services,
  initialEntries,
  business,
  logoPath,
}: {
  stylists: StylistPublic[];
  services: Service[];
  initialEntries: CommissionEntryWithRelations[];
  business: BusinessInfo;
  logoPath: string | null;
}) {
  const [stylistId, setStylistId] = useState<string>(ALL_STYLISTS);
  const [preset, setPreset] = useState<RangePreset>("this-month");
  const [range, setRange] = useState<DateRange>(getPresetRange("this-month"));
  const [entries, setEntries] = useState(initialEntries);
  // Paid/unpaid only applies once a single stylist is selected - the "All
  // Stylists" view is an aggregate rollup, not a list of individual entries,
  // so there's nothing for the toggle to scope there.
  const [paidFilter, setPaidFilter] = useState<PaidFilter>("unpaid");
  const [deleteTarget, setDeleteTarget] = useState<CommissionEntryWithRelations | null>(null);
  const [deleting, setDeleting] = useState(false);
  // Same EditEntryDialog as the staff Log tab's Today's entries, same
  // mount-only-while-editing pattern as ConfirmPayoutDialog/
  // AddAdjustmentDialog below - Unpaid rows are the only ones that render
  // this as tappable (Paid rows have no click handler at all).
  const [editingEntry, setEditingEntry] = useState<CommissionEntryWithRelations | null>(null);
  const [markPaidOpen, setMarkPaidOpen] = useState(false);
  // Bumped every time the dialog is opened so it's keyed fresh each time
  // (see MarkAsPaidDialog) - it's reused across stylists/opens otherwise,
  // and it needs a real remount rather than an effect-driven reset.
  const [markPaidKey, setMarkPaidKey] = useState(0);
  // Unlike MarkAsPaidDialog (one persistent instance per selected stylist),
  // ConfirmPayoutDialog is only ever mounted while a target exists - it
  // naturally unmounts/remounts fresh on every open this way, no key needed.
  const [confirmTarget, setConfirmTarget] = useState<{
    payoutId: string;
    stylist: StylistPublic;
  } | null>(null);
  // Fetched separately from `entries` (see GET /api/payouts) - voiding
  // unlinks a payout's entries entirely, so a voided payout has nothing
  // left in commission_entries to drive a row in the entries-based list
  // above. Collapsed by default: this is meant to be rare.
  const [voidedPayouts, setVoidedPayouts] = useState<Payout[]>([]);
  const [voidedOpen, setVoidedOpen] = useState(false);
  const [voidTarget, setVoidTarget] = useState<{
    payoutId: string;
    stylistName: string;
    totalAmount: number;
    rangeStart: string;
    rangeEnd: string;
  } | null>(null);
  const [voiding, setVoiding] = useState(false);
  // Unapplied adjustments for the selected stylist - not date-range-scoped
  // (see GET /api/adjustments), since create_payout() folds in every
  // unapplied one regardless of what range a future payout covers. Only
  // meaningful on the Unpaid tab, where they preview what's about to be
  // owed on top of the entries total.
  const [pendingAdjustments, setPendingAdjustments] = useState<Adjustment[]>([]);
  const [adjustmentTarget, setAdjustmentTarget] = useState<{
    payoutId: string;
    stylistId: string;
    stylistName: string;
  } | null>(null);
  // The Paid tab is organized around payouts, fetched directly (GET
  // /api/payouts), not derived from `entries` - a payout created purely
  // from a folded-in adjustment (no new commission_entries in its range)
  // has nothing in commission_entries to represent it, so deriving payouts
  // from entries would make that payout invisible here entirely, same root
  // cause as why voided payouts (above) can't be derived from entries.
  const [paidPayouts, setPaidPayouts] = useState<Payout[]>([]);
  // Adjustments already folded into a payout (applied_payout_id set) -
  // grouped client-side by applied_payout_id and shown under whichever
  // payout they match, same "amount + reason" style as the pending list
  // on Unpaid.
  const [appliedAdjustments, setAppliedAdjustments] = useState<Adjustment[]>([]);
  const fetchTokenRef = useRef(0);
  const voidedTokenRef = useRef(0);
  const adjustmentsTokenRef = useRef(0);
  const paidPayoutsTokenRef = useRef(0);
  const appliedAdjustmentsTokenRef = useRef(0);

  // A token guard rather than a boolean flag, so this same function can be
  // called both from the filter-driven effect below and imperatively (e.g.
  // after the Mark as Paid dialog creates/confirms a payout) without two
  // in-flight calls racing each other and an older response clobbering a
  // newer one.
  const fetchEntries = useCallback(() => {
    const token = ++fetchTokenRef.current;
    const params = new URLSearchParams();
    if (stylistId !== ALL_STYLISTS) {
      params.set("stylist_id", stylistId);
      params.set("status", paidFilter);
    }
    const { from, to } = rangeToUtcBounds(range);
    if (from) params.set("from", from);
    if (to) params.set("to", to);

    return fetch(`/api/commission-entries?${params.toString()}`)
      .then((res) => res.json())
      .then((data) => {
        if (fetchTokenRef.current === token) setEntries(data.entries ?? []);
      });
  }, [stylistId, range, paidFilter]);

  // Voided payouts are queried directly (GET /api/payouts), not derived
  // from `entries` - void_payout() nulls out payout_id on every entry it
  // covered, so there's nothing left in commission_entries to find them
  // through. Only relevant on the Paid tab for a specific stylist - skips
  // the request entirely otherwise rather than fetching and just not
  // rendering it. No setState on skip (unlike a plain early return that
  // clears state): the section is only ever rendered when paidFilter is
  // "paid" anyway, so stale data left in state while on another tab/filter
  // is never visible - it's always overwritten by a fresh fetch before the
  // Paid tab (and this state) is shown again.
  const fetchVoidedPayouts = useCallback(() => {
    if (stylistId === ALL_STYLISTS || paidFilter !== "paid") return;
    const token = ++voidedTokenRef.current;
    const params = new URLSearchParams({ stylist_id: stylistId, status: "voided" });
    const { from, to } = rangeToUtcBounds(range);
    if (from) params.set("from", from);
    if (to) params.set("to", to);

    return fetch(`/api/payouts?${params.toString()}`)
      .then((res) => res.json())
      .then((data) => {
        if (voidedTokenRef.current === token) setVoidedPayouts(data.payouts ?? []);
      });
  }, [stylistId, paidFilter, range]);

  // Not date-range-scoped (see GET /api/adjustments's own reasoning) - only
  // relevant on the Unpaid tab, where it previews what's pending on top of
  // the entries total. Same no-setState-on-skip reasoning as
  // fetchVoidedPayouts: never rendered outside paidFilter === "unpaid", so
  // stale data left in state while on another tab is never visible.
  const fetchPendingAdjustments = useCallback(() => {
    if (stylistId === ALL_STYLISTS || paidFilter !== "unpaid") return;
    const token = ++adjustmentsTokenRef.current;
    const params = new URLSearchParams({ stylist_id: stylistId, applied: "false" });

    return fetch(`/api/adjustments?${params.toString()}`)
      .then((res) => res.json())
      .then((data) => {
        if (adjustmentsTokenRef.current === token) setPendingAdjustments(data.adjustments ?? []);
      });
  }, [stylistId, paidFilter]);

  // See paidPayouts above for why this is fetched directly instead of
  // derived from entries. Same no-setState-on-skip reasoning as the other
  // Paid-tab-only fetches.
  const fetchPaidPayouts = useCallback(() => {
    if (stylistId === ALL_STYLISTS || paidFilter !== "paid") return;
    const token = ++paidPayoutsTokenRef.current;
    const params = new URLSearchParams({ stylist_id: stylistId, status: "active" });
    const { from, to } = rangeToUtcBounds(range);
    if (from) params.set("from", from);
    if (to) params.set("to", to);

    return fetch(`/api/payouts?${params.toString()}`)
      .then((res) => res.json())
      .then((data) => {
        if (paidPayoutsTokenRef.current === token) setPaidPayouts(data.payouts ?? []);
      });
  }, [stylistId, paidFilter, range]);

  // Not date-range-scoped itself (see GET /api/adjustments) - matching each
  // one against `paidPayouts` (which is range-scoped) by applied_payout_id
  // is what keeps only the relevant ones visible.
  const fetchAppliedAdjustments = useCallback(() => {
    if (stylistId === ALL_STYLISTS || paidFilter !== "paid") return;
    const token = ++appliedAdjustmentsTokenRef.current;
    const params = new URLSearchParams({ stylist_id: stylistId, applied: "true" });

    return fetch(`/api/adjustments?${params.toString()}`)
      .then((res) => res.json())
      .then((data) => {
        if (appliedAdjustmentsTokenRef.current === token)
          setAppliedAdjustments(data.adjustments ?? []);
      });
  }, [stylistId, paidFilter]);

  // Always refetches on mount too, not just on filter changes - relying on
  // `initialEntries` alone risks showing stale totals, since Next's
  // client-side router cache can serve an old RSC payload from an earlier
  // visit to this page in the same session (e.g. right after logging new
  // entries via the Log tab and clicking straight into Reports - the exact
  // normal workflow this page exists for).
  useEffect(() => {
    fetchEntries();
    fetchVoidedPayouts();
    fetchPendingAdjustments();
    fetchPaidPayouts();
    fetchAppliedAdjustments();
  }, [
    fetchEntries,
    fetchVoidedPayouts,
    fetchPendingAdjustments,
    fetchPaidPayouts,
    fetchAppliedAdjustments,
  ]);

  const stylistSelectItems = useMemo(() => {
    const map: Record<string, string> = { [ALL_STYLISTS]: "All Stylists" };
    for (const s of stylists) map[s.id] = s.name;
    return map;
  }, [stylists]);

  // One card per payout in scope, not one per entry - a payout can have
  // zero linked commission_entries (e.g. one created purely from a
  // folded-in adjustment), which an entries-driven list would never render
  // at all. paidPayouts is the authoritative source of which payouts
  // exist; entries/appliedAdjustments are just grouped under them.
  const payoutGroups = useMemo(() => {
    return paidPayouts.map((payout) => ({
      payout,
      entries: entries.filter((e) => e.payout?.id === payout.id),
      adjustments: appliedAdjustments.filter((a) => a.applied_payout_id === payout.id),
    }));
  }, [paidPayouts, entries, appliedAdjustments]);

  const totals = useMemo(() => {
    const revenue = entries.reduce((sum, e) => sum + e.price_charged, 0);
    // On the Paid tab, the commission figure has to be the sum of each
    // payout's own total_amount, not a sum of linked entries'
    // commission_owed - a payout can include a folded-in adjustment with
    // no corresponding entry, which the entries sum would silently miss.
    const commission =
      stylistId !== ALL_STYLISTS && paidFilter === "paid"
        ? payoutGroups.reduce((sum, g) => sum + g.payout.total_amount, 0)
        : entries.reduce((sum, e) => sum + e.commission_owed, 0);
    return { count: entries.length, revenue, commission };
  }, [entries, stylistId, paidFilter, payoutGroups]);

  const rollupByStylist = useMemo(() => {
    const map = new Map<string, { name: string; count: number; revenue: number; commission: number }>();
    for (const e of entries) {
      const key = e.stylist_id;
      const row = map.get(key) ?? { name: e.stylist.name, count: 0, revenue: 0, commission: 0 };
      row.count += 1;
      row.revenue += e.price_charged;
      row.commission += e.commission_owed;
      map.set(key, row);
    }
    return [...map.values()].sort((a, b) => b.commission - a.commission);
  }, [entries]);

  const selectedStylist = stylists.find((s) => s.id === stylistId) ?? null;
  const rangeLabel = describeRange(preset, range);
  const commissionLabel =
    selectedStylist ? (paidFilter === "unpaid" ? "Owed" : "Paid") : "Commission owed";

  // entries is already sorted created_at descending (see the API route), so
  // the earliest unpaid entry - the natural start of "what's outstanding" -
  // is the last item, not the first. created_at is a UTC timestamptz
  // string - slicing its first 10 characters would read off the UTC
  // calendar date, same bug as toIsoDate used to have; parsing it into a
  // Date and re-extracting via toIsoDate gets the shop-local date instead.
  const earliestUnpaidDate =
    paidFilter === "unpaid" && entries.length > 0
      ? toIsoDate(new Date(entries[entries.length - 1].created_at))
      : toIsoDate(new Date());

  // Updates the badge in place rather than refetching - we already know
  // exactly what changed. A payout can link multiple entries, so every
  // entry sharing this payout_id flips together.
  function handlePayoutConfirmed(payoutId: string) {
    setEntries((prev) =>
      prev.map((e) =>
        e.payout?.id === payoutId
          ? { ...e, payout: { ...e.payout, confirmed_by_stylist: true, confirmed_at: new Date().toISOString() } }
          : e,
      ),
    );
    setPaidPayouts((prev) =>
      prev.map((p) =>
        p.id === payoutId
          ? { ...p, confirmed_by_stylist: true, confirmed_at: new Date().toISOString() }
          : p,
      ),
    );
  }

  async function handleVoid() {
    if (!voidTarget) return;
    setVoiding(true);
    try {
      const res = await fetch(`/api/payouts/${voidTarget.payoutId}/void`, { method: "PATCH" });
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        // These two mean the server's state has already moved on from what
        // we're showing (the stylist confirmed it, or it was voided from
        // another tab/session) - a generic retry won't fix that, so refetch
        // the real state instead of just surfacing an error.
        if (res.status === 400 || res.status === 409) {
          toast.error(data.error || "This payout can no longer be voided.");
          setVoidTarget(null);
          fetchEntries();
          fetchVoidedPayouts();
          fetchPaidPayouts();
          fetchAppliedAdjustments();
          return;
        }
        throw new Error(data.error || "Failed to void payout");
      }

      const payout = data.payout as Payout;
      setEntries((prev) => prev.filter((e) => e.payout?.id !== payout.id));
      setPaidPayouts((prev) => prev.filter((p) => p.id !== payout.id));
      setVoidedPayouts((prev) => [payout, ...prev]);
      setVoidedOpen(true);
      toast.success("Payout voided - entries returned to Unpaid");
      setVoidTarget(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to void payout");
    } finally {
      setVoiding(false);
    }
  }

  // Same PATCH endpoint and same throw-on-failure contract as
  // CommissionLogger's handleSaveEdit - the dialog catches a thrown error,
  // shows it inline, and stays open for a retry rather than losing the
  // in-progress selection.
  //
  // Refetches rather than patching `entries` in place, unlike
  // CommissionLogger's version - Unpaid here is scoped by stylist_id, so a
  // reassignment can move an entry out of the currently-viewed stylist's
  // list entirely. Patching in place would leave it stuck showing under
  // the old stylist (with its newly-recalculated commission, but counted
  // toward the wrong person's total) instead of disappearing the way a
  // reassignment actually should. Same "refetch the real state" idiom
  // already used elsewhere in this file (see handleVoid's 400/409 path).
  async function handleSaveEdit(values: {
    service_id: string;
    stylist_id: string;
    customer_name: string;
  }) {
    if (!editingEntry) return;
    const res = await fetch(`/api/commission-entries/${editingEntry.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(values),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Failed to save changes");

    const updated = data.entry as CommissionEntryWithRelations;
    toast.success(`Updated: ${updated.service_name} → ${updated.stylist.name}`);
    setEditingEntry(null);
    fetchEntries();
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/commission-entries/${deleteTarget.id}`, {
        method: "DELETE",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Failed to delete entry");
      setEntries((prev) => prev.filter((e) => e.id !== deleteTarget.id));
      toast.success("Entry deleted");
      setDeleteTarget(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to delete entry");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="space-y-4">
      <CommissionNav active="reports" />

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <Select
          items={stylistSelectItems}
          value={stylistId}
          onValueChange={(v) => v && setStylistId(v)}
        >
          <SelectTrigger className="w-full sm:w-48">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL_STYLISTS}>All Stylists</SelectItem>
            {stylists.map((s) => (
              <SelectItem key={s.id} value={s.id}>
                {s.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <DateRangeFilter
          preset={preset}
          range={range}
          onChange={(nextPreset, nextRange) => {
            setPreset(nextPreset);
            setRange(nextRange);
          }}
        />
      </div>

      {selectedStylist && (
        <Tabs
          value={paidFilter}
          onValueChange={(v) => v && setPaidFilter(v as PaidFilter)}
        >
          <TabsList className="grid w-full grid-cols-2 sm:w-64">
            <TabsTrigger value="unpaid">Unpaid</TabsTrigger>
            <TabsTrigger value="paid">Paid</TabsTrigger>
          </TabsList>
        </Tabs>
      )}

      <Card>
        <CardContent className="grid grid-cols-3 gap-2 py-4 text-center">
          <div>
            <p className="text-xs text-muted-foreground">Transactions</p>
            <p className="font-semibold tabular-nums">{totals.count}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Revenue</p>
            <p className="font-semibold tabular-nums">{formatCurrency(totals.revenue)}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">{commissionLabel}</p>
            <p className="font-semibold text-primary tabular-nums">
              {formatCurrency(totals.commission)}
            </p>
          </div>
        </CardContent>
      </Card>

      {paidFilter === "unpaid" && pendingAdjustments.length > 0 && (
        <Card>
          <CardContent className="space-y-1 py-3">
            {pendingAdjustments.map((adj) => (
              <div key={adj.id} className="flex items-center justify-between gap-2 text-sm">
                <span className="truncate text-muted-foreground">{adj.reason}</span>
                <span
                  className={`shrink-0 font-medium tabular-nums ${
                    adj.amount > 0 ? "text-primary" : "text-destructive"
                  }`}
                >
                  {adj.amount > 0 ? "+" : ""}
                  {formatCurrency(adj.amount)} adjustment pending
                </span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {selectedStylist &&
        paidFilter === "unpaid" &&
        (entries.length > 0 || pendingAdjustments.length > 0) && (
          <Button
            className="w-full"
            onClick={() => {
              setMarkPaidKey((k) => k + 1);
              setMarkPaidOpen(true);
            }}
          >
            Mark as Paid
          </Button>
        )}

      {selectedStylist && (
        <div className="flex gap-2">
          <CommissionReportShareButtons
            stylistName={selectedStylist.name}
            rangeLabel={rangeLabel}
            entries={entries}
            business={business}
            logoPath={logoPath}
          />
        </div>
      )}

      {stylistId === ALL_STYLISTS ? (
        <div className="space-y-2">
          {rollupByStylist.length === 0 ? (
            <Card>
              <CardContent className="py-6 text-center text-sm text-muted-foreground">
                No commission entries in this range.
              </CardContent>
            </Card>
          ) : (
            rollupByStylist.map((row) => (
              <Card key={row.name}>
                <CardContent className="flex items-center justify-between gap-3 py-3">
                  <div>
                    <p className="font-medium">{row.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {row.count} transactions · {formatCurrency(row.revenue)} revenue
                    </p>
                  </div>
                  <span className="font-semibold tabular-nums">
                    {formatCurrency(row.commission)}
                  </span>
                </CardContent>
              </Card>
            ))
          )}
        </div>
      ) : paidFilter === "paid" ? (
        <div className="space-y-2">
          {payoutGroups.length === 0 ? (
            <Card>
              <CardContent className="py-6 text-center text-sm text-muted-foreground">
                No paid entries in this range.
              </CardContent>
            </Card>
          ) : (
            payoutGroups.map(({ payout, entries: payoutEntries, adjustments: payoutAdjustments }) => (
              <Card key={payout.id}>
                <CardContent className="space-y-2 py-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex flex-wrap items-center gap-2">
                      {payout.confirmed_by_stylist ? (
                        <>
                          <Badge className="border-success/30 bg-success/10 text-success">
                            Confirmed
                          </Badge>
                          <Button
                            variant="outline"
                            size="xs"
                            onClick={() =>
                              setAdjustmentTarget({
                                payoutId: payout.id,
                                stylistId: selectedStylist!.id,
                                stylistName: selectedStylist!.name,
                              })
                            }
                          >
                            Add adjustment
                          </Button>
                        </>
                      ) : (
                        <>
                          <Badge variant="outline">Unconfirmed</Badge>
                          <Button
                            variant="outline"
                            size="xs"
                            onClick={() =>
                              setConfirmTarget({ payoutId: payout.id, stylist: selectedStylist! })
                            }
                          >
                            Confirm
                          </Button>
                          <Button
                            variant="destructive"
                            size="xs"
                            onClick={() =>
                              setVoidTarget({
                                payoutId: payout.id,
                                stylistName: selectedStylist!.name,
                                totalAmount: payout.total_amount,
                                rangeStart: payout.range_start,
                                rangeEnd: payout.range_end,
                              })
                            }
                          >
                            Void
                          </Button>
                        </>
                      )}
                    </div>
                    <span className="shrink-0 font-semibold text-primary tabular-nums">
                      {formatCurrency(payout.total_amount)}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {formatDate(payout.range_start)} – {formatDate(payout.range_end)}
                  </p>
                  {payoutEntries.map((entry) => (
                    <div
                      key={entry.id}
                      className="flex items-center justify-between gap-2 border-l-2 border-border pl-2 text-sm"
                    >
                      <div className="min-w-0">
                        <p className="truncate">
                          <FieldTrail
                            original={entry.original_service_name}
                            current={entry.service_name}
                          />
                          {entry.edited_at && <EditedBadge className="ml-1.5 align-middle" />}
                        </p>
                        <p className="truncate text-xs text-muted-foreground">
                          {entry.customer_name ? `${entry.customer_name} · ` : ""}
                          {formatDateTime(entry.created_at)}
                          {entry.original_stylist_name &&
                            entry.original_stylist_name !== entry.stylist.name && (
                              <> · reassigned from {entry.original_stylist_name}</>
                            )}
                        </p>
                      </div>
                      <span className="shrink-0 tabular-nums text-muted-foreground">
                        {formatCurrency(entry.commission_owed)}
                      </span>
                    </div>
                  ))}
                  {payoutAdjustments.map((adj) => (
                    <div
                      key={adj.id}
                      className="flex items-center justify-between gap-2 border-l-2 border-border pl-2 text-sm"
                    >
                      <span className="truncate text-muted-foreground">{adj.reason}</span>
                      <span
                        className={`shrink-0 font-medium tabular-nums ${
                          adj.amount > 0 ? "text-primary" : "text-destructive"
                        }`}
                      >
                        {adj.amount > 0 ? "+" : ""}
                        {formatCurrency(adj.amount)} adjustment
                      </span>
                    </div>
                  ))}
                </CardContent>
              </Card>
            ))
          )}
        </div>
      ) : (
        <div className="space-y-2">
          {entries.length === 0 ? (
            <Card>
              <CardContent className="py-6 text-center text-sm text-muted-foreground">
                No unpaid entries in this range.
              </CardContent>
            </Card>
          ) : (
            entries.map((entry) => (
              <Card key={entry.id}>
                <CardContent className="flex items-center justify-between gap-3 py-3">
                  <button
                    type="button"
                    onClick={() => setEditingEntry(entry)}
                    className="min-w-0 flex-1 rounded-md text-left transition-colors hover:bg-muted/50"
                  >
                    <p className="truncate text-sm font-medium">
                      <FieldTrail
                        original={entry.original_service_name}
                        current={entry.service_name}
                      />
                      {entry.edited_at && <EditedBadge className="ml-1.5 align-middle" />}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {entry.customer_name ? `${entry.customer_name} · ` : ""}
                      {formatDateTime(entry.created_at)}
                      {entry.original_stylist_name &&
                        entry.original_stylist_name !== entry.stylist.name && (
                          <> · reassigned from {entry.original_stylist_name}</>
                        )}
                    </p>
                  </button>
                  <div className="flex items-center gap-2">
                    <div className="text-right">
                      <span className="block font-semibold tabular-nums">
                        <PriceTrail
                          original={entry.original_price}
                          current={entry.price_charged}
                          format={formatCurrency}
                        />
                      </span>
                      <span className="block text-xs text-primary tabular-nums">
                        {formatCurrency(entry.commission_owed)} commission
                      </span>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      title="Delete entry"
                      onClick={() => setDeleteTarget(entry)}
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))
          )}
        </div>
      )}

      {paidFilter === "paid" && voidedPayouts.length > 0 && (
        <Card>
          <CardHeader
            role="button"
            tabIndex={0}
            onClick={() => setVoidedOpen((prev) => !prev)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                setVoidedOpen((prev) => !prev);
              }
            }}
            className="flex cursor-pointer flex-row items-center justify-between outline-none"
          >
            <CardTitle className="text-sm text-muted-foreground">
              Voided payouts ({voidedPayouts.length})
            </CardTitle>
            {voidedOpen ? (
              <ChevronUp className="h-4 w-4 text-muted-foreground" />
            ) : (
              <ChevronDown className="h-4 w-4 text-muted-foreground" />
            )}
          </CardHeader>
          {voidedOpen && (
            <CardContent className="space-y-2">
              {voidedPayouts.map((payout) => (
                <div
                  key={payout.id}
                  className="rounded-lg border border-border/50 p-3 opacity-60"
                >
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm font-medium">{selectedStylist?.name}</p>
                    <span className="font-semibold tabular-nums line-through">
                      {formatCurrency(payout.total_amount)}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {formatDate(payout.range_start)} – {formatDate(payout.range_end)}
                    {payout.voided_at && <> · Voided {formatDateTime(payout.voided_at)}</>}
                  </p>
                </div>
              ))}
            </CardContent>
          )}
        </Card>
      )}

      <Dialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete this entry?</DialogTitle>
            <DialogDescription>
              {deleteTarget && (
                <>
                  {deleteTarget.service_name} · {formatCurrency(deleteTarget.price_charged)}
                  <br />
                </>
              )}
              This can&apos;t be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
            <Button variant="destructive" onClick={handleDelete} disabled={deleting}>
              {deleting && <Loader2 className="h-4 w-4 animate-spin" />}
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!voidTarget} onOpenChange={(open) => !open && setVoidTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Void this payout?</DialogTitle>
            <DialogDescription>
              {voidTarget && (
                <>
                  {voidTarget.stylistName} · {formatCurrency(voidTarget.totalAmount)}
                  <br />
                  {formatDate(voidTarget.rangeStart)} – {formatDate(voidTarget.rangeEnd)}
                  <br />
                </>
              )}
              This returns its entries to Unpaid so they can be included in a new payout. This
              can&apos;t be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
            <Button variant="destructive" onClick={handleVoid} disabled={voiding}>
              {voiding && <Loader2 className="h-4 w-4 animate-spin" />}
              Void payout
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {selectedStylist && (
        <MarkAsPaidDialog
          key={markPaidKey}
          open={markPaidOpen}
          onOpenChange={setMarkPaidOpen}
          stylist={selectedStylist}
          defaultRangeStart={earliestUnpaidDate}
          onDone={() => {
            fetchEntries();
            // A new payout consumes every pending adjustment for the
            // stylist (create_payout sets applied_payout_id on all of
            // them) - without this, an adjustment that was just folded in
            // would keep showing as "pending" until some unrelated filter
            // change happened to retrigger this fetch on its own.
            fetchPendingAdjustments();
          }}
        />
      )}

      {confirmTarget && (
        <ConfirmPayoutDialog
          open
          onOpenChange={(open) => !open && setConfirmTarget(null)}
          stylist={confirmTarget.stylist}
          payoutId={confirmTarget.payoutId}
          onConfirmed={() => handlePayoutConfirmed(confirmTarget.payoutId)}
        />
      )}

      {adjustmentTarget && (
        <AddAdjustmentDialog
          open
          onOpenChange={(open) => !open && setAdjustmentTarget(null)}
          stylistId={adjustmentTarget.stylistId}
          stylistName={adjustmentTarget.stylistName}
          payoutId={adjustmentTarget.payoutId}
        />
      )}

      {editingEntry && (
        <EditEntryDialog
          entry={editingEntry}
          services={services}
          stylists={stylists}
          open
          onOpenChange={(open) => !open && setEditingEntry(null)}
          onSave={handleSaveEdit}
        />
      )}
    </div>
  );
}
