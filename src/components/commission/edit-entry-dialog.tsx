"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import type { CommissionEntryWithRelations, Service, StylistPublic } from "@/lib/database.types";

function formatCurrency(amount: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(amount);
}

// Replaces the old step-based edit flow (service -> stylist -> name,
// reusing the create flow's own steps backward) with all three fields
// visible and editable at once - no sequential navigation, so there's no
// "back" state to misinterpret.
//
// This component is only ever mounted while `entry` is non-null (see
// CommissionLogger: `{editingEntry && <EditEntryDialog entry={editingEntry} .../>}`),
// the same pattern this codebase already uses for ConfirmPayoutDialog/
// AddAdjustmentDialog - it naturally gets a fresh mount (and fresh local
// state, initialized from `entry`) every time a different row is tapped,
// rather than persisting stale selections between edits.
//
// Root cause of the bug this replaces: the old flow reused
// CommissionLogger's create-flow state (selectedService/selectedStylist/
// customerName/editingEntryId) for editing too. Backing out of an edit via
// the step flow's own "back" links cleared selectedService/selectedStylist
// but NOT editingEntryId, which only got cleared when a *service card* was
// tapped again (via resetFlow() in that onClick) - the exact action a
// staff member would take to "resume" what they thought was still an
// in-progress edit. That tap silently cleared editingEntryId first, so the
// resulting Submit went through the create path (POST) instead of the
// edit path (PATCH), leaving the original entry untouched and creating an
// unrelated duplicate. This dialog has no shared state with the create
// flow at all - its Cancel/X close the dialog and discard its own local
// state, full stop, so there is no code path from "cancel this edit" to
// "create an entry."
export function EditEntryDialog({
  entry,
  services,
  stylists,
  open,
  onOpenChange,
  onSave,
}: {
  entry: CommissionEntryWithRelations;
  services: Service[];
  stylists: StylistPublic[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  // Parent owns the actual PATCH call (and updating its own entries list on
  // success) - this component only collects the three fields and reports
  // them back once Save is tapped. Left as a callback rather than an
  // inline fetch here so the network call can be reviewed/wired up as its
  // own step.
  onSave: (values: {
    service_id: string;
    stylist_id: string;
    customer_name: string;
  }) => Promise<void>;
}) {
  const [selectedServiceId, setSelectedServiceId] = useState(entry.service_id);
  const [selectedStylistId, setSelectedStylistId] = useState(entry.stylist_id);
  const [customerName, setCustomerName] = useState(entry.customer_name ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    if (!selectedServiceId || !selectedStylistId) return;
    setSaving(true);
    setError(null);
    try {
      await onSave({
        service_id: selectedServiceId,
        stylist_id: selectedStylistId,
        customer_name: customerName.trim(),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save changes");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !saving && onOpenChange(next)}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit entry</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Service</Label>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {services.map((service) => {
                const selected = service.id === selectedServiceId;
                return (
                  <button
                    key={service.id}
                    type="button"
                    onClick={() => setSelectedServiceId(service.id)}
                    className={cn(
                      "flex h-20 flex-col items-center justify-center gap-1 rounded-lg border-2 p-2 text-center text-sm font-medium text-foreground transition-transform active:scale-[0.98]",
                      selected && "ring-2 ring-primary ring-offset-2 ring-offset-popover",
                    )}
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
                );
              })}
            </div>
          </div>

          <div className="space-y-2">
            <Label>Stylist</Label>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {stylists.map((stylist) => {
                const selected = stylist.id === selectedStylistId;
                return (
                  <button
                    key={stylist.id}
                    type="button"
                    onClick={() => setSelectedStylistId(stylist.id)}
                    className={cn(
                      "flex h-16 items-center justify-center rounded-lg border p-2 text-center text-sm font-medium transition-colors",
                      selected
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border bg-card hover:bg-muted/50",
                    )}
                  >
                    {stylist.name}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="edit-entry-customer-name">Customer name</Label>
            <Input
              id="edit-entry-customer-name"
              placeholder="Customer name (optional)"
              value={customerName}
              onChange={(e) => setCustomerName(e.target.value)}
            />
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>

        <DialogFooter>
          <DialogClose render={<Button variant="outline" />} disabled={saving}>
            Cancel
          </DialogClose>
          <Button
            onClick={handleSave}
            disabled={saving || !selectedServiceId || !selectedStylistId}
          >
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            Save changes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
