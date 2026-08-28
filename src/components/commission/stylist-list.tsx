"use client";

import { useState } from "react";
import { Pencil, Plus, Users } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { CommissionNav } from "@/components/commission/commission-nav";
import { StylistDialog } from "@/components/commission/stylist-dialog";
import type { Stylist } from "@/lib/database.types";

export function StylistList({ initialStylists }: { initialStylists: Stylist[] }) {
  const [stylists, setStylists] = useState(initialStylists);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Stylist | null>(null);

  function upsert(stylist: Stylist) {
    setStylists((prev) => {
      const exists = prev.some((s) => s.id === stylist.id);
      const next = exists
        ? prev.map((s) => (s.id === stylist.id ? stylist : s))
        : [...prev, stylist];
      return next.sort((a, b) => a.name.localeCompare(b.name));
    });
  }

  async function toggleActive(stylist: Stylist) {
    try {
      const res = await fetch(`/api/stylists/${stylist.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_active: !stylist.is_active }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to update");
      upsert(data.stylist as Stylist);
      toast.success(stylist.is_active ? "Stylist deactivated" : "Stylist reactivated");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Something went wrong");
    }
  }

  const active = stylists.filter((s) => s.is_active);
  const inactive = stylists.filter((s) => !s.is_active);

  return (
    <div className="space-y-4">
      <CommissionNav active="stylists" />

      <Button
        className="w-full"
        onClick={() => {
          setEditing(null);
          setDialogOpen(true);
        }}
      >
        <Plus className="h-4 w-4" />
        New stylist
      </Button>

      {stylists.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-10 text-center text-muted-foreground">
            <Users className="h-8 w-8" />
            <p className="text-sm">No stylists yet.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {[...active, ...inactive].map((stylist) => (
            <Card key={stylist.id} className={!stylist.is_active ? "opacity-60" : undefined}>
              <CardContent className="flex items-center justify-between gap-3 py-4">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="truncate font-medium">{stylist.name}</p>
                    {!stylist.is_active && <Badge variant="outline">Inactive</Badge>}
                  </div>
                  <p className="text-xs text-muted-foreground tabular-nums">
                    {(stylist.commission_rate * 100).toFixed(0)}% commission ·{" "}
                    {stylist.pay_type}
                  </p>
                </div>
                <div className="flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    title="Edit"
                    onClick={() => {
                      setEditing(stylist);
                      setDialogOpen(true);
                    }}
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => toggleActive(stylist)}
                  >
                    {stylist.is_active ? "Deactivate" : "Reactivate"}
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <StylistDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        stylist={editing}
        onSaved={upsert}
      />
    </div>
  );
}
