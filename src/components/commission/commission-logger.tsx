"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { CommissionNav } from "@/components/commission/commission-nav";
import { FieldTrail, PriceTrail, EditedBadge } from "@/components/commission/entry-trail";
import { EditEntryDialog } from "@/components/commission/edit-entry-dialog";
import { useAppLock } from "@/components/app-lock/app-lock-context";
import { getPresetRange, rangeToUtcBounds } from "@/lib/date-range";
import type { CommissionEntryWithRelations, Service, StylistPublic } from "@/lib/database.types";

function formatCurrency(amount: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(amount);
}

// Same format as commission-reports.tsx/invoice-pdf.ts's formatDateTime -
// always includes the date (not just the time) since a shift can run past
// midnight, in which case "Today's entries" would otherwise show two
// different calendar days' entries with identical-looking timestamps.
function formatDateTime(isoStr: string) {
  return new Date(isoStr).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function CommissionLogger({
  initialServices,
  initialStylists,
}: {
  initialServices: Service[];
  initialStylists: StylistPublic[];
}) {
  // Create-flow state only, below - editing an existing entry (Today's
  // entries) is a fully separate EditEntryDialog with its own state, not a
  // reuse of this. See editingEntry further down and the dialog's own
  // comment for why: the old shared-state version of this had a real bug
  // where backing out of an edit could silently create a duplicate entry
  // instead of canceling.
  const [selectedService, setSelectedService] = useState<Service | null>(null);
  const [selectedStylist, setSelectedStylist] = useState<StylistPublic | null>(null);
  const [customerName, setCustomerName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const { role } = useAppLock();
  const isStaffMode = role === "staff";

  // Today's entries is staff-mode only (see CommissionLogger's caller) -
  // the owner already has the full Reports tab for this, staff only ever
  // reach the Log page. Fetched client-side since role is client-only
  // state; the server-rendered page has no way to know it in advance.
  const [todaysEntries, setTodaysEntries] = useState<CommissionEntryWithRelations[]>([]);
  // The entry currently open in EditEntryDialog, or null. The dialog is
  // only ever mounted while this is set (`{editingEntry && <EditEntryDialog .../>}`
  // below), so it always gets a fresh mount - and fresh local state seeded
  // from `entry` - per edit, and fully unmounts (discarding that state) on
  // cancel/close/save.
  const [editingEntry, setEditingEntry] = useState<CommissionEntryWithRelations | null>(null);

  useEffect(() => {
    if (!isStaffMode) return;
    const { from, to } = rangeToUtcBounds(getPresetRange("today"));
    fetch(`/api/commission-entries?from=${from}&to=${to}`)
      .then((res) => res.json())
      .then((data) => setTodaysEntries(data.entries ?? []));
  }, [isStaffMode]);

  async function handleUndo(entryId: string) {
    try {
      const res = await fetch(`/api/commission-entries/${entryId}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to undo");
      setTodaysEntries((prev) => prev.filter((e) => e.id !== entryId));
      toast.success("Entry removed");
    } catch {
      toast.error("Failed to undo - the entry is still logged.");
    }
  }

  // The dialog reports back the three fields once Save is tapped; this is
  // the only place that actually calls PATCH. Throwing on failure lets the
  // dialog's own try/catch show the error inline and keep itself open for
  // a retry, instead of losing the in-progress selection.
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
    setTodaysEntries((prev) => prev.map((e) => (e.id === updated.id ? updated : e)));
    toast.success(`Updated: ${updated.service_name} → ${updated.stylist.name}`);
    setEditingEntry(null);
  }

  async function handleSubmit() {
    if (!selectedService || !selectedStylist) return;
    setSubmitting(true);
    try {
      const res = await fetch("/api/commission-entries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          stylist_id: selectedStylist.id,
          service_id: selectedService.id,
          customer_name: customerName.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to log");

      const entry = data.entry as CommissionEntryWithRelations;
      toast.success(
        `Logged: ${entry.service_name} → ${selectedStylist.name}, ${formatCurrency(entry.price_charged)}`,
        { action: { label: "Undo", onClick: () => handleUndo(entry.id) } },
      );
      if (isStaffMode) setTodaysEntries((prev) => [entry, ...prev]);

      setSelectedService(null);
      setSelectedStylist(null);
      setCustomerName("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to log entry");
      // Stay on this step, keep whatever was typed - a failed save shouldn't
      // make the owner retype the customer name.
    } finally {
      setSubmitting(false);
    }
  }

  if (initialServices.length === 0 || initialStylists.length === 0) {
    return (
      <div className="space-y-4">
        <CommissionNav active="log" />
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
            <p className="font-medium">Set up services and stylists first</p>
            <p className="max-w-xs text-sm text-muted-foreground">
              Add at least one active service and one active stylist before
              you can log a commission entry.
            </p>
            {/* Staff can't reach Services/Stylists (route-gated back to
                here anyway) - these links would be dead ends in staff
                mode, so they're omitted rather than shown and bounced. */}
            {!isStaffMode && (
              <div className="flex gap-2">
                {initialServices.length === 0 && (
                  <Button
                    nativeButton={false}
                    render={<Link href="/dashboard/commission/services" />}
                  >
                    Add services
                  </Button>
                )}
                {initialStylists.length === 0 && (
                  <Button
                    nativeButton={false}
                    render={<Link href="/dashboard/commission/stylists" />}
                  >
                    Add stylists
                  </Button>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <CommissionNav active="log" />

      {selectedService && selectedStylist ? (
        <div className="space-y-3">
          <button
            type="button"
            onClick={() => setSelectedStylist(null)}
            className="inline-flex items-center gap-1.5 text-sm font-medium text-primary underline decoration-primary/40 underline-offset-4 hover:decoration-primary"
          >
            <ArrowLeft className="h-4 w-4" />
            {selectedService.name} → {selectedStylist.name}
          </button>
          <p className="text-sm text-muted-foreground">
            {formatCurrency(selectedService.default_price)}
          </p>
          <Input
            autoFocus
            placeholder="Customer name (optional)"
            value={customerName}
            onChange={(e) => setCustomerName(e.target.value)}
          />
          <Button
            className="w-full"
            size="lg"
            onClick={handleSubmit}
            disabled={submitting}
          >
            {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
            Submit
          </Button>
        </div>
      ) : selectedService ? (
        <div className="space-y-3">
          <button
            type="button"
            onClick={() => setSelectedService(null)}
            className="inline-flex items-center gap-1.5 text-sm font-medium text-primary underline decoration-primary/40 underline-offset-4 hover:decoration-primary"
          >
            <ArrowLeft className="h-4 w-4" />
            {selectedService.name} — pick a stylist
          </button>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {initialStylists.map((stylist) => (
              <button
                key={stylist.id}
                type="button"
                onClick={() => setSelectedStylist(stylist)}
                className="flex h-24 flex-col items-center justify-center gap-1 rounded-lg border border-border bg-card p-3 text-center font-medium transition-colors hover:bg-muted/50 active:scale-[0.98]"
              >
                {stylist.name}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div className="grid max-h-[70vh] grid-cols-2 gap-3 overflow-y-auto sm:grid-cols-3">
          {initialServices.map((service) => (
            <button
              key={service.id}
              type="button"
              onClick={() => setSelectedService(service)}
              className="flex h-24 flex-col items-center justify-center gap-1 rounded-lg border-2 p-3 text-center font-medium text-foreground transition-transform active:scale-[0.98]"
              style={{
                borderColor: service.color,
                backgroundColor: `color-mix(in oklch, ${service.color}, transparent 88%)`,
              }}
            >
              <span className="line-clamp-2">{service.name}</span>
              <span className="text-xs tabular-nums text-muted-foreground">
                {formatCurrency(service.default_price)}
              </span>
            </button>
          ))}
        </div>
      )}

      {isStaffMode && (
        <div className="space-y-2 border-t border-border pt-4">
          <h2 className="text-sm font-semibold text-muted-foreground">Today&apos;s entries</h2>
          {todaysEntries.length === 0 ? (
            <p className="text-sm text-muted-foreground">No entries logged yet today.</p>
          ) : (
            <div className="space-y-2">
              {todaysEntries.map((entry) => {
                const isPaid = !!entry.payout_id;
                return (
                  <button
                    key={entry.id}
                    type="button"
                    disabled={isPaid}
                    onClick={() => setEditingEntry(entry)}
                    className="flex w-full items-center justify-between gap-3 rounded-lg border border-border bg-card p-3 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-60 enabled:hover:bg-muted/50 enabled:active:scale-[0.99]"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">
                        <FieldTrail
                          original={entry.original_service_name}
                          current={entry.service_name}
                        />
                        {entry.edited_at && <EditedBadge className="ml-1.5 align-middle" />}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">
                        <FieldTrail
                          original={entry.original_stylist_name}
                          current={entry.stylist.name}
                        />
                        {entry.customer_name ? ` · ${entry.customer_name}` : ""}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {formatDateTime(entry.created_at)}
                      </p>
                    </div>
                    <div className="shrink-0 text-right text-sm tabular-nums">
                      <PriceTrail
                        original={entry.original_price}
                        current={entry.price_charged}
                        format={formatCurrency}
                      />
                      {isPaid && (
                        <span className="block text-xs text-muted-foreground">Paid</span>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {editingEntry && (
        <EditEntryDialog
          entry={editingEntry}
          services={initialServices}
          stylists={initialStylists}
          open
          onOpenChange={(open) => !open && setEditingEntry(null)}
          onSave={handleSaveEdit}
        />
      )}
    </div>
  );
}
