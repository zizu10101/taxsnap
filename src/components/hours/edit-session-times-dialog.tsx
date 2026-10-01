"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { fromLocalInput, toLocalInput } from "@/lib/datetime-local";
import { sessionHours } from "@/lib/format-duration";
import type { HourEntrySession } from "@/lib/database.types";

// Corrects the start and/or end time of a completed clocked session from the
// Hours page. Hours, work date and labor cost are not typed here - the
// database recomputes them from the timestamps (owner_edit_time_session), so
// the linked entry can never disagree with the session it came from.
//
// Parent keys this by session id (and remounts on every open), so the inputs
// seed fresh from the session each time.
export function EditSessionTimesDialog({
  session,
  title,
  open,
  onOpenChange,
  onSaved,
}: {
  session: HourEntrySession;
  title: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: (sessionId: string) => void;
}) {
  const [startValue, setStartValue] = useState(() => toLocalInput(session.clock_in_at));
  const [endValue, setEndValue] = useState(() =>
    session.clock_out_at ? toLocalInput(session.clock_out_at) : "",
  );
  const [saving, setSaving] = useState(false);

  const startIso = fromLocalInput(startValue);
  const endIso = fromLocalInput(endValue);
  const previewHours =
    startIso && endIso && new Date(endIso) > new Date(startIso)
      ? sessionHours(startIso, endIso)
      : null;

  async function handleSave() {
    if (!startIso || !endIso) {
      toast.error("Enter valid start and end times.");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/time-sessions/${session.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clock_in_at: startIso, clock_out_at: endIso }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Couldn't save the new times.");
      toast.success("Times updated");
      onSaved(session.id);
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit clocked times</DialogTitle>
          <DialogDescription>
            {title}. Hours and cost recalculate from the start and end times.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="space-y-2">
            <Label htmlFor="session-start">Start</Label>
            <Input
              id="session-start"
              type="datetime-local"
              value={startValue}
              onChange={(e) => setStartValue(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="session-end">End</Label>
            <Input
              id="session-end"
              type="datetime-local"
              value={endValue}
              onChange={(e) => setEndValue(e.target.value)}
            />
          </div>
        </div>

        <p className="text-sm text-muted-foreground tabular-nums">
          {previewHours !== null
            ? `New total: ${previewHours.toFixed(2)} h`
            : "The end time must be after the start time."}
        </p>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving || previewHours === null}>
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            Save changes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
