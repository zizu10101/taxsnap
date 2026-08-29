"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
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
import { CommissionReportShareButtons } from "@/components/commission/commission-report-share-buttons";
import { MarkAsPaidDialog } from "@/components/commission/mark-as-paid-dialog";
import { ConfirmPayoutDialog } from "@/components/commission/confirm-payout-dialog";
import { getPresetRange, describeRange, type DateRange, type RangePreset } from "@/lib/date-range";
import type { BusinessInfo } from "@/components/invoices/document-detail";
import type { CommissionEntryWithRelations, StylistPublic } from "@/lib/database.types";

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

export function CommissionReports({
  stylists,
  initialEntries,
  business,
  logoPath,
}: {
  stylists: StylistPublic[];
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
  const fetchTokenRef = useRef(0);

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
    if (range.start) params.set("from", range.start);
    if (range.end) params.set("to", range.end);

    return fetch(`/api/commission-entries?${params.toString()}`)
      .then((res) => res.json())
      .then((data) => {
        if (fetchTokenRef.current === token) setEntries(data.entries ?? []);
      });
  }, [stylistId, range.start, range.end, paidFilter]);

  // Always refetches on mount too, not just on filter changes - relying on
  // `initialEntries` alone risks showing stale totals, since Next's
  // client-side router cache can serve an old RSC payload from an earlier
  // visit to this page in the same session (e.g. right after logging new
  // entries via the Log tab and clicking straight into Reports - the exact
  // normal workflow this page exists for).
  useEffect(() => {
    fetchEntries();
  }, [fetchEntries]);

  const stylistSelectItems = useMemo(() => {
    const map: Record<string, string> = { [ALL_STYLISTS]: "All Stylists" };
    for (const s of stylists) map[s.id] = s.name;
    return map;
  }, [stylists]);

  const totals = useMemo(() => {
    const revenue = entries.reduce((sum, e) => sum + e.price_charged, 0);
    const commission = entries.reduce((sum, e) => sum + e.commission_owed, 0);
    return { count: entries.length, revenue, commission };
  }, [entries]);

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
  // is the last item, not the first.
  const earliestUnpaidDate =
    paidFilter === "unpaid" && entries.length > 0
      ? entries[entries.length - 1].created_at.slice(0, 10)
      : new Date().toISOString().slice(0, 10);

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

      {selectedStylist && paidFilter === "unpaid" && entries.length > 0 && (
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
      ) : (
        <div className="space-y-2">
          {entries.length === 0 ? (
            <Card>
              <CardContent className="py-6 text-center text-sm text-muted-foreground">
                No {paidFilter} entries in this range.
              </CardContent>
            </Card>
          ) : (
            entries.map((entry) => (
              <Card key={entry.id}>
                <CardContent className="flex items-center justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="truncate text-sm font-medium">{entry.service_name}</p>
                      {paidFilter === "paid" &&
                        (entry.payout?.confirmed_by_stylist ? (
                          <Badge className="border-success/30 bg-success/10 text-success">
                            Confirmed
                          </Badge>
                        ) : (
                          <>
                            <Badge variant="outline">Unconfirmed</Badge>
                            {entry.payout && (
                              <Button
                                variant="outline"
                                size="xs"
                                onClick={() =>
                                  setConfirmTarget({
                                    payoutId: entry.payout!.id,
                                    stylist: entry.stylist,
                                  })
                                }
                              >
                                Confirm
                              </Button>
                            )}
                          </>
                        ))}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {entry.customer_name ? `${entry.customer_name} · ` : ""}
                      {formatDateTime(entry.created_at)}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="text-right">
                      <span className="block font-semibold tabular-nums">
                        {formatCurrency(entry.price_charged)}
                      </span>
                      <span className="block text-xs text-primary tabular-nums">
                        {formatCurrency(entry.commission_owed)} commission
                      </span>
                    </div>
                    {!entry.payout_id && (
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        title="Delete entry"
                        onClick={() => setDeleteTarget(entry)}
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))
          )}
        </div>
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

      {selectedStylist && (
        <MarkAsPaidDialog
          key={markPaidKey}
          open={markPaidOpen}
          onOpenChange={setMarkPaidOpen}
          stylist={selectedStylist}
          defaultRangeStart={earliestUnpaidDate}
          onDone={fetchEntries}
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
    </div>
  );
}
