"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NumberInput } from "@/components/ui/number-input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { SERVICE_COLOR_PALETTE } from "@/lib/service-colors";
import { cn } from "@/lib/utils";
import type { Service } from "@/lib/database.types";

export function ServiceDialog({
  open,
  onOpenChange,
  service,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  service?: Service | null;
  onSaved: (service: Service) => void;
}) {
  const isEditing = !!service;
  const [name, setName] = useState(service?.name ?? "");
  const [price, setPrice] = useState(service?.default_price ?? 0);
  const [color, setColor] = useState(service?.color ?? SERVICE_COLOR_PALETTE[0]);
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    if (!name.trim()) {
      toast.error("Enter the service's name.");
      return;
    }

    setSaving(true);
    try {
      const res = await fetch(isEditing ? `/api/services/${service!.id}` : "/api/services", {
        method: isEditing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, default_price: price, color }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to save");

      onSaved(data.service as Service);
      toast.success(isEditing ? "Service updated" : "Service added");
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{isEditing ? "Edit service" : "New service"}</DialogTitle>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="space-y-2">
            <Label htmlFor="service-name">Name</Label>
            <Input
              id="service-name"
              placeholder="e.g. Haircut"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="service-price">Price</Label>
            <NumberInput id="service-price" value={price} onValueChange={setPrice} />
          </div>
          <div className="space-y-2">
            <Label>Color</Label>
            <div className="flex flex-wrap gap-2">
              {SERVICE_COLOR_PALETTE.map((swatch) => (
                <button
                  key={swatch}
                  type="button"
                  aria-label={`Use color ${swatch}`}
                  onClick={() => setColor(swatch)}
                  className={cn(
                    "h-8 w-8 rounded-full border-2 transition-transform",
                    color === swatch
                      ? "scale-110 border-foreground"
                      : "border-transparent",
                  )}
                  style={{ backgroundColor: swatch }}
                />
              ))}
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            {isEditing ? "Save changes" : "Add service"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
