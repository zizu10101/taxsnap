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
import { useRouter } from "next/navigation";

export type OpenSessionInfo = {
  id: string;
  employeeId: string;
  clockInAt: string;
  jobName: string;
};

// Owner closes a still-open session (typically a forgotten clock-out) with a
// corrected end time. The session is marked closed-by-owner so it stays
// distinguishable from a normal employee clock-out.
export function CloseSessionDialog({
  session,
  employeeName,
  open,
  onOpenChange,
  onClosed,
}: {
  session: OpenSessionInfo | null;
  employeeName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onClosed: (employeeId: string) => void;
}) {
  const router = useRouter();
  // Parent keys this dialog by session id, so this seeds fresh per session.
  const [endValue, setEndValue] = useState(() => toLocalInput(new Date()));
  const [saving, setSaving] = useState(false);

  async function handleClose() {
    if (!session) return;
    const iso = fromLocalInput(endValue);
    if (!iso) {
      toast.error("Enter a valid end time.");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/time-sessions/${session.id}/close`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clock_out_at: iso }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Couldn't close the session.");
      toast.success(`Closed ${employeeName}'s session`);
      router.refresh();
      onClosed(session.employeeId);
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
          <DialogTitle>Close {employeeName}&apos;s session</DialogTitle>
          <DialogDescription>
            {session
              ? `Clocked in on ${session.jobName} at ${new Date(session.clockInAt).toLocaleString()}. Set the time they actually finished.`
              : ""}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="close-end">End time</Label>
          <Input
            id="close-end"
            type="datetime-local"
            value={endValue}
            onChange={(e) => setEndValue(e.target.value)}
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleClose} disabled={saving}>
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            Close session
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
