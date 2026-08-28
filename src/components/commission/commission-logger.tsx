"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { CommissionNav } from "@/components/commission/commission-nav";
import type { CommissionEntryWithRelations, Service, Stylist } from "@/lib/database.types";

function formatCurrency(amount: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(amount);
}

const CAPTURE_DURATION_MS = 5000;

export function CommissionLogger({
  initialServices,
  initialStylists,
}: {
  initialServices: Service[];
  initialStylists: Stylist[];
}) {
  const [selectedService, setSelectedService] = useState<Service | null>(null);
  const [pendingEntryId, setPendingEntryId] = useState<string | null>(null);
  const [customerName, setCustomerName] = useState("");

  // A timeout fired at capture start (not reset by typing - "auto-dismisses
  // after a few seconds whether or not something was typed") plus the
  // latest typed value AND the entry id in refs, not state - setPendingEntryId
  // doesn't update synchronously, so a setTimeout scheduled right after
  // calling it would otherwise close over the *previous* render's
  // pendingEntryId (often null), silently dropping the customer name PATCH.
  const captureTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const customerNameRef = useRef("");
  const pendingEntryIdRef = useRef<string | null>(null);

  function commitPendingCapture() {
    if (captureTimer.current) {
      clearTimeout(captureTimer.current);
      captureTimer.current = null;
    }
    if (pendingEntryIdRef.current && customerNameRef.current.trim()) {
      fetch(`/api/commission-entries/${pendingEntryIdRef.current}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customer_name: customerNameRef.current.trim() }),
      }).catch(() => {
        // Best-effort - the core entry is already saved regardless.
      });
    }
    pendingEntryIdRef.current = null;
    setPendingEntryId(null);
    setCustomerName("");
    customerNameRef.current = "";
  }

  function startCapture(entryId: string) {
    // Only one capture slot at a time - a rapid second log commits
    // whatever was typed for the first before starting the next.
    commitPendingCapture();
    pendingEntryIdRef.current = entryId;
    setPendingEntryId(entryId);
    setCustomerName("");
    customerNameRef.current = "";
    captureTimer.current = setTimeout(commitPendingCapture, CAPTURE_DURATION_MS);
  }

  async function handleUndo(entryId: string) {
    if (pendingEntryIdRef.current === entryId) {
      if (captureTimer.current) clearTimeout(captureTimer.current);
      captureTimer.current = null;
      pendingEntryIdRef.current = null;
      setPendingEntryId(null);
      setCustomerName("");
      customerNameRef.current = "";
    }
    try {
      const res = await fetch(`/api/commission-entries/${entryId}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to undo");
      toast.success("Entry removed");
    } catch {
      toast.error("Failed to undo - the entry is still logged.");
    }
  }

  async function handleStylistTap(stylist: Stylist) {
    if (!selectedService) return;
    const service = selectedService;
    setSelectedService(null);

    try {
      const res = await fetch("/api/commission-entries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stylist_id: stylist.id, service_id: service.id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to log");

      const entry = data.entry as CommissionEntryWithRelations;
      startCapture(entry.id);
      toast.success(
        `Logged: ${entry.service_name} → ${stylist.name}, ${formatCurrency(entry.price_charged)}`,
        { action: { label: "Undo", onClick: () => handleUndo(entry.id) } },
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to log entry", {
        action: { label: "Retry", onClick: () => handleStylistTap(stylist) },
      });
      // Stay on the stylist grid rather than silently resetting, so a
      // failed save (e.g. dropped connection) doesn't look like it worked.
      setSelectedService(service);
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
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <CommissionNav active="log" />

      {selectedService ? (
        <div className="space-y-3">
          <button
            type="button"
            onClick={() => setSelectedService(null)}
            className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" />
            {selectedService.name} — pick a stylist
          </button>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {initialStylists.map((stylist) => (
              <button
                key={stylist.id}
                type="button"
                onClick={() => handleStylistTap(stylist)}
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

      {pendingEntryId && (
        <div className="fixed inset-x-4 bottom-4 z-20 mx-auto max-w-sm rounded-lg border border-border bg-card p-3 shadow-lg">
          <Input
            autoFocus
            placeholder="Customer name"
            value={customerName}
            onChange={(e) => {
              setCustomerName(e.target.value);
              customerNameRef.current = e.target.value;
            }}
          />
        </div>
      )}
    </div>
  );
}
