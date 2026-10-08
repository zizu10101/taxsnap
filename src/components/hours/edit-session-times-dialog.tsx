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
import { useRouter } from "next/navigation";

// Corrects the start and/or end time of a completed clocked session from the
// Hours page. Hours, work date and labor cost are not typed here - the
// database recomputes them from the timestamps (owner_edit_time_session), so
// the linked entry can never disagree with the session it came from.
//
// The database refuses future times (owner_edit_time_session); checking here
// too means the person is told why before sending, instead of seeing a
// "New total" that looks fine and a save that does nothing visible. Allows
// 1 minute of clock skew, same as the database. Pure: the caller passes the
// current time (from an event handler).
function validateTimes(startValue: string, endValue: string, nowMs: number): string | null {
  const start = fromLocalInput(startValue);
  const end = fromLocalInput(endValue);
  if (!start || !end) return "Enter valid start and end times.";
  const limit = nowMs + 60_000;
  if (new Date(start).getTime() > limit || new Date(end).getTime() > limit) {
    return "Times can't be in the future.";
  }
  if (new Date(end) <= new Date(start)) return "The end time must be after the start time.";
  return null;
}

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
  const router = useRouter();
  const [startValue, setStartValue] = useState(() => toLocalInput(session.clock_in_at));
  const [endValue, setEndValue] = useState(() =>
    session.clock_out_at ? toLocalInput(session.clock_out_at) : "",
  );
  const [saving, setSaving] = useState(false);
  // Inline error, shown right under the fields. Covers both the checks done
  // here as the person edits and anything the server rejects on save (future
  // times, overlap with another session...) - a toast alone shows up in the
  // far corner behind the modal and is easy to miss.
  const [error, setError] = useState<string | null>(null);

  const startIso = fromLocalInput(startValue);
  const endIso = fromLocalInput(endValue);
  const previewHours =
    startIso && endIso && new Date(endIso) > new Date(startIso)
      ? sessionHours(startIso, endIso)
      : null;

  async function handleSave() {
    const problem = validateTimes(startValue, endValue, new Date().getTime());
    if (problem || !startIso || !endIso) {
      setError(problem ?? "Enter valid start and end times.");
      return;
    }
    setError(null);
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
      router.refresh();
      onOpenChange(false);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Something went wrong";
      setError(message);
      toast.error(message);
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
              onChange={(e) => {
                setStartValue(e.target.value);
                setError(validateTimes(e.target.value, endValue, Date.now()));
              }}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="session-end">End</Label>
            <Input
              id="session-end"
              type="datetime-local"
              value={endValue}
              onChange={(e) => {
                setEndValue(e.target.value);
                setError(validateTimes(startValue, e.target.value, Date.now()));
              }}
            />
          </div>
        </div>

        {error ? (
          <p role="alert" className="text-sm font-medium text-destructive">
            {error}
          </p>
        ) : (
          <p className="text-sm text-muted-foreground tabular-nums">
            {previewHours !== null ? `New total: ${previewHours.toFixed(2)} h` : ""}
          </p>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving || previewHours === null || error !== null}>
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            Save changes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
