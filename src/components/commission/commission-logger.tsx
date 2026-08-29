"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { CommissionNav } from "@/components/commission/commission-nav";
import type { CommissionEntryWithRelations, Service, StylistPublic } from "@/lib/database.types";

function formatCurrency(amount: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(amount);
}

export function CommissionLogger({
  initialServices,
  initialStylists,
}: {
  initialServices: Service[];
  initialStylists: StylistPublic[];
}) {
  const [selectedService, setSelectedService] = useState<Service | null>(null);
  const [selectedStylist, setSelectedStylist] = useState<StylistPublic | null>(null);
  const [customerName, setCustomerName] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleUndo(entryId: string) {
    try {
      const res = await fetch(`/api/commission-entries/${entryId}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to undo");
      toast.success("Entry removed");
    } catch {
      toast.error("Failed to undo - the entry is still logged.");
    }
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

      {selectedService && selectedStylist ? (
        <div className="space-y-3">
          <button
            type="button"
            onClick={() => setSelectedStylist(null)}
            className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
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
    </div>
  );
}
