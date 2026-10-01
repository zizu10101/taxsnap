"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

// Confirmation for deleting a clocked session. Deleting is permanent, so it
// never happens on a single click. A completed session also takes the hours
// entry generated from it (and so its labor cost on the job) with it; an open
// session has no entry yet, so the warning doesn't claim one.
export function DeleteSessionDialog({
  sessionId,
  description,
  completed,
  open,
  onOpenChange,
  onDeleted,
}: {
  sessionId: string;
  // e.g. "Dana on Maple St, Sep 30 (3h, $120.00)" - what is about to go.
  description: string;
  // false = still clocked in (no hours entry exists yet).
  completed: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDeleted: (sessionId: string) => void;
}) {
  const [deleting, setDeleting] = useState(false);

  async function handleDelete() {
    setDeleting(true);
    try {
      const res = await fetch(`/api/time-sessions/${sessionId}`, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Couldn't delete the session.");
      toast.success(completed ? "Session and its hours entry deleted" : "Session deleted");
      onDeleted(sessionId);
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete this clocked session?</DialogTitle>
          <DialogDescription>
            {description}.{" "}
            {completed
              ? "This also removes its hours entry and that labor cost from the job. "
              : ""}
            It can&apos;t be undone.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={deleting}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={handleDelete} disabled={deleting}>
            {deleting && <Loader2 className="h-4 w-4 animate-spin" />}
            Delete session
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
