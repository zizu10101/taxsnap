"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ListPlus, Pencil, Plus } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { LineItemDialog } from "@/components/invoices/line-item-dialog";
import { UsageLimitBar } from "@/components/dashboard/usage-limit-bar";
import { PLAN_LIMITS } from "@/lib/plan-limits";
import type { LineItem, SubscriptionStatus } from "@/lib/database.types";

function formatCurrency(amount: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(amount);
}

// General-business analogue of ServiceList - same active-cap/deactivate
// shape (see lib/plan-limits.ts), just without a color swatch (nothing
// here renders items as a colored card grid the way CommissionLogger
// does for services).
export function LineItemList({
  initialLineItems,
  subscriptionStatus,
}: {
  initialLineItems: LineItem[];
  subscriptionStatus: SubscriptionStatus;
}) {
  const [items, setItems] = useState(initialLineItems);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<LineItem | null>(null);
  const router = useRouter();

  function upsert(item: LineItem) {
    setItems((prev) => {
      const exists = prev.some((i) => i.id === item.id);
      const next = exists ? prev.map((i) => (i.id === item.id ? item : i)) : [...prev, item];
      return next.sort((a, b) => a.description.localeCompare(b.description));
    });
  }

  async function toggleActive(item: LineItem) {
    try {
      const res = await fetch(`/api/line-items/${item.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_active: !item.is_active }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (data.code === "FREE_LIMIT_REACHED") {
          toast.error(data.error, {
            action: { label: "Upgrade", onClick: () => router.push("/billing") },
          });
          return;
        }
        throw new Error(data.error || "Failed to update");
      }
      upsert(data.lineItem as LineItem);
      toast.success(item.is_active ? "Item deactivated" : "Item reactivated");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Something went wrong");
    }
  }

  const active = items.filter((i) => i.is_active);
  const inactive = items.filter((i) => !i.is_active);

  return (
    <div className="space-y-4">
      <UsageLimitBar
        tier={subscriptionStatus}
        current={active.length}
        limit={PLAN_LIMITS[subscriptionStatus].lineItems}
        noun="active saved item"
      />

      <Button
        className="w-full"
        onClick={() => {
          setEditing(null);
          setDialogOpen(true);
        }}
      >
        <Plus className="h-4 w-4" />
        New saved item
      </Button>

      {items.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-10 text-center text-muted-foreground">
            <ListPlus className="h-8 w-8" />
            <p className="text-sm">No saved items yet.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {[...active, ...inactive].map((item) => (
            <Card key={item.id} className={!item.is_active ? "opacity-60" : undefined}>
              <CardContent className="flex items-center justify-between gap-3 py-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="truncate font-medium">{item.description}</p>
                    {!item.is_active && <Badge variant="outline">Inactive</Badge>}
                  </div>
                  <p className="text-xs text-muted-foreground tabular-nums">
                    {formatCurrency(item.unit_price)}
                  </p>
                </div>
                <div className="flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    title="Edit"
                    onClick={() => {
                      setEditing(item);
                      setDialogOpen(true);
                    }}
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => toggleActive(item)}>
                    {item.is_active ? "Deactivate" : "Reactivate"}
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <LineItemDialog
        key={editing?.id ?? "new"}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        lineItem={editing}
        onSaved={upsert}
      />
    </div>
  );
}
