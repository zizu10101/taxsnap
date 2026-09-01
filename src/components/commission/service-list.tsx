"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Plus, Scissors } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { CommissionNav } from "@/components/commission/commission-nav";
import { ServiceDialog } from "@/components/commission/service-dialog";
import type { Service } from "@/lib/database.types";

function formatCurrency(amount: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(amount);
}

export function ServiceList({
  initialServices,
  showNav = true,
  isPro = false,
}: {
  initialServices: Service[];
  // Off for the onboarding flow, which reuses this list+dialog wholesale
  // but isn't part of the Commission section's own tab row.
  showNav?: boolean;
  // Only threaded through to CommissionNav (Overview tab visibility) -
  // defaults to false since it's irrelevant whenever showNav is false.
  isPro?: boolean;
}) {
  const [services, setServices] = useState(initialServices);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Service | null>(null);
  const router = useRouter();

  function upsert(service: Service) {
    setServices((prev) => {
      const exists = prev.some((s) => s.id === service.id);
      const next = exists
        ? prev.map((s) => (s.id === service.id ? service : s))
        : [...prev, service];
      return next.sort((a, b) => a.name.localeCompare(b.name));
    });
  }

  async function toggleActive(service: Service) {
    try {
      const res = await fetch(`/api/services/${service.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_active: !service.is_active }),
      });
      const data = await res.json();
      if (!res.ok) {
        // Reactivating a deactivated service is also capped for free-tier
        // accounts (see lib/free-tier-limits.ts) - otherwise the 1-active
        // limit could be bypassed entirely via deactivate-then-reactivate
        // instead of ever using the "New service" flow twice.
        if (data.code === "FREE_LIMIT_REACHED") {
          toast.error(data.error, {
            action: { label: "Upgrade", onClick: () => router.push("/billing") },
          });
          return;
        }
        throw new Error(data.error || "Failed to update");
      }
      upsert(data.service as Service);
      toast.success(service.is_active ? "Service deactivated" : "Service reactivated");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Something went wrong");
    }
  }

  const active = services.filter((s) => s.is_active);
  const inactive = services.filter((s) => !s.is_active);

  return (
    <div className="space-y-4">
      {showNav && <CommissionNav active="services" isPro={isPro} />}

      <Button
        className="w-full"
        onClick={() => {
          setEditing(null);
          setDialogOpen(true);
        }}
      >
        <Plus className="h-4 w-4" />
        New service
      </Button>

      {services.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-10 text-center text-muted-foreground">
            <Scissors className="h-8 w-8" />
            <p className="text-sm">No services yet.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {[...active, ...inactive].map((service) => (
            <Card key={service.id} className={!service.is_active ? "opacity-60" : undefined}>
              <CardContent className="flex items-center justify-between gap-3 py-4">
                <div className="flex min-w-0 items-center gap-3">
                  <span
                    className="h-4 w-4 shrink-0 rounded-full"
                    style={{ backgroundColor: service.color }}
                  />
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="truncate font-medium">{service.name}</p>
                      {!service.is_active && <Badge variant="outline">Inactive</Badge>}
                    </div>
                    <p className="text-xs text-muted-foreground tabular-nums">
                      {formatCurrency(service.default_price)}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    title="Edit"
                    onClick={() => {
                      setEditing(service);
                      setDialogOpen(true);
                    }}
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => toggleActive(service)}
                  >
                    {service.is_active ? "Deactivate" : "Reactivate"}
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <ServiceDialog
        key={editing?.id ?? "new"}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        service={editing}
        onSaved={upsert}
      />
    </div>
  );
}
